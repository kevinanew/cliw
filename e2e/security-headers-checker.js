#!/usr/bin/env node

/**
 * E2E：校验 HTTP 安全响应头
 * - 对首页 (/)、一个 JS 资源、一个 JSON 资源 (/apk/index.json)、/index.html 各发一个请求
 * - 断言响应头包含：
 *     X-Frame-Options: SAMEORIGIN
 *     X-Content-Type-Options: nosniff
 *     Referrer-Policy: strict-origin-when-cross-origin
 *     Strict-Transport-Security: max-age=31536000; includeSubDomains（仅 staging/production）
 *     Content-Security-Policy（或 CSP_MODE=report-only 时的 Report-Only）
 * - 对 / 与 /index.html 额外断言 Cache-Control 含 no-store（或至少 no-cache）且不含 immutable
 *   （SPA 壳不能被长期缓存；对齐 apk-checker 对清单拒绝 immutable 的守卫）
 * - 对固定地址 /icon.png 与 /og-share.png 断言可重新验证且不含 immutable，防止无版本图片被长期缓存
 * - 对 Open Graph 分享图断言匿名请求返回 PNG，防止分享爬虫抓取到 HTML 或 404
 * - 对不存在的 hashed JS 断言返回 application/javascript 自愈脚本（而非 text/html 404）
 *
 * 目的：验证已部署站点的安全响应头。
 * 缺少这类校验曾导致「nginx 安全头丢失」长期未被发现，本脚本补齐该安全维度的回归。
 */

const ENV = process.env.NODE_ENV || 'staging';

const ORIGINS = {
    production: 'https://www.goplay.appcookies.com',
    staging: new URL(require('./staging-url').stagingUrl()).origin,
    development: 'http://localhost:8080',
};

const origin = ORIGINS[ENV];
const CSP_MODE = process.env.CSP_MODE || 'report-only';
const CSP_HEADER_NAME = CSP_MODE === 'report-only' ? 'content-security-policy-report-only' : 'content-security-policy';

if (!origin) {
    console.error(`❌ 未知环境: ${ENV}`);
    process.exit(1);
}
if (!['report-only', 'enforce'].includes(CSP_MODE)) {
    console.error(`❌ 未知 CSP_MODE: ${CSP_MODE}`);
    process.exit(1);
}

const REQUIRED_HEADERS = {
    'x-frame-options': 'SAMEORIGIN',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...(ENV === 'staging' || ENV === 'production'
        ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' }
        : {}),
    'reporting-endpoints': 'csp-endpoint="/csp-report"',
};

const REQUIRED_CSP_DIRECTIVES = {
    'default-src': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'script-src': ["'self'"],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'"],
    'style-src-attr': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'media-src': ["'self'"],
    'frame-src': ["'none'"],
    'manifest-src': ["'self'"],
    'worker-src': ["'self'"],
    'report-uri': ['/csp-report'],
    'report-to': ['csp-endpoint'],
    ...(CSP_MODE === 'enforce' ? { 'upgrade-insecure-requests': [] } : {}),
};

console.log(`🚀 [E2E] 正在校验 [${ENV}] 环境的 HTTP 安全响应头...`);
console.log(`🔗 目标域名: ${new URL(origin).hostname}`);

function checkHeaders(label, url, headers) {
    let ok = true;
    for (const [name, expected] of Object.entries(REQUIRED_HEADERS)) {
        // Headers.get 大小写不敏感，返回值统一小写比较以避免「SAMEORIGIN」与「sameorigin」误判
        const actual = headers.get(name) || '';
        const normalized = String(actual).trim().toLowerCase();
        const expectedNorm = expected.toLowerCase();
        if (normalized !== expectedNorm) {
            console.error(
                `❌ [失败] ${label} (${url}) 安全头 ${name} 期望 "${expected}"，实际 "${actual || '(缺失)'}"`,
            );
            ok = false;
        }
    }
    if (ok) {
        console.log(`✅ [成功] ${label} 安全响应头校验通过`);
    }
    return ok;
}

function checkCsp(label, url, headers) {
    const policy = headers.get(CSP_HEADER_NAME) || '';
    if (!policy) {
        console.error(`❌ [失败] ${label} (${url}) 缺少 ${CSP_HEADER_NAME}`);
        return false;
    }

    const directives = new Map(
        policy
            .split(';')
            .map((directive) => directive.trim())
            .filter(Boolean)
            .map((directive) => {
                const [name, ...sources] = directive.split(/\s+/);
                return [name.toLowerCase(), sources.map((source) => source.toLowerCase())];
            }),
    );
    let ok = true;

    for (const [name, expectedSources] of Object.entries(REQUIRED_CSP_DIRECTIVES)) {
        const sources = directives.get(name);
        if (!sources) {
            console.error(`❌ [失败] ${label} CSP 缺少 ${name}`);
            ok = false;
            continue;
        }
        for (const expected of expectedSources) {
            if (!sources.includes(expected)) {
                console.error(`❌ [失败] ${label} CSP 的 ${name} 应包含 ${expected}`);
                ok = false;
            }
        }
    }

    const styleSources = directives.get('style-src') || [];
    if (!styleSources.some((source) => source.startsWith("'nonce-"))) {
        console.error(`❌ [失败] ${label} CSP 的 style-src 必须包含每响应 nonce`);
        ok = false;
    }
    if (styleSources.includes("'unsafe-inline'")) {
        console.error(`❌ [失败] ${label} CSP 的 style-src 不得包含 'unsafe-inline'`);
        ok = false;
    }
    if (CSP_MODE === 'report-only' && directives.has('upgrade-insecure-requests')) {
        console.error(`❌ [失败] ${label} Report-Only CSP 不应包含 upgrade-insecure-requests`);
        ok = false;
    }
    if (ok) {
        console.log(`✅ [成功] ${label} CSP 校验通过 (${CSP_HEADER_NAME})`);
    }
    return ok;
}

/** SPA 壳：必须可重新验证且绝不能 immutable；优先要求 no-store 防止磁盘残留旧 HTML */
function checkSpaShellCacheControl(label, headers) {
    const cacheControl = headers.get('cache-control') || '';
    console.log(`${label} Cache-Control: ${cacheControl || '(缺失)'}`);
    let ok = true;
    if (!/no-store|no-cache/i.test(cacheControl)) {
        console.error(
            `❌ [失败] ${label} 的 Cache-Control 应包含 no-store 或 no-cache，实际: "${cacheControl || '(缺失)'}"`,
        );
        ok = false;
    }
    if (!/no-store/i.test(cacheControl)) {
        console.error(
            `❌ [失败] ${label} 的 Cache-Control 应包含 no-store（避免浏览器长期沿用旧 SPA 壳），实际: "${cacheControl || '(缺失)'}"`,
        );
        ok = false;
    }
    if (/immutable/i.test(cacheControl)) {
        console.error(`❌ [失败] ${label} 的 Cache-Control 不应包含 immutable，实际: "${cacheControl}"`);
        ok = false;
    }
    return ok;
}

/** 固定无哈希资源：允许缓存副本，但每次使用前必须能够重新验证。 */
function checkVersionlessImageCacheControl(pathname, headers) {
    const cacheControl = headers.get('cache-control') || '';
    console.log(`${pathname} Cache-Control: ${cacheControl || '(缺失)'}`);
    if (!/no-cache/i.test(cacheControl) || /immutable/i.test(cacheControl)) {
        console.error(
            `❌ [失败] ${pathname} 为固定无哈希地址，Cache-Control 必须包含 no-cache 且不得包含 immutable，实际: "${cacheControl || '(缺失)'}"`,
        );
        return false;
    }
    return true;
}

async function fetchWithHeaders(url) {
    const response = await fetch(url, { redirect: 'follow' });
    return { status: response.status, headers: response.headers, response };
}

function finish(success) {
    if (success) {
        console.log('\n✅ 所有目标的安全响应头校验通过。');
        process.exit(0);
    }

    // staging 与 production 应同配安全头：任意环境失败均 exit 1，避免配置漂移时 CI 仍绿。
    console.error('\n❌ 安全响应头校验未全部通过。');
    process.exit(1);
}

async function checkVersionlessImage(pathname, label, expectedContentType) {
    try {
        const url = `${origin}${pathname}`;
        const { status, headers } = await fetchWithHeaders(url);
        console.log(`→ GET ${url} → ${status}`);
        let success = true;
        if (status !== 200) {
            console.error(`❌ [失败] ${pathname} 应返回 200，实际: ${status}`);
            success = false;
        }
        if (expectedContentType) {
            const contentType = headers.get('content-type') || '';
            if (!expectedContentType.test(contentType)) {
                console.error(`❌ [失败] ${pathname} 应返回 image/png，实际: "${contentType || '(缺失)'}"`);
                success = false;
            }
        }
        if (!checkHeaders(label, url, headers)) success = false;
        if (!checkCsp(label, url, headers)) success = false;
        if (!checkVersionlessImageCacheControl(pathname, headers)) success = false;
        return success;
    } catch (e) {
        console.error(`❌ [错误] ${pathname} 响应头校验失败: ${e.message}`);
        return false;
    }
}

async function run() {
    let success = true;

    // 1) 首页 /
    try {
        const homeUrl = `${origin}/`;
        const { status, headers } = await fetchWithHeaders(homeUrl);
        console.log(`→ GET ${homeUrl} → ${status}`);
        if (!checkHeaders('首页 (/)', homeUrl, headers)) success = false;
        if (!checkCsp('首页 (/)', homeUrl, headers)) success = false;
        if (!checkSpaShellCacheControl('首页 (/)', headers)) success = false;
    } catch (e) {
        console.error(`❌ [错误] 首页请求失败: ${e.message}`);
        success = false;
    }

    // 2) /index.html
    try {
        const indexUrl = `${origin}/index.html`;
        const { status, headers } = await fetchWithHeaders(indexUrl);
        console.log(`→ GET ${indexUrl} → ${status}`);
        if (!checkHeaders('/index.html', indexUrl, headers)) success = false;
        if (!checkCsp('/index.html', indexUrl, headers)) success = false;

        // SPA shell：新部署会替换 index.html，必须 no-store，绝不能 immutable
        // （配合 default.conf.template location = /index.html）
        if (!checkSpaShellCacheControl('/index.html', headers)) success = false;
    } catch (e) {
        console.error(`❌ [错误] /index.html 请求失败: ${e.message}`);
        success = false;
    }

    // 3-4) 固定无哈希图片必须可重新验证；分享图还必须保持 PNG 类型。
    const imageCheckResults = [
        await checkVersionlessImage('/icon.png', '固定图标 (/icon.png)'),
        await checkVersionlessImage('/og-share.png', 'Open Graph 分享图 (/og-share.png)', /^image\/png(?:;|$)/i),
    ];

    // 5) JSON 资源：/apk/index.json
    try {
        const jsonUrl = `${origin}/apk/index.json`;
        const { status, headers } = await fetchWithHeaders(jsonUrl);
        console.log(`→ GET ${jsonUrl} → ${status}`);
        if (!checkHeaders('JSON 资源 (/apk/index.json)', jsonUrl, headers)) success = false;
        if (!checkCsp('JSON 资源 (/apk/index.json)', jsonUrl, headers)) success = false;
    } catch (e) {
        console.error(`❌ [错误] JSON 资源请求失败: ${e.message}`);
        success = false;
    }

    // 6) JS 资源：从首页 HTML 中解析一个 JS 资源 URL 再请求
    //    （构建产物 JS 文件名为哈希命名，无法硬编码，故从首页 <script src> 提取）
    try {
        const homeResponse = await fetch(`${origin}/`, { redirect: 'follow' });
        const homeHtml = await homeResponse.text();
        const jsMatch = homeHtml.match(/<script[^>]+src=["']([^"']+\.js)["']/i);
        if (!jsMatch) {
            console.error('❌ [失败] 未能在首页 HTML 中找到 JS 资源引用（<script src="...js">）');
            success = false;
        } else {
            const jsUrl = new URL(jsMatch[1], origin).toString();
            const { status, headers } = await fetchWithHeaders(jsUrl);
            console.log(`→ GET ${jsUrl} → ${status}`);
            if (!checkHeaders('JS 资源', jsUrl, headers)) success = false;
            if (!checkCsp('JS 资源', jsUrl, headers)) success = false;
        }
    } catch (e) {
        console.error(`❌ [错误] JS 资源请求失败: ${e.message}`);
        success = false;
    }

    // 6) 缺失的 hashed JS：须返回可执行的自愈脚本（Content-Type: javascript），
    //    不能是 text/html 的 404 页（否则旧壳引用失效 chunk 时白屏且无法自愈）
    try {
        const missingJsUrl = `${origin}/main.missing-chunk-reload-guard.js`;
        const { status, headers, response } = await fetchWithHeaders(missingJsUrl);
        const contentType = (headers.get('content-type') || '').toLowerCase();
        const body = await response.text();
        console.log(`→ GET ${missingJsUrl} → ${status}, Content-Type: ${contentType || '(缺失)'}`);
        if (!checkHeaders('缺失 JS 自愈脚本', missingJsUrl, headers)) success = false;
        if (!checkCsp('缺失 JS 自愈脚本', missingJsUrl, headers)) success = false;
        if (!contentType.includes('javascript')) {
            console.error(
                `❌ [失败] 缺失 JS 的 Content-Type 应为 application/javascript，实际: "${contentType || '(缺失)'}"`,
            );
            success = false;
        }
        if (!/laiwan_stale_chunk_reload/.test(body)) {
            console.error('❌ [失败] 缺失 JS 响应体应包含 stale chunk 自愈脚本（laiwan_stale_chunk_reload）');
            success = false;
        }
        if (/text\/html/i.test(contentType)) {
            console.error('❌ [失败] 缺失 JS 不应返回 text/html（会导致 MIME 拦截与白屏）');
            success = false;
        }
    } catch (e) {
        console.error(`❌ [错误] 缺失 JS 自愈校验失败: ${e.message}`);
        success = false;
    }

    // 7) CSP 报告收集端点：验证真实部署接受浏览器的同源违规报告。
    try {
        const reportUrl = `${origin}/csp-report`;
        const response = await fetch(reportUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/csp-report' },
            body: JSON.stringify({
                'csp-report': {
                    'document-uri': `${origin}/`,
                    'violated-directive': 'e2e-probe',
                },
            }),
        });
        console.log(`→ POST ${reportUrl} → ${response.status}`);
        if (response.status !== 204) {
            console.error(`❌ [失败] CSP 报告端点应返回 204，实际: ${response.status}`);
            success = false;
        }
    } catch (e) {
        console.error(`❌ [错误] CSP 报告端点校验失败: ${e.message}`);
        success = false;
    }

    finish(success && imageCheckResults.every(Boolean));
}

run().catch((err) => {
    console.error('致命错误:', err);
    process.exit(1);
});
