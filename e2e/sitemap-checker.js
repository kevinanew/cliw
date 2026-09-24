#!/usr/bin/env node
const { chromium } = require('playwright');
const { GLOSSARY_SAMPLE_SIZE, isGlossaryDefinitionUrl, pickGlossarySample } = require('./glossary-sample');
const { assertPageMounted } = require('./assert-page-mounted');
const { buildStaticPageUrls, STATIC_PATHS, SITE_ORIGIN } = require('./site-contract');

/**
 * E2E：校验 sitemap.xml，并抽样访问词条 URL
 * - 抓取 /sitemap.xml 确认可访问且可解析
 * - 断言 STATIC_PATHS 的三种语言 canonical URL（包含 query）均精确出现在 <loc> 中
 * - 抽样若干词条 URL，确认 HTTP 200 且 SPA 已挂载
 */

const ENV = process.env.NODE_ENV || 'staging';
const ORIGINS = {
    production: 'https://www.goplay.appcookies.com',
    staging: new URL(require('./staging-url').stagingUrl()).origin,
    development: 'http://localhost:8080',
};

function extractLocs(xml) {
    const locs = [];
    const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
    let match = re.exec(xml);
    while (match) {
        locs.push(match[1].trim());
        match = re.exec(xml);
    }
    return locs;
}

async function fetchSitemap(url, fetchImpl = fetch) {
    try {
        const response = await fetchImpl(url, { redirect: 'follow' });
        if (!response.ok) return { error: `❌ [失败] HTTP ${response.status} ${url}` };
        return { xml: await response.text() };
    } catch (error) {
        return { error: `❌ [错误] ${url}: ${error.message}` };
    }
}

function parseSitemap(xml) {
    if (!xml.includes('<urlset') || !xml.includes('<loc>')) {
        return { error: '❌ [失败] sitemap.xml 内容无效（缺少 urlset/loc）' };
    }
    const locs = extractLocs(xml);
    if (locs.length === 0) return { locs, error: '❌ [失败] sitemap.xml 未包含任何 <loc>' };
    return { locs };
}

function isSiteStaticUrl(loc, staticPathSet) {
    try {
        const parsed = new URL(loc);
        return parsed.origin === SITE_ORIGIN && staticPathSet.has(parsed.pathname);
    } catch {
        return false;
    }
}

function validateStaticUrls(locs) {
    const expected = buildStaticPageUrls(STATIC_PATHS);
    const locSet = new Set(locs);
    const missing = expected.filter((loc) => !locSet.has(loc));
    const staticPathSet = new Set(STATIC_PATHS);
    const actual = locs.filter((loc) => isSiteStaticUrl(loc, staticPathSet));
    const expectedSet = new Set(expected);
    const unexpected = actual.filter((loc) => !expectedSet.has(loc));
    return { expected, actual, missing, unexpected, countMismatch: actual.length !== expected.length };
}

function toEnvUrl(loc, origin) {
    const { pathname, search } = new URL(loc);
    return `${origin}${pathname}${search}`;
}

function prepareGlossaryUrls(locs, origin) {
    const glossaryLocs = locs.filter((loc) => isGlossaryDefinitionUrl(loc));
    const sampled = pickGlossarySample(glossaryLocs, GLOSSARY_SAMPLE_SIZE, { origin }).map((loc) =>
        toEnvUrl(loc, origin),
    );
    return { glossaryLocs, sampled };
}

async function checkGlossaryPage(page, url, mountedAssertion = assertPageMounted, logger = console) {
    logger.log(`🔎 正在检查: ${url}`);
    try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
        if (!response) {
            logger.error(`❌ [请求失败] ${url} (无响应)`);
            return 1;
        }
        if (response.status() !== 200) {
            logger.error(`❌ [HTTP ${response.status()}] ${url}`);
            return 1;
        }
        const { mounted, label } = await mountedAssertion(page, new URL(url).pathname);
        if (!mounted) {
            logger.error(`❌ [渲染错误] ${url} (未找到 ${label})`);
            return 1;
        }
        logger.log(`✅ [正常] ${url}`);
        return 0;
    } catch (error) {
        logger.error(`❌ [错误] ${url}: ${error.message}`);
        return 1;
    }
}

async function checkGlossaryPages(page, urls, pageChecker = checkGlossaryPage) {
    let issues = 0;
    for (const url of urls) issues += await pageChecker(page, url);
    return issues;
}

async function withBrowser(launch, inspect) {
    const browser = await launch();
    try {
        return await inspect(await browser.newPage());
    } finally {
        await browser.close();
    }
}

function reportStaticValidation(result, logger) {
    if (result.missing.length > 0) {
        logger.error(`❌ [失败] sitemap.xml 缺少静态页规范 URL: ${result.missing[0]}`);
        return false;
    }
    if (result.unexpected.length > 0 || result.countMismatch) {
        const suffix = result.unexpected.length > 0 ? `: ${result.unexpected.join(', ')}` : '';
        logger.error(
            `❌ [失败] sitemap.xml 静态 URL 集合不规范（期望 ${result.expected.length}，实际 ${result.actual.length}）${suffix}`,
        );
        return false;
    }
    logger.log(`✅ 静态页 ${result.expected.length} 条语言规范 URL 均精确出现在 sitemap.xml`);
    return true;
}

async function loadValidSitemap(sitemapUrl, fetchImpl, logger) {
    const fetched = await fetchSitemap(sitemapUrl, fetchImpl);
    if (fetched.error) {
        logger.error(fetched.error);
        return null;
    }
    const parsed = parseSitemap(fetched.xml);
    if (parsed.locs) logger.log(`📄 sitemap.xml 共解析出 ${parsed.locs.length} 个 URL`);
    if (parsed.error) {
        logger.error(parsed.error);
        return null;
    }
    return parsed.locs;
}

function prepareChecks(locs, origin, logger) {
    if (!reportStaticValidation(validateStaticUrls(locs), logger)) return null;
    const glossary = prepareGlossaryUrls(locs, origin);
    if (glossary.glossaryLocs.length === 0) {
        logger.error('❌ [失败] sitemap.xml 未包含词条 URL（/glossary/{zh|en}/...）');
        return null;
    }
    logger.log(
        `📚 词条抽查 ${glossary.sampled.length} 个（必测 + 随机补充，上限 ${GLOSSARY_SAMPLE_SIZE}；池 ${glossary.glossaryLocs.length}）`,
    );
    return glossary.sampled;
}

async function run(options = {}) {
    const env = options.env || ENV;
    const origin = ORIGINS[env];
    const logger = options.logger || console;
    if (!origin) {
        logger.error(`❌ 未知环境: ${env}`);
        return 1;
    }
    const sitemapUrl = `${origin}/sitemap.xml`;
    logger.log(`🚀 [E2E] 正在验证 [${env}] 环境的 sitemap.xml...`);
    logger.log(`🔗 目标 URL: ${sitemapUrl}`);

    const locs = await loadValidSitemap(sitemapUrl, options.fetchImpl, logger);
    if (!locs) return 1;
    const sampled = prepareChecks(locs, origin, logger);
    if (!sampled) return 1;

    const launch = options.launch || (() => chromium.launch());
    const pageChecker = options.pageChecker || ((page, url) => checkGlossaryPage(page, url, assertPageMounted, logger));
    const issues = await withBrowser(launch, (page) => checkGlossaryPages(page, sampled, pageChecker));
    logger.log('\n🏁 [SITEMAP] 检查完成。');
    logger.log(`⚠️ 发现的问题数: ${issues}`);
    if (issues > 0) return 1;
    logger.log('✅ [成功] sitemap.xml 可访问，抽样词条均返回 200 且 SPA 已挂载');
    return 0;
}

async function main(runImpl = run, exit = process.exit, logger = console) {
    try {
        exit(await runImpl());
    } catch (error) {
        logger.error('致命错误:', error);
        exit(1);
    }
}

if (require.main === module) main();

module.exports = {
    extractLocs,
    fetchSitemap,
    parseSitemap,
    validateStaticUrls,
    toEnvUrl,
    prepareGlossaryUrls,
    checkGlossaryPage,
    checkGlossaryPages,
    withBrowser,
    loadValidSitemap,
    prepareChecks,
    run,
    main,
};
