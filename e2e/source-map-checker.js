#!/usr/bin/env node
/**
 * E2E：不存在的 source map 必须是明确的 404，绝不能被 SPA 首页兜底成 200 HTML。
 */

const { ENV, URLS } = require('./env');

/**
 * @param {Response} response
 * @returns {Promise<string | null>} 失败原因；通过时为 null
 */
async function validateMissingSourceMap(response) {
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text();

    if (response.status !== 404) {
        return `期望 HTTP 404，实际 HTTP ${response.status}`;
    }
    if (/text\/html/i.test(contentType) && /<div\s+id=["']laiwan["']/i.test(body)) {
        return '404 响应不应返回 SPA 首页 HTML';
    }
    return null;
}

async function run() {
    const startUrl = URLS[ENV];
    if (!startUrl) {
        throw new Error(`未知环境: ${ENV}`);
    }

    const origin = new URL(startUrl).origin;
    const missingMapUrl = new URL(
        `/assets/__missing-source-map-${Date.now()}-${Math.random().toString(36).slice(2)}.js.map`,
        origin,
    );
    const response = await fetch(missingMapUrl, { redirect: 'manual' });
    const error = await validateMissingSourceMap(response);
    if (error) {
        throw new Error(`${error}: ${missingMapUrl}`);
    }

    console.log(`✅ 缺失 source map 返回 HTTP 404，未回退首页 HTML: ${missingMapUrl.pathname}`);
}

module.exports = { validateMissingSourceMap };

if (require.main === module) {
    run().catch((error) => {
        console.error(`❌ [source-map] ${error.message}`);
        process.exit(1);
    });
}
