#!/usr/bin/env node
/**
 * E2E：axe-core 无障碍运行时扫描
 * - 对首页等关键静态页注入 axe，按 WCAG 2/2.1 A+AA 规则扫描
 * - 任一 violation 即失败（门禁）
 */

const { AxeBuilder } = require('@axe-core/playwright');
const { chromium } = require('playwright');
const { assertPageMounted } = require('./assert-page-mounted');
const { ENV, URLS } = require('./env');
const { STATIC_PATHS } = require('./site-contract');

/** 需要检查无障碍的关键页面 */
const A11Y_PATHS = [...STATIC_PATHS, '/glossary/en/bluff'];

/** WCAG 2 / 2.1 Level A + AA */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// axe 需要 CSS 与 deferred 应用脚本完成加载，因此等待 DOMContentLoaded；图片、视频等
// 非阻塞资源不影响页面挂载或无障碍树，不应让它们拖住 load 事件并误报导航超时。
const A11Y_NAVIGATION_OPTIONS = { waitUntil: 'domcontentloaded', timeout: 60000 };

// 单次传输故障可用全新的 context 再验证一次；连续失败仍必须让门禁失败。
const A11Y_TRANSIENT_ATTEMPTS = 2;

/**
 * @param {{ id: string, impact?: string | null, help: string, helpUrl?: string, nodes: { target: unknown[] }[] }} violation
 * @returns {string}
 */
function formatViolation(violation) {
    const impact = violation.impact || 'unknown';
    const targets = violation.nodes
        .map((node) => (Array.isArray(node.target) ? node.target.join(' ') : String(node.target)))
        .join('; ');
    const helpUrl = violation.helpUrl ? ` ${violation.helpUrl}` : '';
    return `[${impact}] ${violation.id}: ${violation.help} (${violation.nodes.length} node(s): ${targets})${helpUrl}`;
}

/**
 * @param {{ id: string, impact?: string | null, help: string, helpUrl?: string, nodes: { target: unknown[] }[] }[]} violations
 * @returns {string[]}
 */
function formatViolations(violations) {
    return violations.map(formatViolation);
}

/**
 * @param {{ nodes: unknown[] }[]} violations
 * @returns {number}
 */
function countViolationNodes(violations) {
    return violations.reduce((sum, violation) => sum + violation.nodes.length, 0);
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 * @returns {Promise<number>}
 */
async function assertAccessibility(page, url) {
    console.log(`🔎 正在扫描: ${url}`);

    await page.goto(url, A11Y_NAVIGATION_OPTIONS);
    const pathname = new URL(url).pathname;
    const { mounted, label } = await assertPageMounted(page, pathname);
    if (!mounted) {
        console.error(`❌ 页面未挂载（等待 ${label}）: ${url}`);
        return 1;
    }

    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const { violations } = results;

    if (violations.length === 0) {
        console.log(`✅ 无障碍扫描通过: ${url}`);
        return 0;
    }

    const nodeCount = countViolationNodes(violations);
    console.error(`❌ 发现 ${violations.length} 条规则、${nodeCount} 处节点违规: ${url}`);
    for (const line of formatViolations(violations)) {
        console.error(`   ${line}`);
    }
    return violations.length;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransientA11yNavigationError(error) {
    return (
        error instanceof Error &&
        /page\.goto: net::ERR_(?:TIMED_OUT|CONNECTION_CLOSED|CONNECTION_RESET)/.test(error.message)
    );
}

/**
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {(page: import('playwright').Page, url: string) => Promise<number>} scan
 * @returns {Promise<
 *   { context?: import('playwright').BrowserContext, succeeded: true, result: number } |
 *   { context?: import('playwright').BrowserContext, succeeded: false, error: unknown }
 * >}
 */
async function runAccessibilityAttempt(browser, url, scan) {
    let context;
    try {
        context = await browser.newContext();
        const page = await context.newPage();
        const result = await scan(page, url);
        return { context, succeeded: true, result };
    } catch (error) {
        return { context, succeeded: false, error };
    }
}

/**
 * @param {import('playwright').BrowserContext | undefined} context
 * @returns {Promise<{ succeeded: true } | { succeeded: false, error: unknown }>}
 */
async function closeAccessibilityContext(context) {
    if (!context) {
        return { succeeded: true };
    }
    try {
        await context.close();
        return { succeeded: true };
    } catch (error) {
        return { succeeded: false, error };
    }
}

/**
 * @param {unknown} error
 * @param {number} attempt
 * @returns {boolean}
 */
function shouldRetryAccessibilityAttempt(error, attempt) {
    return isTransientA11yNavigationError(error) && attempt < A11Y_TRANSIENT_ATTEMPTS;
}

/** @param {unknown} error @returns {string} */
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} url
 * @param {
 *   { succeeded: true, result: number } |
 *   { succeeded: false, error: unknown }
 * } attemptResult
 * @param {{ succeeded: true } | { succeeded: false, error: unknown }} closeResult
 * @param {number} attempt
 * @returns {{ retry: boolean, result: number }}
 */
function resolveAccessibilityAttempt(url, attemptResult, closeResult, attempt) {
    if (!closeResult.succeeded) {
        if (!attemptResult.succeeded) {
            console.error(
                `❌ [A11Y 无障碍检查未完成] 页面或浏览器出错（这不是 WCAG 违规结果）: ${url}: ${errorMessage(attemptResult.error)}`,
            );
        }
        console.error(
            `❌ [A11Y 浏览器清理失败] 无法关闭该页面的隔离浏览器环境，本页检查已停止: ${url}: ${errorMessage(closeResult.error)}`,
        );
        return { retry: false, result: 1 };
    }
    if (attemptResult.succeeded) {
        return { retry: false, result: attemptResult.result };
    }
    if (shouldRetryAccessibilityAttempt(attemptResult.error, attempt)) {
        return { retry: true, result: 1 };
    }
    console.error(
        `❌ [A11Y 无障碍检查未完成] 页面或浏览器出错（这不是 WCAG 违规结果）: ${url}: ${errorMessage(attemptResult.error)}`,
    );
    return { retry: false, result: 1 };
}

/**
 * 失败导航可能在 page.goto 拒绝后继续跳转到 Chromium 错误页。每次尝试使用独立
 * context，确保关闭失败页面后，残留导航不会打断下一个 URL 的扫描。
 *
 * @param {import('playwright').Browser} browser
 * @param {string} url
 * @param {(page: import('playwright').Page, url: string) => Promise<number>} [scan]
 * @returns {Promise<number>}
 */
async function assertAccessibilityWithRetry(browser, url, scan = assertAccessibility) {
    for (let attempt = 1; attempt <= A11Y_TRANSIENT_ATTEMPTS; attempt += 1) {
        const attemptResult = await runAccessibilityAttempt(browser, url, scan);
        const closeResult = await closeAccessibilityContext(attemptResult.context);
        const resolution = resolveAccessibilityAttempt(url, attemptResult, closeResult, attempt);
        if (resolution.retry) {
            console.log(
                `  [A11Y 自动恢复] 页面遇到临时网络错误，正在新的隔离浏览器环境中重试 ${attempt}/${A11Y_TRANSIENT_ATTEMPTS - 1}: ${attemptResult.error.message}`,
            );
            continue;
        }
        return resolution.result;
    }

    return 1;
}

async function run() {
    const baseUrl = URLS[ENV];
    if (!baseUrl) {
        console.error(`❌ 未知环境: ${ENV}`);
        process.exit(1);
    }

    console.log(`🚀 [A11Y] 正在为 [${ENV}] 运行 axe 无障碍扫描...`);
    console.log(`🔗 目标: ${baseUrl}`);
    console.log(`📋 页面: ${A11Y_PATHS.join(', ')}`);
    console.log(`🏷️  规则标签: ${AXE_TAGS.join(', ')}`);

    const browser = await chromium.launch();
    let issues = 0;

    try {
        const pages = A11Y_PATHS.map((pathname) => new URL(pathname, baseUrl).toString());
        for (const url of pages) {
            issues += await assertAccessibilityWithRetry(browser, url);
        }
    } catch (e) {
        console.error(`❌ [错误] ${e.message}`);
        issues += 1;
    } finally {
        await browser.close();
    }

    console.log('\n🏁 [A11Y] 检查完成。');
    console.log(`⚠️ 发现的问题数: ${issues}`);

    if (issues > 0) {
        process.exit(1);
    }

    console.log('✅ [成功] 关键页面 axe 扫描无 WCAG A/AA 违规');
    process.exit(0);
}

module.exports = {
    A11Y_PATHS,
    AXE_TAGS,
    A11Y_NAVIGATION_OPTIONS,
    A11Y_TRANSIENT_ATTEMPTS,
    formatViolation,
    formatViolations,
    countViolationNodes,
    isTransientA11yNavigationError,
    assertAccessibilityWithRetry,
};

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
