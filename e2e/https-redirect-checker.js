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
        throw new Error(`无法读取 HTTPS 首页以定位静态资源与规范域名：HTTP ${response.status}`);
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

    const canonicalHref = $('link[rel="canonical"]').attr('href');
    if (!canonicalHref) {
        throw new Error('HTTPS 首页缺少 canonical URL，无法确定公开跳转域名');
    }
    const canonicalUrl = new URL(canonicalHref);
    if (canonicalUrl.protocol !== 'https:') {
        throw new Error(`HTTPS 首页 canonical URL 必须使用 HTTPS：${canonicalHref}`);
    }

    return {
        staticAssetPath: `${assetUrl.pathname}${assetUrl.search}`,
        publicOrigin: canonicalUrl.origin,
    };
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

async function assertCanonicalTrailingSlashRedirect({ httpsOrigin, publicOrigin = httpsOrigin, pathname, fetchImpl = fetch }) {
    const localeQuery = 'lang=en';
    const redirectQuery = `${localeQuery}&ref=trailing-slash-redirect-check`;
    const source = makeUrl(httpsOrigin, `${pathname}/?${redirectQuery}`);
    const expectedLocation = makeUrl(publicOrigin, `${pathname}?${redirectQuery}`);
    const expectedCanonical = makeUrl(publicOrigin, `${pathname}?${localeQuery}`);
    const response = await fetchImpl(source, { redirect: 'manual' });
    const location = response.headers.get('location');
    console.log(`→ GET ${source} → ${response.status}${location ? ` Location: ${location}` : ''}`);

    if (response.status !== 308 || location !== expectedLocation) {
        throw new Error(
            `${pathname}/ 未直接跳转到 HTTPS 规范 URL：期望 HTTP 308，Location 为 ${expectedLocation}，` +
                `实际 HTTP ${response.status}，Location 为 ${location || '(缺失)'}`,
        );
    }

    const canonicalResponse = await fetchImpl(location, { redirect: 'error' });
    if (!canonicalResponse.ok) {
        throw new Error(`${pathname} 规范 URL 未返回成功内容：HTTP ${canonicalResponse.status}`);
    }

    const html = await canonicalResponse.text();
    const expectedFragments = ['<html lang="en"', `rel="canonical" href="${expectedCanonical}"`];
    for (const fragment of expectedFragments) {
        if (!html.includes(fragment)) {
            throw new Error(`${pathname} 规范 URL 未返回英文 SEO 内容：缺少 ${fragment}`);
        }
    }

    console.log(`✅ ${pathname}/ 直达 HTTPS 规范 URL，且英文 canonical 页面返回 HTTP ${canonicalResponse.status}`);
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
    const { staticAssetPath, publicOrigin } = await readHomepageTargets(httpsOrigin);
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
            expectedLocation: makeUrl(publicOrigin, pathAndQuery),
        });
    }
    console.log('🚀 正在校验核心静态页尾随斜杠直达 HTTPS 规范 URL...');
    for (const pathname of TRAILING_SLASH_PATHS) {
        await assertCanonicalTrailingSlashRedirect({ httpsOrigin, publicOrigin, pathname });
    }
    console.log('✅ HTTP→HTTPS 重定向检查全部通过。');
}

module.exports = {
    APK_PATH,
    HTTPS_REDIRECT_STATUS_CODES,
    assertCanonicalTrailingSlashRedirect,
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
