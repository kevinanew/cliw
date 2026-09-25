#!/usr/bin/env node

/**
 * 部署后 E2E：明文 HTTP 必须在任何业务 location 处理前永久跳转到 HTTPS。
 *
 * 覆盖首页、SPA 页面路由、从 HTTPS 首页解析到的实际静态资源，及带百分号编码
 * 中文文件名的 APK。所有检查均使用 redirect: 'manual'，确保 HTTP 响应本身
 * 不会被跟随到业务正文。
 */

const cheerio = require('cheerio');
const { ENV, URLS } = require('./env');

const HTTPS_REDIRECT_STATUS_CODES = new Set([301, 308]);
const APK_PATH = '/apk/%E6%9D%A5%E7%8E%A9Dev-2.0.2602041721.apk?channel=https-redirect-check';
const TRAILING_SLASH_PATHS = ['/tutorial', '/glossary', '/learning'];

function httpOriginFor(httpsOrigin) {
    const url = new URL(httpsOrigin);
    if (url.protocol !== 'https:') {
        throw new Error(`HTTPS origin 必须以 https:// 开头，收到: ${httpsOrigin}`);
    }
    url.protocol = 'http:';
    return url.origin;
}

function makeUrl(origin, pathAndQuery) {
    return new URL(pathAndQuery, origin).toString();
}

function redirectMatches(response, expectedLocation) {
    return HTTPS_REDIRECT_STATUS_CODES.has(response.status) && response.headers.get('location') === expectedLocation;
}

async function readHomepageTargets(httpsOrigin, fetchImpl = fetch) {
    const response = await fetchImpl(makeUrl(httpsOrigin, '/'), { redirect: 'error' });
    if (!response.ok) {
        throw new Error(`无法读取 HTTPS 首页以定位静态资源：HTTP ${response.status}`);
    }

    const $ = cheerio.load(await response.text());
    const scriptPath = $('script[src$=".js"], script[src*=".js?"]').first().attr('src');
    if (!scriptPath) {
        throw new Error('未能从 HTTPS 首页解析到 JavaScript 静态资源');
    }

    const assetUrl = new URL(scriptPath, httpsOrigin);
    if (assetUrl.origin !== new URL(httpsOrigin).origin) {
        throw new Error(`首页静态资源不是同源地址：${assetUrl}`);
    }

    return { staticAssetPath: `${assetUrl.pathname}${assetUrl.search}` };
}

async function assertHttpsRedirect({ label, httpUrl, expectedLocation }) {
    const response = await fetch(httpUrl, { redirect: 'manual' });
    const location = response.headers.get('location');
    console.log(`→ GET ${httpUrl} → ${response.status}${location ? ` Location: ${location}` : ''}`);

    if (!redirectMatches(response, expectedLocation)) {
        throw new Error(
            `${label} 未永久跳转到 HTTPS：期望 301/308 且 Location 为 ${expectedLocation}，` +
                `实际 HTTP ${response.status}，Location 为 ${location || '(缺失)'}`,
        );
    }

    console.log(`✅ ${label} 已永久跳转，并保留路径与查询参数`);
}

async function assertTrailingSlashRedirect({ httpsOrigin, pathname, fetchImpl = fetch }) {
    const query = 'lang=en&ref=trailing-slash-redirect-check';
    const source = makeUrl(httpsOrigin, `${pathname}/?${query}`);
    const expectedLocation = `${pathname}?${query}`;
    const response = await fetchImpl(source, { redirect: 'manual' });
    const location = response.headers.get('location');
    console.log(`→ GET ${source} → ${response.status}${location ? ` Location: ${location}` : ''}`);

    if (response.status !== 308 || location !== expectedLocation) {
        throw new Error(
            `${pathname}/ 未跳转到同域名的无尾随斜杠路径：期望 HTTP 308，Location 为 ${expectedLocation}，` +
                `实际 HTTP ${response.status}，Location 为 ${location || '(缺失)'}`,
        );
    }

    const destination = new URL(location, source);
    const destinationResponse = await fetchImpl(destination.toString(), { redirect: 'error' });
    if (!destinationResponse.ok) {
        throw new Error(`${pathname} 跳转目标未返回成功内容：HTTP ${destinationResponse.status}`);
    }

    const html = await destinationResponse.text();
    if (!html.includes('<html lang="en"')) {
        throw new Error(`${pathname} 跳转目标未返回英文页面`);
    }

    console.log(`✅ ${pathname}/ 保留访问域名与查询参数，英文页面返回 HTTP ${destinationResponse.status}`);
}

async function run() {
    const httpsOrigin = URLS[ENV];
    if (!httpsOrigin) {
        throw new Error(`未知环境: ${ENV}`);
    }
    if (ENV === 'development') {
        console.log('⏭️ development 使用本地 HTTP 开发服务器，不检查公网 HTTP→HTTPS 跳转。');
        return;
    }

    const httpOrigin = httpOriginFor(httpsOrigin);
    const { staticAssetPath } = await readHomepageTargets(httpsOrigin);
    const checks = [
        { label: '首页', pathAndQuery: '/' },
        { label: '页面路由', pathAndQuery: '/glossary?source=https-redirect-check&lang=zh' },
        { label: '静态资源', pathAndQuery: staticAssetPath },
        { label: 'APK 下载', pathAndQuery: APK_PATH },
    ];

    console.log(`🚀 [E2E] 正在校验 [${ENV}] 环境所有 HTTP 请求均跳转到 HTTPS...`);
    for (const { label, pathAndQuery } of checks) {
        await assertHttpsRedirect({
            label,
            httpUrl: makeUrl(httpOrigin, pathAndQuery),
            expectedLocation: makeUrl(httpsOrigin, pathAndQuery),
        });
    }
    console.log('🚀 正在校验核心静态页尾随斜杠跳转到同域名路径...');
    for (const pathname of TRAILING_SLASH_PATHS) {
        await assertTrailingSlashRedirect({ httpsOrigin, pathname });
    }
    console.log('✅ HTTP→HTTPS 重定向检查全部通过。');
}

module.exports = {
    APK_PATH,
    HTTPS_REDIRECT_STATUS_CODES,
    assertTrailingSlashRedirect,
    httpOriginFor,
    makeUrl,
    readHomepageTargets,
    redirectMatches,
    TRAILING_SLASH_PATHS,
};

if (require.main === module) {
    run().catch((error) => {
        console.error(`❌ HTTP→HTTPS 重定向检查失败: ${error.message}`);
        process.exit(1);
    });
}
