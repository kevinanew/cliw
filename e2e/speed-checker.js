#!/usr/bin/env node

/**
 * 端到端测试：首页 → 学习 / 术语表 导航速度门禁。
 *
 * 主指标：从首页点击桌面导航 → 目标页实际可用。
 * - /learning：learning-page 与封面均可用（封面已加载）
 * - /glossary：首个真实词条已渲染
 *
 * 流程：每条路径 1 次 warmup（不计分）+ 3 次测量，取中位数与 SPEED_BUDGET_MS 比较。
 * 任一路径中位数超预算即失败。
 *
 * 另含弱网反馈门禁：CDP 模拟 Slow 3G，断言点击后加载反馈在 FEEDBACK_BUDGET_MS 内可见。
 *
 * 用法:
 *   NODE_ENV=staging node speed-checker.js
 *   SPEED_BUDGET_MS=3000 NODE_ENV=production node speed-checker.js
 */

const { chromium } = require('playwright');
const { ENV, URLS } = require('./env');
const { assertPageMounted, READY_SELECTORS } = require('./assert-page-mounted');

const DEFAULT_BUDGET_MS = 3000;
const DEFAULT_FEEDBACK_BUDGET_MS = 300;
const WARMUP_RUNS = 1;
const SAMPLE_RUNS = 3;
const NAV_TIMEOUT_MS = 60000;
const READY_TIMEOUT_MS = 30000;
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

/** Chrome DevTools Protocol Slow 3G 近似值 */
const SLOW_3G = {
    offline: false,
    downloadThroughput: (500 * 1024) / 8,
    uploadThroughput: (500 * 1024) / 8,
    latency: 400,
};

const startUrl = URLS[ENV];

/**
 * 导航性能路径：从首页桌面导航点击到目标页就绪。
 * @typedef {{ id: string, navTestId: string, pathname: string, ready: (page: import('playwright').Page, timeout: number) => Promise<void>, chunkGlob: string }} NavSpeedPath
 */

/**
 * @param {string | undefined} raw
 * @param {number} [fallback]
 * @returns {number}
 */
function parseBudgetMs(raw, fallback = DEFAULT_BUDGET_MS) {
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`SPEED_BUDGET_MS 必须是正整数，收到: ${raw}`);
    }
    return value;
}

/**
 * @param {string | undefined} raw
 * @param {number} [fallback]
 * @returns {number}
 */
function parseFeedbackBudgetMs(raw, fallback = DEFAULT_FEEDBACK_BUDGET_MS) {
    if (raw === undefined || raw === '') {
        return fallback;
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`SPEED_FEEDBACK_BUDGET_MS 必须是正整数，收到: ${raw}`);
    }
    return value;
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function median(values) {
    if (!Array.isArray(values) || values.length === 0) {
        throw new Error('median 需要非空数组');
    }
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return sorted[mid];
}

/**
 * @param {number} medianMs
 * @param {number} budgetMs
 * @returns {boolean}
 */
function isWithinBudget(medianMs, budgetMs) {
    return medianMs <= budgetMs;
}

/**
 * 学习页就绪：主体与封面均可用（封面 complete 且 naturalWidth > 0）。
 * @param {import('playwright').Page} page
 * @param {number} timeout
 */
async function waitForLearningReady(page, timeout = READY_TIMEOUT_MS) {
    const { mounted, label } = await assertPageMounted(page, '/learning', { timeout });
    if (!mounted) {
        throw new Error(`学习页未在 ${timeout}ms 内挂载（等待 ${label}）`);
    }
    await page.waitForSelector(READY_SELECTORS.learningCover, { timeout });
    await page.waitForFunction(
        (coverSelector) => {
            const img = document.querySelector(coverSelector);
            return Boolean(img && img.complete && img.naturalWidth > 0);
        },
        READY_SELECTORS.learningCover,
        { timeout },
    );
}

/**
 * 术语表就绪：首个真实词条名已渲染。
 * @param {import('playwright').Page} page
 * @param {number} timeout
 */
async function waitForGlossaryReady(page, timeout = READY_TIMEOUT_MS) {
    await page.waitForSelector(READY_SELECTORS.glossaryFirstTerm, { timeout });
}

/** @type {NavSpeedPath[]} */
const NAV_SPEED_PATHS = [
    {
        id: 'home→learning',
        navTestId: 'navbar-link-navbar_learning',
        pathname: '/learning',
        chunkGlob: '**/assets/learning.*.js',
        ready: waitForLearningReady,
    },
    {
        id: 'home→glossary',
        navTestId: 'navbar-link-navbar_terminology_list',
        pathname: '/glossary',
        chunkGlob: '**/assets/glossary.*.js',
        ready: waitForGlossaryReady,
    },
];

/**
 * @param {import('playwright').Browser} browser
 * @param {string} homeUrl
 * @param {NavSpeedPath} path
 * @returns {Promise<number>}
 */
async function measureNavOnce(browser, homeUrl, path) {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();

    try {
        await page.goto(homeUrl, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
        const { mounted, label } = await assertPageMounted(page, '/', { timeout: READY_TIMEOUT_MS });
        if (!mounted) {
            throw new Error(`首页未在 ${READY_TIMEOUT_MS}ms 内挂载（等待 ${label}）`);
        }

        const navLink = page.getByTestId(path.navTestId);
        await navLink.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });

        const startedAt = Date.now();
        await navLink.click();
        await path.ready(page, READY_TIMEOUT_MS);
        return Date.now() - startedAt;
    } finally {
        await context.close();
    }
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} homeUrl
 * @param {NavSpeedPath} path
 * @param {number} budgetMs
 * @returns {Promise<{ id: string, warmupMs: number | null, samples: number[], medianMs: number, ok: boolean }>}
 */
async function measurePath(browser, homeUrl, path, budgetMs) {
    let warmupMs = null;
    const samples = [];

    for (let i = 0; i < WARMUP_RUNS; i += 1) {
        warmupMs = await measureNavOnce(browser, homeUrl, path);
        console.log(`  [${path.id}] warmup: ${warmupMs}ms`);
    }

    for (let i = 0; i < SAMPLE_RUNS; i += 1) {
        const ms = await measureNavOnce(browser, homeUrl, path);
        samples.push(ms);
        console.log(`  [${path.id}] sample[${i + 1}/${SAMPLE_RUNS}]: ${ms}ms`);
    }

    const medianMs = median(samples);
    const ok = isWithinBudget(medianMs, budgetMs);
    console.log(
        `[speed] ${path.id}: warmup=${warmupMs ?? 'n/a'}, samples=[${samples.join(', ')}], ` +
            `median=${medianMs}, budget=${budgetMs}`,
    );
    return { id: path.id, warmupMs, samples, medianMs, ok };
}

/**
 * Slow 3G 下测量点击后加载反馈出现耗时。
 * 延迟目标 chunk，确保即使空闲预取竞争也能观察到反馈。
 *
 * @param {import('playwright').Browser} browser
 * @param {string} homeUrl
 * @param {NavSpeedPath} path
 * @returns {Promise<number>}
 */
async function measureFeedbackOnce(browser, homeUrl, path) {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();

    try {
        const client = await context.newCDPSession(page);
        await client.send('Network.enable');
        await client.send('Network.emulateNetworkConditions', SLOW_3G);

        // 故意延迟命名 chunk，保证弱网下一定出现加载反馈
        await page.route(path.chunkGlob, async (route) => {
            await new Promise((resolve) => {
                setTimeout(resolve, 1500);
            });
            await route.continue();
        });

        await page.goto(homeUrl, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
        const { mounted, label } = await assertPageMounted(page, '/', { timeout: READY_TIMEOUT_MS });
        if (!mounted) {
            throw new Error(`首页未在 ${READY_TIMEOUT_MS}ms 内挂载（等待 ${label}）`);
        }

        const navLink = page.getByTestId(path.navTestId);
        await navLink.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });

        // 以浏览器内真正派发 click 的时刻作为起点。若在 Node 侧 click() 前计时，
        // CI 机器的调度或 Playwright 的 actionability 轮询会被算进「页面反馈」时长，
        // 即使 NProgress 已在事件处理器中同步插入也可能误报超时。
        await page.evaluate((navTestId) => {
            const navLink = document.querySelector(`[data-testid="${navTestId}"]`);
            if (!navLink) {
                throw new Error(`找不到导航链接: ${navTestId}`);
            }

            const measurement = {
                clickedAt: null,
                feedbackAt: null,
                observer: null,
            };
            window['__speedFeedbackMeasurement'] = measurement;

            navLink.addEventListener(
                'click',
                () => {
                    measurement.clickedAt = performance.now();
                },
                { capture: true, once: true },
            );

            measurement.observer = new MutationObserver(() => {
                if (measurement.feedbackAt !== null) {
                    return;
                }
                const spinner = document.querySelector('[data-testid="loading-spinner"]');
                const nprogress = document.querySelector('#nprogress');
                const nprogressVisible =
                    nprogress &&
                    window.getComputedStyle(nprogress).display !== 'none' &&
                    window.getComputedStyle(nprogress).opacity !== '0';
                if (spinner || nprogressVisible) {
                    measurement.feedbackAt = performance.now();
                    measurement.observer.disconnect();
                }
            });
            measurement.observer.observe(document.documentElement, { childList: true, subtree: true });
        }, path.navTestId);

        await navLink.click();

        await page.waitForFunction(
            () => {
                const measurement = window['__speedFeedbackMeasurement'];
                return measurement && measurement.clickedAt !== null && measurement.feedbackAt !== null;
            },
            { timeout: READY_TIMEOUT_MS },
        );

        return await page.evaluate(() => {
            const measurement = window['__speedFeedbackMeasurement'];
            if (!measurement || measurement.clickedAt === null || measurement.feedbackAt === null) {
                throw new Error('未记录到导航点击或加载反馈时间');
            }
            return measurement.feedbackAt - measurement.clickedAt;
        });
    } finally {
        await context.close();
    }
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} homeUrl
 * @param {number} feedbackBudgetMs
 * @returns {Promise<Array<{ id: string, feedbackMs: number, ok: boolean }>>}
 */
async function measureFeedbackPaths(browser, homeUrl, feedbackBudgetMs) {
    /** @type {Array<{ id: string, feedbackMs: number, ok: boolean }>} */
    const results = [];

    for (const path of NAV_SPEED_PATHS) {
        const feedbackMs = await measureFeedbackOnce(browser, homeUrl, path);
        const ok = isWithinBudget(feedbackMs, feedbackBudgetMs);
        console.log(`[speed-feedback] ${path.id}: feedback=${feedbackMs}ms, budget=${feedbackBudgetMs}ms`);
        results.push({ id: path.id, feedbackMs, ok });
    }

    return results;
}

async function run() {
    if (!startUrl) {
        console.error(`❌ [speed] 未知环境: ${ENV}`);
        process.exit(1);
    }

    const budgetMs = parseBudgetMs(process.env.SPEED_BUDGET_MS);
    const feedbackBudgetMs = parseFeedbackBudgetMs(process.env.SPEED_FEEDBACK_BUDGET_MS);

    console.log(`🚀 [speed] 正在测量 [${ENV}] 首页导航速度...`);
    console.log(`🔗 URL: ${startUrl}`);
    console.log(`⏱ 预算: ${budgetMs}ms（warmup=${WARMUP_RUNS}, samples=${SAMPLE_RUNS}）`);
    console.log(`👁 弱网反馈预算: ${feedbackBudgetMs}ms（Slow 3G）`);
    console.log(`🧭 路径: ${NAV_SPEED_PATHS.map((p) => p.id).join(', ')}`);

    const browser = await chromium.launch();
    /** @type {Array<{ id: string, warmupMs: number | null, samples: number[], medianMs: number, ok: boolean }>} */
    const results = [];
    /** @type {Array<{ id: string, feedbackMs: number, ok: boolean }>} */
    let feedbackResults = [];

    try {
        for (const path of NAV_SPEED_PATHS) {
            results.push(await measurePath(browser, startUrl, path, budgetMs));
        }
        feedbackResults = await measureFeedbackPaths(browser, startUrl, feedbackBudgetMs);
    } catch (err) {
        console.error(`❌ [speed] 测量失败: ${err.message}`);
        await browser.close();
        process.exit(1);
    }

    await browser.close();

    const failures = results.filter((r) => !r.ok);
    const feedbackFailures = feedbackResults.filter((r) => !r.ok);

    if (failures.length === 0 && feedbackFailures.length === 0) {
        for (const r of results) {
            console.log(`✅ [speed] ${r.id} within budget（median ${r.medianMs}ms ≤ ${budgetMs}ms）`);
        }
        for (const r of feedbackResults) {
            console.log(`✅ [speed-feedback] ${r.id} feedback ${r.feedbackMs}ms ≤ ${feedbackBudgetMs}ms`);
        }
        process.exit(0);
    }

    for (const r of failures) {
        console.error(`❌ [speed] ${r.id} median ${r.medianMs}ms > budget ${budgetMs}ms — 请优化导航加载`);
    }
    for (const r of feedbackFailures) {
        console.error(
            `❌ [speed-feedback] ${r.id} feedback ${r.feedbackMs}ms > budget ${feedbackBudgetMs}ms — 弱网下加载反馈出现过慢`,
        );
    }
    process.exit(1);
}

module.exports = {
    DEFAULT_BUDGET_MS,
    DEFAULT_FEEDBACK_BUDGET_MS,
    NAV_SPEED_PATHS,
    SLOW_3G,
    parseBudgetMs,
    parseFeedbackBudgetMs,
    median,
    isWithinBudget,
    waitForLearningReady,
    waitForGlossaryReady,
};

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
