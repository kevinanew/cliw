#!/usr/bin/env node
/**
 * E2E：线上 HTML 入口 + webpack 异步 chunk 的全部 /assets/*.js|*.css
 * 必须在站点上 HTTP 可达（镜像已叠入 S3 历史资源）。
 */

const path = require('node:path');
const cheerio = require('cheerio');
const { ENV, URLS } = require('./env');

const REQUIRED_BOOK_ASSET_PATHS = [
    '/book/no-limit-holdem-advanced-en_cover.jpg',
    '/book/no-limit-holdem-advanced-zh_cover.jpg',
    '/book/德州扑克战术与策略分析-赵春阳_cover.jpg',
];

/**
 * @param {string} pathname
 * @returns {boolean}
 */
function isSiteAssetPathname(pathname) {
    return /^\/assets\/[^/]+\.(js|css)$/i.test(pathname);
}

/**
 * 同源 /assets/*.js|css → basename；否则 null。
 * @param {string} resourceUrl
 * @param {string} siteOrigin
 * @returns {string | null}
 */
function assetBasenameFromUrl(resourceUrl, siteOrigin) {
    let parsed;
    try {
        parsed = new URL(resourceUrl, siteOrigin);
    } catch {
        return null;
    }

    let origin;
    try {
        origin = new URL(siteOrigin).origin;
    } catch {
        return null;
    }

    if (parsed.origin !== origin) {
        return null;
    }
    if (!isSiteAssetPathname(parsed.pathname)) {
        return null;
    }
    return path.basename(parsed.pathname);
}

/**
 * 用 cheerio 从 HTML 提取入口 script / stylesheet 的 assets basename。
 * @param {string} html
 * @param {string} siteOrigin
 * @returns {string[]}
 */
function extractEntryAssetsFromHtml(html, siteOrigin) {
    const names = new Set();
    const $ = cheerio.load(html);

    $('script[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (!src) {
            return;
        }
        const name = assetBasenameFromUrl(src, siteOrigin);
        if (name) {
            names.add(name);
        }
    });

    $('link[rel="stylesheet"][href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) {
            return;
        }
        const name = assetBasenameFromUrl(href, siteOrigin);
        if (name) {
            names.add(name);
        }
    });

    return [...names].sort();
}

/**
 * 解析 webpack runtime 中的异步 chunk 文件名（js + css）。
 * 形如：o.u=e=>"assets/"+e+"."+{45:"bca267d1",...}[e]+".js"
 *      o.miniCssF=e=>"assets/"+e+"."+{45:"81573454",...}[e]+".css"
 * @param {string} mainJsSource
 * @returns {string[]}
 */
function parseWebpackChunkAssets(mainJsSource) {
    const names = new Set();
    const re =
        /"assets\/"\s*\+\s*e\s*\+\s*"\."\s*\+\s*(\{(?:\d+:"[a-f0-9]{8}",)*\d+:"[a-f0-9]{8}"\})\s*\[\s*e\s*\]\s*\+\s*"\.(js|css)"/g;

    for (const match of mainJsSource.matchAll(re)) {
        const mapBody = match[1];
        const ext = match[2];
        for (const entry of mapBody.matchAll(/(\d+):"([a-f0-9]{8})"/g)) {
            names.add(`${entry[1]}.${entry[2]}.${ext}`);
        }
    }

    return [...names].sort();
}

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${url}`);
    }
    return response.text();
}

/**
 * 检查资源 URL 是否可达（优先 HEAD，部分 CDN 不支持时回退 GET）。
 * @param {string} url
 * @returns {Promise<{ ok: boolean, status: number }>}
 */
async function checkAssetReachable(url) {
    let response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (response.status === 405 || response.status === 501) {
        response = await fetch(url, { method: 'GET', redirect: 'follow' });
    }
    return { ok: response.ok, status: response.status };
}

/**
 * @param {string} siteOrigin
 * @param {Iterable<string>} assetBasenames
 * @returns {Promise<string[]>} 不可达的 basename 列表
 */
async function findUnreachableAssets(siteOrigin, assetBasenames) {
    const missing = [];
    for (const name of [...new Set(assetBasenames)].sort()) {
        const url = `${siteOrigin}/assets/${name}`;
        const result = await checkAssetReachable(url);
        if (!result.ok) {
            missing.push(`${name} (HTTP ${result.status})`);
        }
    }
    return missing;
}

/**
 * @param {string} siteOrigin
 * @param {Iterable<string>} resourcePaths
 * @returns {Promise<string[]>} 不可达的同源资源路径列表
 */
async function findUnreachableResources(siteOrigin, resourcePaths) {
    const missing = [];
    for (const resourcePath of [...new Set(resourcePaths)].sort()) {
        const result = await checkAssetReachable(new URL(resourcePath, siteOrigin).href);
        if (!result.ok) {
            missing.push(`${resourcePath} (HTTP ${result.status})`);
        }
    }
    return missing;
}

async function run() {
    const startUrl = URLS[ENV];
    if (!startUrl) {
        console.error(`❌ 未知环境: ${ENV}`);
        process.exit(1);
    }

    if (ENV !== 'staging' && ENV !== 'production') {
        console.error(`❌ 仅支持 staging / production（当前: ${ENV}）`);
        process.exit(1);
    }

    const siteOrigin = new URL(startUrl).origin;

    console.log(`🚀 [E2E] 正在验证 [${ENV}] 页面 js/css 均在线上可达...`);
    console.log(`🔗 目标 URL: ${startUrl}`);

    console.log(`🔎 正在读取首页 HTML: ${startUrl}`);
    const html = await fetchText(startUrl);
    const entryAssets = extractEntryAssetsFromHtml(html, siteOrigin);
    if (entryAssets.length === 0) {
        console.error('❌ [失败] HTML 中未找到 /assets/*.js|*.css 入口');
        process.exit(1);
    }

    console.log(`📄 入口资源 ${entryAssets.length} 个:`);
    for (const name of entryAssets) {
        console.log(`   - ${name}`);
    }

    const mainJs = entryAssets.find((name) => /^main\.[a-f0-9]+\.js$/i.test(name));
    if (!mainJs) {
        console.error('❌ [失败] HTML 中未找到 main.*.js，无法解析异步 chunk');
        process.exit(1);
    }

    const mainUrl = `${siteOrigin}/assets/${mainJs}`;
    console.log(`🔎 正在解析 webpack chunk 映射: ${mainUrl}`);
    const mainSource = await fetchText(mainUrl);
    const chunkAssets = parseWebpackChunkAssets(mainSource);
    if (chunkAssets.length === 0) {
        console.error('❌ [失败] main.js 中未解析到异步 chunk 映射');
        process.exit(1);
    }

    console.log(`📦 异步 chunk ${chunkAssets.length} 个:`);
    for (const name of chunkAssets) {
        console.log(`   - ${name}`);
    }

    const pageAssets = [...new Set([...entryAssets, ...chunkAssets])].sort();
    console.log(`\n📄 页面合计 ${pageAssets.length} 个 js/css，开始探测 HTTP 可达性…`);

    const missing = await findUnreachableAssets(siteOrigin, pageAssets);
    if (missing.length > 0) {
        console.error(`\n❌ [失败] 以下文件在 ${siteOrigin}/assets/ 不可达:`);
        for (const name of missing) {
            console.error(`   - ${name}`);
        }
        process.exit(1);
    }

    const missingBookAssets = await findUnreachableResources(siteOrigin, REQUIRED_BOOK_ASSET_PATHS);
    if (missingBookAssets.length > 0) {
        console.error(`\n❌ [失败] 学习页所需书封面在 ${siteOrigin} 不可达:`);
        for (const resource of missingBookAssets) {
            console.error(`   - ${resource}`);
        }
        console.error('   请先发布页面引用的书籍封面，再部署前端。');
        process.exit(1);
    }

    console.log(
        `\n✅ 全部 ${pageAssets.length} 个 js/css 与 ${REQUIRED_BOOK_ASSET_PATHS.length} 个学习页书封面资源均在线上可达`,
    );
    process.exit(0);
}

module.exports = {
    REQUIRED_BOOK_ASSET_PATHS,
    isSiteAssetPathname,
    assetBasenameFromUrl,
    extractEntryAssetsFromHtml,
    parseWebpackChunkAssets,
    checkAssetReachable,
    findUnreachableAssets,
    findUnreachableResources,
};

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
