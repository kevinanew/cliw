#!/usr/bin/env node
const { chromium } = require('playwright');
const { ENV, URLS } = require('./env');

/**
 * 端到端测试：验证首页安卓 APK 下载按钮存在，
 * 并且下载 APK 文件的头部能够返回有效的 ZIP 魔法字节（magic bytes）。
 *
 * 额外门禁：下载按钮必须在预算时间内出现（不能只检查「最终能下」）。
 * 流程与 speed-checker 对齐：1 次 warmup + 3 次测量，取中位数与预算比较。
 *
 * 用法:
 *   NODE_ENV=staging node apk-checker.js
 *   APK_READY_BUDGET_MS=3000 NODE_ENV=production node apk-checker.js
 *   SPEED_BUDGET_MS=3000 也可作为预算回退（与导航速度门禁共用）
 */

const startUrl = URLS[ENV];
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const APK_LINK_SELECTOR = 'a[data-testid="download-button-icon-link"][href*=".apk"]';
const DEFAULT_BUDGET_MS = 3000;
const WARMUP_RUNS = 1;
const SAMPLE_RUNS = 3;
const NAV_TIMEOUT_MS = 60000;
const READY_TIMEOUT_MS = 30000;
const TRANSIENT_ATTEMPTS = 2;
const TRANSIENT_NAVIGATION_ERROR = Symbol('transient-navigation-error');
const APK_FILENAME_PATTERN = /^[\w\u4e00-\u9fff.-]+\.apk$/i;
const MIN_APK_SIZE_BYTES = 50 * 1024 * 1024;
const ZIP_MAGIC = '504b0304';

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
        throw new Error(`APK_READY_BUDGET_MS 必须是正整数，收到: ${raw}`);
    }
    return value;
}

/**
 * 优先 APK_READY_BUDGET_MS，其次 SPEED_BUDGET_MS，最后默认 3000。
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {number}
 */
function resolveApkReadyBudgetMs(env = process.env) {
    if (env.APK_READY_BUDGET_MS !== undefined && env.APK_READY_BUDGET_MS !== '') {
        return parseBudgetMs(env.APK_READY_BUDGET_MS);
    }
    if (env.SPEED_BUDGET_MS !== undefined && env.SPEED_BUDGET_MS !== '') {
        return parseBudgetMs(env.SPEED_BUDGET_MS);
    }
    return DEFAULT_BUDGET_MS;
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

async function dumpDiagnostics(page) {
    const hrefs = await page
        .locator('a[data-testid="download-button-icon-link"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href')))
        .catch(() => []);
    const versionText = await page
        .locator('[data-testid="home-version-text"]')
        .textContent()
        .catch(() => null);
    const homeTitle = await page
        .locator('[data-testid="home-title"]')
        .textContent()
        .catch(() => null);

    console.error('—— 诊断信息 ——');
    console.error(`home-title: ${homeTitle ?? '(未找到)'}`);
    console.error(`home-version-text: ${versionText ?? '(未找到)'}`);
    console.error(`download-button hrefs: ${JSON.stringify(hrefs)}`);
}

/**
 * 导航前开始监听，避免错过 React 挂载后立即发出的 APK 清单请求。
 * 同时立即处理等待超时：导航或首页挂载可能与该等待并行超过 30 秒，若等到之后
 * 才附加 catch，Node 会先把 Playwright 的 rejection 当成未处理异常并终止进程。
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<import('playwright').Response | null>}
 */
function waitForApkIndexResponse(page) {
    return page
        .waitForResponse((resp) => /\/apk\/index\.json(?:\?|$)/.test(resp.url()) && resp.ok(), {
            timeout: READY_TIMEOUT_MS,
        })
        .catch(() => null);
}

/**
 * 测量：首页 UI 就绪后，到 APK 本地下载链接可见的耗时（毫秒）。
 * 对应用户看到「正在获取版本信息...」后还需等待多久才能下载。
 * 每次使用干净 context，避免 sessionStorage 缓存掩盖首次出现过慢。
 * @param {import('playwright').Browser} browser
 * @param {string} homeUrl
 * @returns {Promise<{ readyMs: number, apkUrl: string, indexCacheStatus: string, indexContentEncoding: string }>}
 */
async function measureApkReadyOnce(browser, homeUrl) {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT });
    const page = await context.newPage();

    try {
        const indexResponsePromise = waitForApkIndexResponse(page);

        try {
            await page.goto(homeUrl, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS });
        } catch (error) {
            if (
                error instanceof Error &&
                (error.name === 'TimeoutError' ||
                    /net::ERR_(?:TIMED_OUT|CONNECTION_CLOSED|CONNECTION_RESET)/.test(error.message))
            ) {
                error[TRANSIENT_NAVIGATION_ERROR] = true;
            }
            throw error;
        }
        await page.waitForSelector('[data-testid="home-title"]', { timeout: READY_TIMEOUT_MS });

        // 从首页主 UI 出现起算：不把整页 JS 下载算进「版本信息过慢」
        const startedAt = Date.now();
        const apkLocator = page.locator(APK_LINK_SELECTOR);

        const indexResponse = await indexResponsePromise.catch(() => null);
        if (!indexResponse) {
            await dumpDiagnostics(page);
            throw new Error('apk/index.json 请求未在超时内成功完成。');
        }

        const indexCacheStatus = indexResponse.headers()['x-apk-index-cache'] || '';
        const indexContentEncoding = indexResponse.headers()['content-encoding'] || '';

        // 响应头断言：/apk/index.json 是版本清单，新版本会更新版本号与下载 URL，
        // 因此绝不能被缓存为 immutable（配合 default.conf.template 中的 no-cache 配置）。
        const indexCacheControl = indexResponse.headers()['cache-control'] || '';
        if (/immutable/i.test(indexCacheControl)) {
            throw new Error(`apk/index.json 的 Cache-Control 不应为 immutable，实际: "${indexCacheControl}"`);
        }
        // 上游对象存储常错误地带 aws-chunked；反代必须剥掉后再给浏览器。
        if (/aws-chunked/i.test(indexContentEncoding)) {
            throw new Error(
                `apk/index.json 不应再向浏览器暴露 Content-Encoding: aws-chunked，实际: "${indexContentEncoding}"`,
            );
        }

        await apkLocator.waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
        const readyMs = Date.now() - startedAt;

        const relativeHref = await apkLocator.getAttribute('href');
        if (!relativeHref) {
            throw new Error('APK 下载链接没有 href 属性。');
        }

        const apkUrl = new URL(relativeHref, page.url()).toString();
        return { readyMs, apkUrl, indexCacheStatus, indexContentEncoding };
    } finally {
        await context.close();
    }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransientMeasurementError(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    return error[TRANSIENT_NAVIGATION_ERROR] === true || error.message === 'apk/index.json 请求未在超时内成功完成。';
}

/**
 * 性能样本必须来自完整、干净的页面加载。传输层瞬时失败时重新创建 context 测量一次；
 * 缓存头、内容编码和链接合法性等确定性断言不会被重试掩盖。
 *
 * @param {import('playwright').Browser} browser
 * @param {string} homeUrl
 * @param {(browser: import('playwright').Browser, homeUrl: string) => Promise<{ readyMs: number, apkUrl: string, indexCacheStatus: string, indexContentEncoding: string }>} [measure]
 * @returns {Promise<{ readyMs: number, apkUrl: string, indexCacheStatus: string, indexContentEncoding: string }>}
 */
async function measureApkReadyWithRetry(browser, homeUrl, measure = measureApkReadyOnce) {
    for (let attempt = 1; attempt <= TRANSIENT_ATTEMPTS; attempt += 1) {
        try {
            return await measure(browser, homeUrl);
        } catch (error) {
            if (!isTransientMeasurementError(error) || attempt === TRANSIENT_ATTEMPTS) {
                throw error;
            }
            console.log(`  [apk-ready] 瞬时加载失败，重试 ${attempt}/${TRANSIENT_ATTEMPTS - 1}: ${error.message}`);
        }
    }
}

function parseAndAssertApkFilename(apkUrl) {
    // 白名单：与前端 useApkDownloadUrl / apkDownloadUrlCache 一致
    const apkFilename = decodeURIComponent(new URL(apkUrl).pathname.split('/').pop() || '');
    if (!APK_FILENAME_PATTERN.test(apkFilename)) {
        throw new Error(`APK 文件名未通过白名单校验（拒绝非 .apk / 非法字符）: ${apkFilename}`);
    }
    return apkFilename;
}

function parseNumericHeader(value) {
    if (!/^\d+$/.test(value || '')) {
        return null;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseApkSize(headers) {
    const contentRange = headers.get('content-range');
    const rangeMatch = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i);
    if (rangeMatch) {
        const [first, last, total] = rangeMatch.slice(1).map(parseNumericHeader);
        const hasValidBounds = first !== null && last !== null && total !== null && first <= last && last < total;
        if (hasValidBounds && first === 0 && last === 3) {
            return total;
        }
    }

    return parseNumericHeader(headers.get('content-length'));
}

function assertMinimumApkSize(totalSize) {
    if (totalSize === null) {
        throw new Error('无法从响应头（Content-Range 或 Content-Length）获取 APK 文件大小。');
    }

    const sizeInMb = (totalSize / (1024 * 1024)).toFixed(2);
    console.log(`APK 文件大小为: ${sizeInMb} MB (${totalSize} 字节)`);
    if (totalSize < MIN_APK_SIZE_BYTES) {
        throw new Error(`APK 文件过小。预期至少为: 50 MB, 实际大小为: ${sizeInMb} MB`);
    }
    console.log('✅ [成功] APK 文件大小校验通过，已超过 50 MB。');
}

async function readFirstFourBytes(body) {
    if (!body) {
        throw new Error('未能从响应中读取到至少 4 个字节。');
    }

    const reader = body.getReader();
    let value;
    try {
        ({ value } = await reader.read());
    } finally {
        await reader.cancel(); // 取消标准流，避免拉取完整文件体
    }

    if (!value || value.length < 4) {
        throw new Error('未能从响应中读取到至少 4 个字节。');
    }
    return value.subarray(0, 4);
}

function assertZipMagic(bytes) {
    const headerHex = Buffer.from(bytes.buffer, bytes.byteOffset, 4).toString('hex');
    if (headerHex !== ZIP_MAGIC) {
        throw new Error(`APK 魔法字节预期值: ${ZIP_MAGIC}, 实际值: ${headerHex}`);
    }
    return headerHex;
}

/**
 * @param {string} apkUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<void>}
 */
async function assertApkBinaryHealthy(apkUrl, fetchImpl = fetch) {
    const apkFilename = parseAndAssertApkFilename(apkUrl);
    console.log(`✅ [成功] APK 文件名白名单校验通过: ${apkFilename}`);

    // 仅下载文件头部（前 4 字节）
    // PK\x03\x04 的十六进制表示为 504b0304
    console.log('正在获取 APK 文件头部以进行校验...');
    const response = await fetchImpl(apkUrl, {
        headers: {
            Range: 'bytes=0-3',
        },
    });

    if (!response.ok) {
        throw new Error(`HTTP 请求错误: ${response.status} ${response.statusText}`);
    }

    assertMinimumApkSize(parseApkSize(response.headers));
    const headerHex = assertZipMagic(await readFirstFourBytes(response.body));
    console.log(`✅ [成功] APK 文件校验全部通过。魔法字节为: ${headerHex} (PK\\x03\\x04) 且文件大小超过 50MB。`);
}

async function run() {
    if (!startUrl) {
        console.error(`❌ [apk] 未知环境: ${ENV}`);
        process.exit(1);
    }

    const budgetMs = resolveApkReadyBudgetMs();
    console.log(`🚀 [E2E] 正在检查 [${ENV}] 环境下的 APK 下载链接...`);
    console.log(`🔗 目标 URL: ${startUrl}`);
    console.log(`⏱ APK 就绪预算: ${budgetMs}ms（warmup=${WARMUP_RUNS}, samples=${SAMPLE_RUNS}）`);

    const browser = await chromium.launch();
    let success = false;

    try {
        /** @type {number | null} */
        let warmupMs = null;
        const samples = [];
        /** @type {string} */
        let apkUrl = '';

        for (let i = 0; i < WARMUP_RUNS; i += 1) {
            const result = await measureApkReadyWithRetry(browser, startUrl);
            warmupMs = result.readyMs;
            apkUrl = result.apkUrl;
            console.log(
                `  [apk-ready] warmup: ${result.readyMs}ms ` +
                    `(cache=${result.indexCacheStatus || '(无)'}, encoding=${result.indexContentEncoding || '(无)'})`,
            );
        }

        for (let i = 0; i < SAMPLE_RUNS; i += 1) {
            const result = await measureApkReadyWithRetry(browser, startUrl);
            samples.push(result.readyMs);
            apkUrl = result.apkUrl;
            console.log(
                `  [apk-ready] sample[${i + 1}/${SAMPLE_RUNS}]: ${result.readyMs}ms ` +
                    `(cache=${result.indexCacheStatus || '(无)'}, encoding=${result.indexContentEncoding || '(无)'})`,
            );
        }

        const medianMs = median(samples);
        const withinBudget = isWithinBudget(medianMs, budgetMs);
        console.log(
            `[apk-ready] warmup=${warmupMs ?? 'n/a'}, samples=[${samples.join(', ')}], ` +
                `median=${medianMs}, budget=${budgetMs}`,
        );

        if (!withinBudget) {
            throw new Error(
                `APK 下载按钮出现过慢：median ${medianMs}ms > budget ${budgetMs}ms。` +
                    '请检查 /apk/index.json 反代缓存与上游 CDN 延迟。',
            );
        }
        console.log(`✅ [apk-ready] within budget（median ${medianMs}ms ≤ ${budgetMs}ms）`);
        console.log(`找到 APK 下载 URL: ${apkUrl}`);

        await assertApkBinaryHealthy(apkUrl);
        success = true;
    } catch (e) {
        console.error(`❌ [错误] APK 校验失败: ${e.message}`);
    } finally {
        await browser.close();
    }

    process.exit(success ? 0 : 1);
}

module.exports = {
    DEFAULT_BUDGET_MS,
    WARMUP_RUNS,
    SAMPLE_RUNS,
    parseBudgetMs,
    resolveApkReadyBudgetMs,
    median,
    isWithinBudget,
    waitForApkIndexResponse,
    isTransientMeasurementError,
    measureApkReadyWithRetry,
    parseAndAssertApkFilename,
    parseApkSize,
    assertMinimumApkSize,
    readFirstFourBytes,
    assertZipMagic,
    assertApkBinaryHealthy,
};

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
