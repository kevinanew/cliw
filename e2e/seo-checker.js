#!/usr/bin/env node

/** 检查不依赖访问域名的页面元数据。 */

const { load } = require('cheerio');
const { chromium } = require('playwright');
const { ENV, URLS } = require('./env');
const { STATIC_PATHS } = require('./site-contract');

const LOCALES = ['zh', 'zh-TW', 'en'];
const URL_TAG_SELECTORS = [
    'link[rel="canonical"]',
    'link[rel="alternate"][hreflang]',
    'meta[property="og:url"]',
    'meta[property="og:image"]',
    'meta[property="og:image:width"]',
    'meta[property="og:image:height"]',
];

function validateHead(html, locale) {
    const $ = load(html);
    const issues = [];
    const title = $('title').text().trim();
    const description = $('meta[name="description"]').attr('content')?.trim();

    if ($('html').attr('lang') !== locale) issues.push(`<html lang> 应为 ${locale}`);
    if (!title) issues.push('缺少标题');
    if (!description) issues.push('缺少页面描述');
    if ($('meta[property="og:title"]').attr('content') !== title) issues.push('og:title 与标题不一致');
    if ($('meta[property="og:description"]').attr('content') !== description) {
        issues.push('og:description 与页面描述不一致');
    }
    for (const selector of URL_TAG_SELECTORS) {
        if ($(selector).length > 0) issues.push(`仍包含绑定域名的标签：${selector}`);
    }
    return issues;
}

async function run({ fetchImpl = fetch, browserType = chromium, baseUrl = URLS[ENV] } = {}) {
    if (!baseUrl) throw new Error(`未知环境：${ENV}`);
    let issues = 0;

    for (const pathname of STATIC_PATHS) {
        for (const locale of LOCALES) {
            const url = new URL(pathname, baseUrl);
            url.searchParams.set('lang', locale);
            const response = await fetchImpl(url, { redirect: 'follow' });
            if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
            const pageIssues = validateHead(await response.text(), locale);
            for (const issue of pageIssues) console.error(`❌ ${url}：${issue}`);
            issues += pageIssues.length;
        }
    }

    const browser = await browserType.launch();
    try {
        const page = await browser.newPage();
        for (const locale of LOCALES) {
            const url = new URL(`/?lang=${locale}`, baseUrl);
            await page.goto(url.toString(), { waitUntil: 'load', timeout: 60000 });
            await page.waitForFunction(
                (expected) =>
                    document.querySelector(`[data-testid="language-option-${expected}"]`)?.getAttribute('aria-pressed') ===
                    'true',
                locale,
                { timeout: 15000 },
            );
            const pageIssues = validateHead(await page.content(), locale);
            for (const issue of pageIssues) console.error(`❌ 浏览器 ${url}：${issue}`);
            issues += pageIssues.length;
        }
    } finally {
        await browser.close();
    }

    if (issues === 0) console.log('✅ 静态 HTML 与浏览器页面的多语言元数据检查通过');
    return issues;
}

module.exports = { validateHead, run };

if (require.main === module) {
    run().then((issues) => {
        process.exitCode = issues > 0 ? 1 : 0;
    }).catch((error) => {
        console.error(`❌ 元数据检查失败：${error.message}`);
        process.exitCode = 1;
    });
}
