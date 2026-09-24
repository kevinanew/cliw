#!/usr/bin/env node

/**
 * E2E：校验 /terminologies/ 返回 1 小时浏览器缓存头。
 *
 * 断言 Cache-Control 含 public 与 max-age=3600（路径仍为 /terminologies/{locale}/…）。
 */

const { ENV, URLS } = require('./env');

const startUrl = URLS[ENV];

/**
 * @param {string | null} cacheControl
 * @returns {boolean}
 */
function isOneHourPublicCache(cacheControl) {
    if (!cacheControl) {
        return false;
    }
    const value = cacheControl.toLowerCase();
    return value.includes('public') && /(?:^|[,;\s])max-age=3600(?:$|[,;\s])/.test(value);
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function terminologyIndexUrl(baseUrl) {
    return new URL('/terminologies/zh/index.json', baseUrl).href;
}

async function run() {
    if (!startUrl) {
        console.error(`❌ [terminologies-cache] 未知环境: ${ENV}`);
        process.exit(1);
    }

    const url = terminologyIndexUrl(startUrl);
    console.log(`🚀 [terminologies-cache] 正在校验 [${ENV}] 术语缓存头...`);
    console.log(`🔗 URL: ${url}`);

    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
        console.error(`❌ [terminologies-cache] HTTP ${response.status}`);
        process.exit(1);
    }

    const cacheControl = response.headers.get('cache-control');
    console.log(`Cache-Control: ${cacheControl || '(缺失)'}`);

    if (!isOneHourPublicCache(cacheControl)) {
        console.error(
            `❌ [terminologies-cache] 期望 Cache-Control 含 public 与 max-age=3600，实际: "${cacheControl || '(缺失)'}"`,
        );
        process.exit(1);
    }

    console.log('✅ [terminologies-cache] /terminologies/ 具备 1 小时 public 缓存头');
    process.exit(0);
}

module.exports = {
    isOneHourPublicCache,
    terminologyIndexUrl,
};

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
