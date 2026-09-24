#!/usr/bin/env node
const { chromium } = require('playwright');
const { GLOSSARY_SAMPLE_SIZE, isGlossaryDefinitionUrl, pickGlossarySample } = require('./glossary-sample');
const { assertPageMounted } = require('./assert-page-mounted');

/**
 * Playwright 深层链接检查器
 * - 爬取站内链接，确认可访问且 SPA 已按路由挂载
 * - 对词条详情页额外断言术语名、定义正文、返回链接
 * - CSP 违规会作为失败处理，防止安全策略上线后静默损坏页面
 */

const ENV = process.env.NODE_ENV || 'staging';
const URLS = {
    production: 'https://www.goplay.appcookies.com/',
    staging: require('./staging-url').stagingUrl(),
    development: 'http://localhost:8080/',
};

const startUrl = URLS[ENV];

// 与其他浏览器门禁一致：单次瞬时故障用全新 context 复验一次；复验失败仍硬失败。
const TRANSIENT_NAVIGATION_ATTEMPTS = 2;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const NAVIGATION_OPTIONS = { waitUntil: 'load', timeout: 60000 };

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransientNavigationError(error) {
    return (
        error instanceof Error &&
        /page\.goto: net::ERR_(?:TIMED_OUT|CONNECTION_CLOSED|CONNECTION_RESET)/.test(error.message)
    );
}

/**
 * @param {number | null} status
 * @returns {boolean}
 */
function isTransientHttpStatus(status) {
    return status !== null && TRANSIENT_HTTP_STATUSES.has(status);
}

/**
 * 用独立 context 打开并验证一个页面，避免失败导航残留状态污染后续页面。
 *
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {(message: import('playwright').ConsoleMessage) => void} [onConsole]
 */
async function openMountedPageOnce(browser, url, onConsole) {
    const context = await browser.newContext();

    try {
        const page = await context.newPage();
        if (onConsole) {
            page.on('console', onConsole);
        }

        const response = await page.goto(url, NAVIGATION_OPTIONS);
        const status = response === null ? null : response.status();
        let mounted = null;
        let label = null;

        if ((response !== null || url.includes('#')) && (status === null || status < 400)) {
            const mountResult = await assertPageMounted(page, new URL(url).pathname);
            mounted = mountResult.mounted;
            label = mountResult.label;
        }

        return { context, page, response, status, mounted, label };
    } catch (error) {
        await context.close();
        throw error;
    }
}

/**
 * 只复验可恢复的传输/服务端故障，以及首次未挂载（常见于应用资源瞬时失败）。
 * 404、内容缺失等确定性结果不会重试，避免把真实回归变成偶发通过。
 *
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {(message: import('playwright').ConsoleMessage) => void} [onConsole]
 * @param {typeof openMountedPageOnce} [openOnce]
 */
function navigationRetryReason(result) {
    if (isTransientHttpStatus(result.status)) return `HTTP ${result.status}`;
    if (result.mounted === false) return `未找到 ${result.label}`;
    return null;
}

async function performNavigationAttempt(browser, url, onConsole, openOnce, attempt) {
    try {
        const result = await openOnce(browser, url, onConsole);
        const retryReason = navigationRetryReason(result);
        if (retryReason === null || attempt === TRANSIENT_NAVIGATION_ATTEMPTS) return { result };
        await result.context.close();
        console.log(`  [PLAYWRIGHT] ${retryReason}，使用干净页面重试 ${attempt}/${TRANSIENT_NAVIGATION_ATTEMPTS - 1}`);
        return {};
    } catch (error) {
        if (!isTransientNavigationError(error) || attempt === TRANSIENT_NAVIGATION_ATTEMPTS) {
            return { result: { error } };
        }
        console.log(
            `  [PLAYWRIGHT] 瞬时导航失败，使用干净页面重试 ${attempt}/${TRANSIENT_NAVIGATION_ATTEMPTS - 1}: ${error.message}`,
        );
        return {};
    }
}

async function openMountedPageWithRetry(browser, url, onConsole, openOnce = openMountedPageOnce) {
    for (let attempt = 1; attempt <= TRANSIENT_NAVIGATION_ATTEMPTS; attempt += 1) {
        const { result } = await performNavigationAttempt(browser, url, onConsole, openOnce, attempt);
        if (result) return result;
    }
    return { error: new Error(`无法打开页面: ${url}`) };
}

function isCspViolationMessage(text) {
    // Chromium 会把 Report-Only 中不生效的 upgrade-insecure-requests 记为 error；
    // 这是模式说明而非资源违规，且该指令本就不会被渲染进 report-only 策略。
    if (/upgrade-insecure-requests[^.]*ignored[^.]*report-only policy/i.test(text)) {
        return false;
    }

    return (
        /violates? the following content security policy directive/i.test(text) ||
        /content-security-policy:[^\n]*(?:blocked|refused)/i.test(text) ||
        /(?:blocked|refused)[^\n]*content security policy/i.test(text)
    );
}

/**
 * Chromium 会把 enforce 违规记为 error，却可能把 Report-Only 违规记为 info。
 * CSP 是否违规必须由消息正文判断，不能用控制台级别做前置过滤。
 */
function isCspViolationConsoleMessage(_consoleType, text) {
    return isCspViolationMessage(text);
}

/**
 * 词条详情页深度断言：术语名、定义正文、返回链接均已渲染。
 * @returns {Promise<number>} 发现的问题数
 */
async function assertGlossaryDefinition(page, url) {
    try {
        await page.waitForSelector('[data-testid="definition-term-name"]', {
            timeout: 15000,
        });
    } catch {
        console.error(`❌ [词条渲染] ${url} (未找到 definition-term-name)`);
        return 1;
    }

    const content = await page.evaluate(() => {
        const name = document.querySelector('[data-testid="definition-term-name"]');
        const body = document.querySelector('[data-testid="definition-body"]');
        const goBack = document.querySelector('[data-testid="definition-go-back"]');
        const goBackLink = goBack ? goBack.closest('a') : null;
        let goBackPath = null;
        if (goBackLink) {
            try {
                goBackPath = new URL(goBackLink.href, window.location.origin).pathname;
            } catch {
                goBackPath = goBackLink.getAttribute('href');
            }
        }

        return {
            nameText: name ? name.textContent.trim() : '',
            bodyText: body ? body.textContent.trim() : '',
            hasGoBack: !!goBack,
            goBackPath,
        };
    });

    const pageIssues = [];
    if (!content.nameText) {
        pageIssues.push('definition-term-name 为空');
    }
    if (!content.bodyText) {
        pageIssues.push('definition-body 为空');
    }
    if (!content.hasGoBack) {
        pageIssues.push('缺少 definition-go-back');
    } else if (content.goBackPath !== '/glossary') {
        pageIssues.push(`返回链接为 ${content.goBackPath}，期望 /glossary`);
    }

    if (pageIssues.length > 0) {
        for (const issue of pageIssues) {
            console.error(`❌ [词条渲染] ${url}: ${issue}`);
        }
        return pageIssues.length;
    }

    console.log(`   📚 词条内容正常: ${content.nameText}`);
    return 0;
}

async function checkBinaryUrl(url) {
    try {
        const headResponse = await fetch(url, { method: 'HEAD' });
        if (headResponse.ok) {
            console.log(`✅ [静态资源] ${url}`);
            return 0;
        }
        const getResponse = await fetch(url);
        if (getResponse.ok) {
            console.log(`✅ [静态资源] ${url}`);
            return 0;
        }
        console.error(`❌ [${getResponse.status}] ${url}`);
    } catch (e) {
        console.error(`❌ [请求错误] ${url}: ${e.message}`);
    }
    return 1;
}

function validateNavigationResult(visit, url) {
    if (visit.error) {
        const message = visit.error instanceof Error ? visit.error.message : String(visit.error);
        console.error(`❌ [错误] ${url}: ${message}`);
        return 1;
    }
    if (visit.response === null && !url.includes('#')) {
        console.error(`❌ [请求失败] ${url} (无响应)`);
        return 1;
    }
    if (visit.response !== null && visit.status >= 400) {
        console.error(`❌ [${visit.status}] ${url}`);
        return 1;
    }
    if (!visit.mounted) {
        console.error(`❌ [渲染错误] ${url} (未找到 ${visit.label})`);
        return 1;
    }
    return 0;
}

async function inspectGlossaryList(page, url) {
    try {
        await page.waitForSelector('[data-testid^="glossary-term-"]', { timeout: 15000 });
        return 0;
    } catch {
        console.error(`❌ [术语列表] ${url} (未找到 glossary-term 链接)`);
        return 1;
    }
}

async function inspectSpecializedPage(page, url, dependencies = {}) {
    const pathname = new URL(url).pathname;
    const inspectList = dependencies.inspectGlossaryList || inspectGlossaryList;
    const inspectDefinition = dependencies.assertGlossaryDefinition || assertGlossaryDefinition;
    if (pathname === '/glossary') return inspectList(page, url);
    if (isGlossaryDefinitionUrl(url)) return inspectDefinition(page, url);
    return 0;
}

async function readPageLinks(page) {
    return page.evaluate(() =>
        Array.from(document.querySelectorAll('a'))
            .map((a) => a.href)
            .filter((href) => href.startsWith('http')),
    );
}

function classifyPageLinks(links, internalStartUrl, enqueueInternalLink) {
    for (const link of links) {
        if (link.startsWith(internalStartUrl)) enqueueInternalLink(link);
        else console.log(`   -> 外部链接: ${link}`);
    }
}

async function closePageContext(visit, url) {
    if (!visit?.context) return 0;
    try {
        await visit.context.close();
        return 0;
    } catch (e) {
        console.error(`❌ [错误] ${url}: 无法关闭浏览器 context: ${e.message}`);
        return 1;
    }
}

async function inspectMountedPage(
    browser,
    url,
    captureCspViolation,
    enqueueInternalLink,
    enqueueGlossarySample,
    dependencies = {},
) {
    let visit;
    let issues = 0;
    const openPage = dependencies.openMountedPageWithRetry || openMountedPageWithRetry;
    const inspectSpecialized = dependencies.inspectSpecializedPage || inspectSpecializedPage;
    const readLinks = dependencies.readPageLinks || readPageLinks;
    const internalStartUrl = dependencies.startUrl || startUrl;
    try {
        visit = await openPage(browser, url, captureCspViolation);
        issues = validateNavigationResult(visit, url);
        if (issues === 0) issues = await inspectSpecialized(visit.page, url, dependencies);
        if (issues === 0) {
            console.log(`✅ [正常] ${url}`);
            classifyPageLinks(await readLinks(visit.page), internalStartUrl, enqueueInternalLink);
            if (new URL(url).pathname === '/glossary') enqueueGlossarySample();
        }
    } catch (e) {
        console.error(`❌ [错误] ${url}: ${e.message}`);
        issues += 1;
    }
    issues += await closePageContext(visit, url);
    return issues;
}

function createCrawlState(internalStartUrl = startUrl) {
    return {
        startUrl: internalStartUrl,
        visited: new Set(),
        queue: [internalStartUrl, new URL('/tutorial', internalStartUrl).href],
        glossaryLinksPool: new Set(),
        glossarySampleEnqueued: false,
        issues: 0,
        cspViolations: new Set(),
    };
}

function createCspConsoleCollector(state) {
    return (message) => {
        const text = message.text();
        if (isCspViolationConsoleMessage(message.type(), text)) state.cspViolations.add(text);
    };
}

function enqueueGlossarySample(state, samplePicker = pickGlossarySample) {
    if (state.glossarySampleEnqueued) return;
    state.glossarySampleEnqueued = true;
    if (state.glossaryLinksPool.size === 0) {
        console.error('❌ [术语抽查] 术语链接池为空（仍入队必测 slug）');
        state.issues += 1;
    }
    const sampled = samplePicker([...state.glossaryLinksPool], GLOSSARY_SAMPLE_SIZE, {
        origin: new URL(state.startUrl).origin,
    });
    console.log(
        `📚 术语抽查 ${sampled.length} 个（必测 + 随机补充，上限 ${GLOSSARY_SAMPLE_SIZE}；池 ${state.glossaryLinksPool.size}）`,
    );
    for (const link of sampled) {
        if (!state.visited.has(link)) state.queue.push(link);
    }
}

function enqueueInternalLink(state, link) {
    if (state.visited.has(link)) return;
    if (isGlossaryDefinitionUrl(link)) state.glossaryLinksPool.add(link);
    else state.queue.push(link);
}

async function inspectQueueItem(state, browser, url, dependencies) {
    const inspectBinary = dependencies.checkBinaryUrl || checkBinaryUrl;
    const inspectPage = dependencies.inspectMountedPage || inspectMountedPage;
    if (/\.(apk|png|jpg|jpeg|gif|pdf|zip)$/i.test(url)) return inspectBinary(url);
    return inspectPage(
        browser,
        url,
        dependencies.captureCspViolation,
        (link) => enqueueInternalLink(state, link),
        () => enqueueGlossarySample(state, dependencies.pickGlossarySample),
        { ...dependencies.pageDependencies, startUrl: state.startUrl },
    );
}

function takeNextQueueItem(state, samplePicker) {
    if (state.queue.length === 0) enqueueGlossarySample(state, samplePicker);
    return state.queue.shift();
}

async function crawl(state, browser, dependencies = {}) {
    const runtime = { ...dependencies, captureCspViolation: createCspConsoleCollector(state) };
    while (state.queue.length > 0 || !state.glossarySampleEnqueued) {
        const url = takeNextQueueItem(state, dependencies.pickGlossarySample);
        if (url === undefined) break;
        if (state.visited.has(url)) continue;
        state.visited.add(url);
        console.log(`🔎 正在检查: ${url}`);
        state.issues += await inspectQueueItem(state, browser, url, runtime);
    }
}

function summarizeCrawl(state) {
    for (const violation of state.cspViolations) console.error(`❌ [CSP] ${violation}`);
    state.issues += state.cspViolations.size;
    console.log('\n🏁 [PLAYWRIGHT] 检查完成。');
    console.log(`✅ 已检查链接总数: ${state.visited.size}`);
    if (state.glossaryLinksPool.size > 0) {
        console.log(`📚 术语页面池: ${state.glossaryLinksPool.size} 个，已抽查（含必测 slug）`);
    }
    console.log(`⚠️ 发现的问题数: ${state.issues}`);
    return state.issues;
}

async function run(dependencies = {}) {
    const runtimeStartUrl = dependencies.startUrl || startUrl;
    const launch = dependencies.launch || (() => chromium.launch());
    const exit = dependencies.exit || process.exit;
    const state = dependencies.state || createCrawlState(runtimeStartUrl);
    console.log(`🚀 [PLAYWRIGHT] 正在为 [${ENV}] 启动深层链接检查器...`);
    console.log(`🔗 目标 URL: ${runtimeStartUrl}`);

    let browser;
    try {
        browser = await launch();
        await crawl(state, browser, dependencies);
    } finally {
        if (browser) await browser.close();
    }
    const issues = summarizeCrawl(state);
    exit(issues > 0 ? 1 : 0);
    return issues;
}

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}

module.exports = {
    NAVIGATION_OPTIONS,
    TRANSIENT_NAVIGATION_ATTEMPTS,
    isTransientNavigationError,
    isTransientHttpStatus,
    openMountedPageWithRetry,
    isCspViolationConsoleMessage,
    isCspViolationMessage,
    validateNavigationResult,
    inspectSpecializedPage,
    classifyPageLinks,
    closePageContext,
    inspectMountedPage,
    createCrawlState,
    createCspConsoleCollector,
    enqueueGlossarySample,
    enqueueInternalLink,
    inspectQueueItem,
    crawl,
    summarizeCrawl,
    run,
};
