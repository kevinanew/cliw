#!/usr/bin/env node
const { chromium } = require('playwright');

/**
 * 端到端测试：验证 HTML 中的构建版本 meta 标签
 */

const ENV = process.env.NODE_ENV || 'staging';
const URLS = {
    production: 'https://www.goplay.appcookies.com/',
    staging: require('./staging-url').stagingUrl(),
    development: 'http://localhost:8080/',
};

const buildVersionRegex = /^(staging|production)\s+-\s+([a-f0-9]+)\s+-\s+.+$/i;

function isValidBuildVersion(value, env) {
    const match = value && value.match(buildVersionRegex);
    return Boolean(match && match[1].toLowerCase() === env.toLowerCase() && match[2].toLowerCase() !== 'unknown');
}

async function run(options = {}) {
    const {
        env = ENV,
        startUrl = URLS[env],
        browserType = chromium,
        log = console.log,
        error = console.error,
        exit = process.exit,
    } = options;

    log(`🚀 [E2E] 正在验证 [${env}] 环境下的构建版本 meta 标签...`);
    log(`🔗 目标 URL: ${startUrl}`);

    const browser = await browserType.launch();
    let success = false;

    try {
        const page = await browser.newPage();
        await page.goto(startUrl, { waitUntil: 'load', timeout: 60000 });

        const buildVersion = await page.$eval('meta[name="build-version"]', (el) => el.content).catch(() => null);

        if (isValidBuildVersion(buildVersion, env)) {
            log(`✅ [成功] 在 meta 标签中找到了构建版本号: ${buildVersion}`);
            success = true;
        } else {
            error('❌ [失败] 未在 meta 标签中找到构建版本号，或其格式无效。');
            if (buildVersion) {
                log(`实际值: ${buildVersion}`);
            }
            const headContent = await page.evaluate(() => document.head.innerHTML);
            log('用于调试的 Head 内容:');
            log(headContent);
        }
    } catch (e) {
        error(`❌ [错误] ${startUrl}: ${e.message}`);
    } finally {
        await browser.close();
    }

    exit(success ? 0 : 1);
    return success;
}

module.exports = { isValidBuildVersion, run };

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
