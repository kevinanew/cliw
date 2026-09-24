#!/usr/bin/env node
const { chromium } = require('playwright');
const { assertPageMounted } = require('./assert-page-mounted');

/**
 * 端到端测试：客户端重定向（线上验证）
 *
 * 1) 未知路径 → /，首页挂载
 * 2) /glossary/:locale（zh / en / zh-TW）→ /glossary，术语表挂载
 *
 * 单测 App.test.tsx 已覆盖 <Navigate ... replace />，但仅在 jsdom 中验证。
 * 本脚本在真实浏览器中确认地址栏改写与目标页正常渲染。
 */

const ENV = process.env.NODE_ENV || 'staging';
const URLS = {
    production: 'https://www.goplay.appcookies.com/',
    staging: require('./staging-url').stagingUrl(),
    development: 'http://localhost:8080/',
};

const baseUrl = URLS[ENV];

const UNKNOWN_PATHS = ['/unknown-path', '/nonexistent', '/random/path'];

const GLOSSARY_LOCALE_PATHS = ['/glossary/zh', '/glossary/en', '/glossary/zh-TW'];

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

/**
 * @param {import('playwright').Page} page
 * @param {string} fromPath
 * @param {string} expectedPath
 * @param {{ mountPathname: string, successLabel: string }} options
 * @returns {Promise<number>} issue count
 */
async function assertRedirect(page, fromPath, expectedPath, options, dependencies = {}) {
    const { mountPathname, successLabel } = options;
    const targetBaseUrl = dependencies.baseUrl || baseUrl;
    const mountPage = dependencies.assertPageMounted || assertPageMounted;
    const logger = dependencies.logger || console;
    const targetUrl = new URL(fromPath, targetBaseUrl).toString();
    logger.log(`🔎 正在检查: ${targetUrl}`);

    try {
        const response = await page.goto(targetUrl, {
            waitUntil: 'load',
            timeout: 60000,
        });

        if (!response || response.status() >= 400) {
            const status = response ? response.status() : '(无响应)';
            logger.error(`❌ [${status}] ${targetUrl}`);
            return 1;
        }

        const { mounted, label } = await mountPage(page, mountPathname, {
            timeout: 30000,
        });

        const finalPath = new URL(page.url()).pathname;
        const pathIssues = [];

        if (finalPath !== expectedPath) {
            pathIssues.push(`地址栏路径为 ${finalPath}，期望 ${expectedPath}`);
        }
        if (!mounted) {
            pathIssues.push(`目标页未渲染（${label} 不可见）`);
        }

        if (pathIssues.length > 0) {
            for (const issue of pathIssues) {
                logger.error(`❌ [重定向] ${targetUrl}: ${issue}`);
            }
            return pathIssues.length;
        }

        logger.log(`✅ [正常] ${fromPath} -> ${expectedPath} (${successLabel})`);
        return 0;
    } catch (e) {
        logger.error(`❌ [错误] ${targetUrl}: ${e.message}`);
        return 1;
    }
}

async function run(dependencies = {}) {
    const env = dependencies.env || ENV;
    const targetBaseUrl = dependencies.baseUrl || URLS[env];
    const browserType = dependencies.browserType || chromium;
    const logger = dependencies.logger || console;
    const checkRedirect = dependencies.assertRedirect || assertRedirect;

    if (!targetBaseUrl) {
        logger.error(`❌ 未知环境: ${env}`);
        return 1;
    }

    logger.log(`🚀 [E2E] 正在为 [${env}] 验证客户端重定向...`);
    logger.log(`🔗 目标 URL: ${targetBaseUrl}`);

    const browser = await browserType.launch();
    let issues = 0;

    try {
        const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
        for (const unknownPath of UNKNOWN_PATHS) {
            issues += await checkRedirect(
                page,
                unknownPath,
                '/',
                { mountPathname: '/', successLabel: '首页已渲染' },
                { baseUrl: targetBaseUrl, logger, assertPageMounted: dependencies.assertPageMounted },
            );
        }

        for (const glossaryPath of GLOSSARY_LOCALE_PATHS) {
            issues += await checkRedirect(
                page,
                glossaryPath,
                '/glossary',
                { mountPathname: '/glossary', successLabel: 'glossary-header 可见' },
                { baseUrl: targetBaseUrl, logger, assertPageMounted: dependencies.assertPageMounted },
            );
        }
    } finally {
        await browser.close();
    }

    logger.log('\n🏁 [重定向] 检查完成。');
    logger.log(`⚠️ 发现的问题数: ${issues}`);

    if (issues > 0) {
        return 1;
    }

    logger.log('✅ [成功] 未知路径 → /，glossary locale 路径 → /glossary，目标页均正常渲染');
    return 0;
}

module.exports = {
    URLS,
    UNKNOWN_PATHS,
    GLOSSARY_LOCALE_PATHS,
    DESKTOP_VIEWPORT,
    assertRedirect,
    run,
};

if (require.main === module) {
    run()
        .then((status) => process.exit(status))
        .catch((err) => {
            console.error('致命错误:', err);
            process.exit(1);
        });
}
