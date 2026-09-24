#!/usr/bin/env node
/**
 * E2E：hreflang / canonical 校验
 * - 每种期望的 hreflang 只出现一次，且集合与 buildHreflangAlternates 一致
 * - canonical 域名与当前环境匹配
 * - 普通页面 canonical/og:url 与当前 lang 壳一致；词条页 canonical 与路径 locale 一致
 * - 直接读取 Nginx 原始 HTML，覆盖编码 lang、no-store 及恶意 Host，不依赖 JavaScript 修正
 * - 抽样词条页：各 hreflang href 指向对应 locale/slug
 *
 * 期望值镜像 documentHead.buildHreflangAlternates / buildCanonicalUrl，
 * 用 glossarySlugMap.generated.json 与应用逻辑对齐。
 */

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');
const { chromium } = require('playwright');
const { GLOSSARY_SAMPLE_SIZE, isGlossaryDefinitionUrl, pickGlossarySample } = require('./glossary-sample');
const { assertPageMounted } = require('./assert-page-mounted');
const { ENV, URLS } = require('./env');
const { SEO_LOCALES, STATIC_PATHS } = require('./site-contract');

const DEFAULT_LOCALE = 'zh';

const GLOSSARY_SLUG_MAP_PATH = path.join(
    __dirname,
    'fixtures/glossarySlugMap.generated.json',
);

/** @type {{ byLocaleSlug?: Record<string, Partial<Record<string, string>>> } | null} */
let cachedSlugMap = null;

function loadGlossarySlugMap() {
    if (cachedSlugMap) {
        return cachedSlugMap;
    }
    const raw = fs.readFileSync(GLOSSARY_SLUG_MAP_PATH, 'utf8');
    cachedSlugMap = JSON.parse(raw);
    return cachedSlugMap;
}

/**
 * @param {string} pathname
 * @returns {{ locale: string, term: string } | null}
 */
function parseGlossaryDefinitionPath(pathname) {
    const match = pathname.match(/^\/glossary\/(zh|zh-TW|en)\/([^/]+)$/);
    if (!match) {
        return null;
    }
    return {
        locale: match[1],
        term: decodeURIComponent(match[2]),
    };
}

/**
 * @param {string} pathname
 * @param {string} locale
 * @param {string} siteOrigin
 * @returns {string}
 */
function buildLangUrl(pathname, locale, siteOrigin) {
    const base = pathname === '/' ? `${siteOrigin}/` : `${siteOrigin}${pathname}`;
    return `${base}?lang=${locale}`;
}

/**
 * 镜像浏览器端对原始 lang 参数名的处理：大小写不敏感，但不解码参数名。
 * @param {string} search
 * @returns {string}
 */
function getExpectedLocaleFromSearch(search) {
    const query = search.startsWith('?') ? search.slice(1) : search;
    for (const part of query.split('&')) {
        const equalsIndex = part.indexOf('=');
        const rawName = equalsIndex === -1 ? part : part.slice(0, equalsIndex);
        if (rawName.toLowerCase() !== 'lang') continue;

        const rawValue = equalsIndex === -1 ? '' : part.slice(equalsIndex + 1);
        const value = new URLSearchParams(`value=${rawValue}`).get('value') || '';
        const normalized = value.trim().replace(/_/g, '-').toLowerCase();
        if (normalized === 'en') return 'en';
        if (normalized === 'zh-tw') return 'zh-TW';
        if (normalized === 'zh') return 'zh';
        return DEFAULT_LOCALE;
    }
    return DEFAULT_LOCALE;
}

/**
 * @param {string} pathname
 * @param {string} siteOrigin
 * @returns {{ hreflang: string, href: string }[]}
 */
function buildExpectedHreflangAlternates(pathname, siteOrigin) {
    const definition = parseGlossaryDefinitionPath(pathname);
    if (definition) {
        const slugMap = loadGlossarySlugMap();
        const key = `${definition.locale}:${definition.term}`;
        const slugsByLocale = slugMap.byLocaleSlug && slugMap.byLocaleSlug[key];

        if (slugsByLocale) {
            /** @type {{ hreflang: string, href: string }[]} */
            const alternates = [];
            for (const targetLocale of SEO_LOCALES) {
                const slug = slugsByLocale[targetLocale];
                if (slug) {
                    alternates.push({
                        hreflang: targetLocale,
                        href: `${siteOrigin}/glossary/${targetLocale}/${encodeURIComponent(slug)}`,
                    });
                }
            }
            const defaultSlug = slugsByLocale[DEFAULT_LOCALE];
            if (defaultSlug) {
                alternates.push({
                    hreflang: 'x-default',
                    href: `${siteOrigin}/glossary/${DEFAULT_LOCALE}/${encodeURIComponent(defaultSlug)}`,
                });
            }
            return alternates;
        }

        // 无跨 locale slug 映射：与 documentHead 一致，仅 self + x-default
        const selfHref = `${siteOrigin}/glossary/${definition.locale}/${encodeURIComponent(definition.term)}`;
        return [
            { hreflang: definition.locale, href: selfHref },
            { hreflang: 'x-default', href: selfHref },
        ];
    }

    return [
        ...SEO_LOCALES.map((locale) => ({
            hreflang: locale,
            href: buildLangUrl(pathname, locale, siteOrigin),
        })),
        {
            hreflang: 'x-default',
            href: buildLangUrl(pathname, DEFAULT_LOCALE, siteOrigin),
        },
    ];
}

/**
 * @param {string} pathname
 * @param {string} locale
 * @param {string} siteOrigin
 * @returns {string}
 */
function buildExpectedCanonicalUrl(pathname, locale, siteOrigin) {
    if (parseGlossaryDefinitionPath(pathname)) {
        return `${siteOrigin}${pathname}`;
    }
    return buildLangUrl(pathname, locale, siteOrigin);
}

function requestWithHost(url, host) {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;

    return new Promise((resolve) => {
        const request = transport.request(target, { headers: { Host: host } }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
                if (body.length < 4096) body += chunk;
            });
            response.on('end', () => resolve({ status: response.statusCode || 0, body }));
        });
        // Nginx 的 444 会直接断开连接，这正是期望的拒绝结果。
        request.on('error', () => resolve({ status: 0, body: '' }));
        request.end();
    });
}

async function assertServerSeoShell(baseUrl) {
    const siteOrigin = new URL(baseUrl).origin;
    const cases = [
        ...STATIC_PATHS.flatMap((pathname) =>
            SEO_LOCALES.map((locale) => ({ pathname, query: `lang=${locale}`, locale })),
        ),
        { pathname: '/tutorial', query: 'LANG=en', locale: 'en' },
        { pathname: '/tutorial', query: 'lang=%45%4E', locale: 'en' },
        { pathname: '/tutorial', query: 'l%61ng=en', locale: DEFAULT_LOCALE },
    ];
    let issues = 0;

    for (const testCase of cases) {
        const url = `${siteOrigin}${testCase.pathname}?${testCase.query}`;
        try {
            const response = await fetch(url, { redirect: 'error' });
            const html = await response.text();
            const canonical = buildLangUrl(testCase.pathname, testCase.locale, siteOrigin);
            const expectedFragments = [
                `<html lang="${testCase.locale}"`,
                `property="og:url" content="${canonical}"`,
                `rel="canonical" href="${canonical}"`,
            ];

            if (response.status !== 200) {
                console.error(`❌ Nginx 原始壳 ${url} 返回 ${response.status}，期望 200`);
                issues += 1;
            }
            for (const fragment of expectedFragments) {
                if (!html.includes(fragment)) {
                    console.error(`❌ Nginx 原始壳 ${url} 缺少 ${fragment}`);
                    issues += 1;
                }
            }

            const cacheControl = response.headers.get('cache-control') || '';
            const pragma = response.headers.get('pragma') || '';
            if (!/no-store/i.test(cacheControl) || !/no-cache/i.test(pragma)) {
                console.error(`❌ Nginx 原始壳 ${url} 缺少 no-store/Pragma no-cache：${cacheControl}; ${pragma}`);
                issues += 1;
            }
        } catch (error) {
            console.error(`❌ Nginx 原始壳请求失败 ${url}: ${error.message}`);
            issues += 1;
        }
    }

    const poisoned = await requestWithHost(`${siteOrigin}/tutorial?lang=en`, 'attacker.example');
    if (poisoned.status === 200 || poisoned.body.includes('attacker.example')) {
        console.error(`❌ 恶意 Host 被 SEO 路由接受：status=${poisoned.status}`);
        issues += 1;
    }

    if (issues === 0) {
        console.log('✅ Nginx 原始语言壳、缓存头与 Host 白名单校验通过');
    }
    return issues;
}

/**
 * 比较两个绝对 URL（忽略 hash；query/path 按 URL API 规范化）。
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
function urlsEqual(actual, expected) {
    try {
        const a = new URL(actual);
        const b = new URL(expected);
        return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
    } catch {
        return actual === expected;
    }
}

/**
 * @param {{ hreflang: string, href: string }[]} actualAlternates
 * @param {{ hreflang: string, href: string }[]} expectedAlternates
 * @returns {{ counts: Record<string, number>, expectedByLang: Record<string, string> }}
 */
function indexHreflangAlternates(actualAlternates, expectedAlternates) {
    const counts = Object.create(null);
    const expectedByLang = Object.create(null);

    for (const alternate of actualAlternates) {
        counts[alternate.hreflang] = (counts[alternate.hreflang] || 0) + 1;
    }
    for (const alternate of expectedAlternates) {
        expectedByLang[alternate.hreflang] = alternate.href;
    }

    return { counts, expectedByLang };
}

/**
 * @param {string} actual
 * @param {string} expected
 * @returns {boolean}
 */
function validUrlsEqual(actual, expected) {
    // 先解析以区分“不相等”和“无效”；urlsEqual 保持原有公开行为。
    new URL(actual);
    new URL(expected);
    return urlsEqual(actual, expected);
}

function findExpectedHreflangIssues(counts, expectedByLang) {
    const issues = [];
    for (const lang of Object.keys(expectedByLang)) {
        const count = counts[lang] || 0;
        if (count !== 1) issues.push(`hreflang="${lang}" 出现 ${count} 次，期望恰好 1 次`);
    }
    return issues;
}

function findUnexpectedHreflangIssues(counts, expectedByLang) {
    return Object.keys(counts)
        .filter((lang) => !(lang in expectedByLang))
        .map((lang) => `出现未预期的 hreflang="${lang}"`);
}

function validateAlternateHref(alternate, expectedHref) {
    if (!expectedHref) return [];
    try {
        if (validUrlsEqual(alternate.href, expectedHref)) return [];
        return [`hreflang="${alternate.hreflang}" href=${alternate.href}，期望 ${expectedHref}`];
    } catch {
        return [`hreflang="${alternate.hreflang}" href 无效: ${alternate.href}`];
    }
}

function findAlternateHrefIssues(actualAlternates, expectedByLang) {
    return actualAlternates.flatMap((alternate) =>
        validateAlternateHref(alternate, expectedByLang[alternate.hreflang]),
    );
}

/**
 * @param {{ hreflang: string, href: string }[]} actualAlternates
 * @param {{ hreflang: string, href: string }[]} expectedAlternates
 * @returns {string[]}
 */
function validateHreflangAlternates(actualAlternates, expectedAlternates) {
    const { counts, expectedByLang } = indexHreflangAlternates(actualAlternates, expectedAlternates);
    return [
        ...findExpectedHreflangIssues(counts, expectedByLang),
        ...findUnexpectedHreflangIssues(counts, expectedByLang),
        ...findAlternateHrefIssues(actualAlternates, expectedByLang),
    ];
}

/**
 * @param {string[]} canonicals
 * @param {string} expectedCanonical
 * @param {string} expectedHost
 * @returns {string[]}
 */
function validateCanonical(canonicals, expectedCanonical, expectedHost) {
    if (canonicals.length !== 1) {
        return [`canonical 出现 ${canonicals.length} 次，期望恰好 1 次`];
    }

    const canonicalHref = canonicals[0];
    try {
        const canonicalUrl = new URL(canonicalHref);
        const issues = [];
        if (canonicalUrl.hostname !== expectedHost) {
            issues.push(`canonical 域名为 ${canonicalUrl.hostname}，期望与环境匹配为 ${expectedHost}`);
        }
        if (!validUrlsEqual(canonicalHref, expectedCanonical)) {
            issues.push(`canonical 为 ${canonicalHref}，期望 ${expectedCanonical}`);
        }
        return issues;
    } catch {
        return [`canonical href 无效: ${canonicalHref}`];
    }
}

/**
 * @param {{ alternates: { hreflang: string, href: string }[], canonicals: string[] }} snapshot
 * @param {{ alternates: { hreflang: string, href: string }[], canonical: string, host: string }} expected
 * @returns {{ issues: string[], hreflangCount: number, canonical: string | null }}
 */
function validateSeoSnapshot(snapshot, expected) {
    return {
        issues: [
            ...validateHreflangAlternates(snapshot.alternates, expected.alternates),
            ...validateCanonical(snapshot.canonicals, expected.canonical, expected.host),
        ],
        hreflangCount: snapshot.alternates.length,
        canonical: snapshot.canonicals[0] || null,
    };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} baseUrl
 * @returns {Promise<string[]>}
 */
async function collectGlossarySample(page, baseUrl) {
    const glossaryUrl = new URL('/glossary', baseUrl).toString();
    await page.goto(glossaryUrl, { waitUntil: 'load', timeout: 60000 });
    const { mounted, label } = await assertPageMounted(page, '/glossary');
    if (!mounted) {
        throw new Error(`术语表页面未挂载（等待 ${label}）`);
    }
    await page.waitForSelector('[data-testid^="glossary-term-"]', { timeout: 15000 });

    const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a'))
            .map((a) => a.href)
            .filter((href) => href.startsWith('http')),
    );

    const glossaryLinks = [...new Set(links.filter(isGlossaryDefinitionUrl))];
    return pickGlossarySample(glossaryLinks, Math.min(3, GLOSSARY_SAMPLE_SIZE), {
        origin: new URL(baseUrl).origin,
    });
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {{ siteOrigin: string, expectedHost: string }} ctx
 * @returns {Promise<number>}
 */
async function assertSeo(page, url, ctx) {
    console.log(`🔎 正在检查: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        const requestedUrl = new URL(url);
        const pathname = requestedUrl.pathname;
        const { mounted, label } = await assertPageMounted(page, pathname);
        if (!mounted) {
            console.error(`❌ 页面未挂载（等待 ${label}）: ${url}`);
            return 1;
        }
        await page.waitForSelector('link[rel="canonical"]', {
            state: 'attached',
            timeout: 15000,
        });

        const expectedAlternates = buildExpectedHreflangAlternates(pathname, ctx.siteOrigin);
        const definition = parseGlossaryDefinitionPath(pathname);
        const requestedLocale = definition ? definition.locale : getExpectedLocaleFromSearch(requestedUrl.search);
        const expectedCanonical = buildExpectedCanonicalUrl(pathname, requestedLocale, ctx.siteOrigin);

        const snapshot = await page.evaluate(() => ({
            alternates: Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map((link) => ({
                hreflang: link.hreflang,
                href: link.href,
            })),
            canonicals: Array.from(document.querySelectorAll('link[rel="canonical"]')).map((link) => link.href),
        }));
        const result = validateSeoSnapshot(snapshot, {
            alternates: expectedAlternates,
            canonical: expectedCanonical,
            host: ctx.expectedHost,
        });

        if (result.issues.length > 0) {
            for (const issue of result.issues) {
                console.error(`❌ ${issue}`);
            }
            return result.issues.length;
        }

        console.log(`✅ hreflang×${result.hreflangCount}, canonical=${result.canonical}`);
        return 0;
    } catch (e) {
        console.error(`❌ [错误] ${url}: ${e.message}`);
        return 1;
    }
}

async function run() {
    const baseUrl = URLS[ENV];
    if (!baseUrl) {
        console.error(`❌ 未知环境: ${ENV}`);
        process.exit(1);
    }

    const expectedHost = new URL(baseUrl).hostname;
    const siteOrigin = new URL(baseUrl).origin;

    console.log(`🚀 [SEO] 正在为 [${ENV}] 校验 hreflang / canonical...`);
    console.log(`🔗 目标域名: ${expectedHost}`);

    const browser = await chromium.launch();
    const context = await browser.newContext({ locale: 'zh-CN' });
    const page = await context.newPage();
    let issues = 0;

    try {
        issues += await assertServerSeoShell(baseUrl);

        const pages = [
            new URL('/tutorial?l%61ng=en', baseUrl).toString(),
            new URL('/tutorial?LANG=en', baseUrl).toString(),
            new URL('/tutorial?lang=%45%4E', baseUrl).toString(),
        ];
        pages.push(
            ...STATIC_PATHS.map((pathname, index) => {
                const locale = SEO_LOCALES[index % SEO_LOCALES.length];
                const url = new URL(pathname, baseUrl);
                url.searchParams.set('lang', locale);
                return url.toString();
            }),
        );

        try {
            const sampledGlossary = await collectGlossarySample(page, baseUrl);
            if (sampledGlossary.length === 0) {
                console.error('❌ [失败] 未能从 /glossary 收集到词条详情链接');
                issues += 1;
            } else {
                pages.push(...sampledGlossary);
            }
        } catch (e) {
            console.error(`❌ [失败] 收集词条链接: ${e.message}`);
            issues += 1;
        }

        for (const url of pages) {
            issues += await assertSeo(page, url, { siteOrigin, expectedHost });
        }
    } catch (e) {
        console.error(`❌ [错误] ${e.message}`);
        issues += 1;
    } finally {
        await context.close();
        await browser.close();
    }

    console.log('\n🏁 [SEO] 检查完成。');
    console.log(`⚠️ 发现的问题数: ${issues}`);

    if (issues > 0) {
        process.exit(1);
    }

    console.log('✅ [成功] Nginx 原始语言壳及运行时 hreflang/canonical 均与当前 locale 一致');
    process.exit(0);
}

module.exports = {
    SEO_LOCALES,
    DEFAULT_LOCALE,
    GLOSSARY_SLUG_MAP_PATH,
    parseGlossaryDefinitionPath,
    buildExpectedHreflangAlternates,
    buildExpectedCanonicalUrl,
    getExpectedLocaleFromSearch,
    assertServerSeoShell,
    urlsEqual,
    indexHreflangAlternates,
    validateHreflangAlternates,
    validateCanonical,
    validateSeoSnapshot,
};

if (require.main === module) {
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}
