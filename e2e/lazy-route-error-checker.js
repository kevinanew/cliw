#!/usr/bin/env node

/**
 * 端到端：懒加载路由 chunk 失败时显示「重试」，网络恢复后可以重新打开目标页面。
 *
 * 用 Playwright route.abort() 模拟 /glossary、/learning 对应命名 chunk 请求失败，
 * 断言出现 [data-testid="route-load-error"] / route-load-retry，而不是白屏或进度条永久卡住。
 * 随后解除拦截并真实点击重试，确认目标内容恢复、错误与加载提示消失。
 *
 * 用法:
 *   NODE_ENV=staging node lazy-route-error-checker.js
 *   NODE_ENV=development node lazy-route-error-checker.js
 */

const { chromium } = require('playwright');
const { expect } = require('@playwright/test');
const { ENV, URLS } = require('./env');
const { assertPageMounted } = require('./assert-page-mounted');

const NAV_TIMEOUT_MS = 60000;
const READY_TIMEOUT_MS = 30000;
const ERROR_TIMEOUT_MS = 20000;
const INITIAL_NAV_ATTEMPTS = 2;
const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

const startUrl = URLS[ENV];

/** @type {Array<{ id: string, navTestId: string, pathname: string, chunkGlob: string }>} */
const FAIL_PATHS = [
    {
        id: 'glossary-chunk-abort',
        navTestId: 'navbar-link-navbar_terminology_list',
        pathname: '/glossary',
        chunkGlob: '**/assets/glossary.*.js',
    },
    {
        id: 'learning-chunk-abort',
        navTestId: 'navbar-link-navbar_learning',
        pathname: '/learning',
        chunkGlob: '**/assets/learning.*.js',
    },
];

/**
 * @param {import('playwright').Page} page
 * @param {string} chunkGlob
 */
async function abortNamedChunk(page, chunkGlob) {
    await page.route(chunkGlob, async (route) => {
        await route.abort('failed');
    });
}

/**
 * 初始入口请求发生代理超时时，应用与本测试要验证的懒加载逻辑都尚未执行。
 * 仅重试这一步一次；挂载断言连续失败仍会使门禁失败。
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {string} pathname
 * @param {(page: import('playwright').Page, pathname: string, options: { timeout: number }) => Promise<{ mounted: boolean, label: string }>} [mountAssertion]
 * @returns {Promise<void>}
 */
async function navigateToMountedPage(page, url, pathname, mountAssertion = assertPageMounted) {
    let lastError;

    for (let attempt = 1; attempt <= INITIAL_NAV_ATTEMPTS; attempt += 1) {
        try {
            await page.goto(url, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
            const { mounted, label } = await mountAssertion(page, pathname, { timeout: READY_TIMEOUT_MS });
            if (mounted) {
                return;
            }
            lastError = new Error(`首页未在 ${READY_TIMEOUT_MS}ms 内挂载（等待 ${label}）`);
        } catch (error) {
            lastError = error;
        }

        if (attempt < INITIAL_NAV_ATTEMPTS) {
            console.log(`   初始导航失败，重试 ${attempt}/${INITIAL_NAV_ATTEMPTS - 1}: ${lastError.message}`);
        }
    }

    throw lastError;
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} homeUrl
 * @param {(typeof FAIL_PATHS)[number]} path
 * @returns {Promise<void>}
 */
async function assertRetryUiOnChunkFailure(browser, homeUrl, path) {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();

    try {
        await abortNamedChunk(page, path.chunkGlob);

        await navigateToMountedPage(page, homeUrl, '/');

        const navLink = page.getByTestId(path.navTestId);
        await navLink.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
        await navLink.click();

        const errorRoot = page.getByTestId('route-load-error');
        await errorRoot.waitFor({ state: 'visible', timeout: ERROR_TIMEOUT_MS });

        const retryButton = page.getByTestId('route-load-retry');
        await retryButton.waitFor({ state: 'visible', timeout: 5000 });

        const nprogressHidden = await page.evaluate(() => {
            const el = document.querySelector('#nprogress');
            if (!el) {
                return true;
            }
            const style = window.getComputedStyle(el);
            return style.display === 'none' || style.opacity === '0' || el.getAttribute('aria-hidden') === 'true';
        });

        if (!nprogressHidden) {
            // 允许短暂残留，但不应在错误 UI 出现后仍卡在「进行中」主条
            const barActive = await page.evaluate(() => {
                const bar = document.querySelector('#nprogress .bar');
                return Boolean(bar) && window.getComputedStyle(bar).display !== 'none';
            });
            if (barActive) {
                // 再等一小会儿让 ErrorBoundary 的 done() 生效
                await new Promise((resolve) => {
                    setTimeout(resolve, 500);
                });
                const stillActive = await page.evaluate(() => {
                    const el = document.querySelector('#nprogress');
                    if (!el) {
                        return false;
                    }
                    const style = window.getComputedStyle(el);
                    return style.display !== 'none' && style.opacity !== '0';
                });
                if (stillActive) {
                    throw new Error(`[${path.id}] 出现重试 UI 后 NProgress 仍未收尾`);
                }
            }
        }

        // 只恢复网络，不主动刷新或重新导航，确保真正验证站点的重试按钮。
        await page.unroute(path.chunkGlob);
        await retryButton.click({ timeout: READY_TIMEOUT_MS });
        await expect(page).toHaveURL((url) => url.pathname === path.pathname, { timeout: READY_TIMEOUT_MS });

        const { mounted, label } = await assertPageMounted(page, path.pathname, { timeout: READY_TIMEOUT_MS });
        if (!mounted) {
            throw new Error(`[${path.id}] 点击重试后目标页面未恢复（等待 ${label}）`);
        }
        await expect(errorRoot).toBeHidden({ timeout: READY_TIMEOUT_MS });
        await expect(retryButton).toBeHidden({ timeout: READY_TIMEOUT_MS });
        await expect(page.getByTestId('loading-spinner')).toBeHidden({ timeout: READY_TIMEOUT_MS });
        await expect(page.getByTestId('boot-loading')).toBeHidden({ timeout: READY_TIMEOUT_MS });

        console.log(`✅ [lazy-route-error] ${path.id}: 错误提示可见，点击重试后目标页面恢复`);
    } finally {
        await context.close();
    }
}

async function run() {
    if (!startUrl) {
        console.error(`❌ [lazy-route-error] 未知环境: ${ENV}`);
        process.exit(1);
    }

    console.log(`🚀 [lazy-route-error] 正在校验 [${ENV}] 懒加载失败兜底...`);
    console.log(`🔗 URL: ${startUrl}`);

    const browser = await chromium.launch();

    try {
        for (const path of FAIL_PATHS) {
            await assertRetryUiOnChunkFailure(browser, startUrl, path);
        }
    } catch (err) {
        console.error(`❌ [lazy-route-error] ${err.message}`);
        await browser.close();
        process.exit(1);
    }

    await browser.close();
    console.log('✅ [lazy-route-error] 全部路径通过');
    process.exit(0);
}

module.exports = {
    FAIL_PATHS,
    abortNamedChunk,
    navigateToMountedPage,
};

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
