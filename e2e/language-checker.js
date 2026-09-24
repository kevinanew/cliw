#!/usr/bin/env node
const { chromium } = require('playwright');
const { REQUIRED_GLOSSARY_TERM_ALTERNATES, buildGlossaryDefinitionPath } = require('./glossary-sample');
const { assertPageMounted } = require('./assert-page-mounted');
const { navigateToMountedTutorial } = require('./tutorial-navigation');
const glossarySlugMap = require('./fixtures/glossarySlugMap.generated.json');

/**
 * 端到端测试：语言切换完整流程（线上验证）
 *
 * 覆盖用户视角的端到端链路：
 *   1. 点击 EN 切换按钮
 *   2. 确认 cookie 写入 language=en
 *   3. 刷新页面后仍为英文（cookie 持久化生效）
 *   4. 点击 zh-TW 切换按钮
 *   5. 确认 cookie 写入 language=zh-TW，UI 为繁体文案
 *   6. 刷新页面后仍为 zh-TW
 *   7. 打开必测词条详情页，切换 EN / 繁中后 URL 变为对照 locale+slug，刷新后仍保持
 *   8. 全新 context、无 cookie，访问 /?lang=en 与 /?lang=zh-TW（hreflang/分享深链落地）
 *   9. 首页点击 zh / zh-TW / en 后，地址栏、canonical、og:url 均同步为对应 ?lang=
 *  10. 切换英文后跨页导航仍携带 lang，复制该 URL 到全新 context 可恢复英文
 *  11. 教程页真实点击三种语言按钮时保留 pathname、其他参数、hash 与 SEO
 *
 * 单测 localizationContext.test.tsx / localeCookie.test.ts / useLanguageSwitcher.test.tsx
 * 已分别覆盖 cookie、对照 slug 导航与 ?lang= 初始化，但未串联真实浏览器与刷新后的持久化。
 */

const ENV = process.env.NODE_ENV || 'staging';
const URLS = {
    production: 'https://www.goplay.appcookies.com/',
    staging: require('./staging-url').stagingUrl(),
    development: 'http://localhost:8080/',
};

const baseUrl = URLS[ENV];
// 本地开发主机不属于公开部署域名，documentHead 会按既有契约回退生产站点 canonical。
const seoOrigin = ENV === 'development' ? new URL(URLS.production).origin : baseUrl && new URL(baseUrl).origin;

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const LANGUAGE_COOKIE_KEY = 'language';
// 该词条已人工确认没有精确英文对应，适合覆盖语言切换到列表页的降级路径。
const MISSING_EN_ALTERNATE_TERM = 'bodongpianli';

async function getLanguageCookie(context) {
    const cookies = await context.cookies(baseUrl);
    return cookies.find((c) => c.name === LANGUAGE_COOKIE_KEY) || null;
}

async function getActiveLocale(page) {
    // 通过语言切换按钮的 aria-pressed 反映当前 locale，
    // 该值由 LanguageSelect 的 isActive = currentLanguage === value 直接驱动。
    return page.evaluate(() => {
        const enBtn = document.querySelector('[data-testid="language-option-en"]');
        const zhBtn = document.querySelector('[data-testid="language-option-zh"]');
        const zhTWBtn = document.querySelector('[data-testid="language-option-zh-TW"]');
        const enPressed = enBtn && enBtn.getAttribute('aria-pressed') === 'true';
        const zhPressed = zhBtn && zhBtn.getAttribute('aria-pressed') === 'true';
        const zhTWPressed = zhTWBtn && zhTWBtn.getAttribute('aria-pressed') === 'true';
        const homeLink = document.querySelector('[data-testid="navbar-link-navbar_home_page"]');
        return {
            enPressed,
            zhPressed,
            zhTWPressed,
            docLang: document.documentElement.lang,
            homeLinkText: homeLink ? homeLink.textContent.trim() : null,
        };
    });
}

function getPathname(page) {
    return new URL(page.url()).pathname;
}

function buildMissingEnglishAlternateSourcePath(term, slugMap = glossarySlugMap) {
    const alternates = slugMap.byLocaleSlug?.[`zh:${term}`];
    if (!alternates?.zh || alternates.zh !== term) {
        throw new Error(`无英文对照测试词条不存在或中文 slug 不一致: ${term}`);
    }
    if (alternates.en) {
        throw new Error(`无英文对照测试词条 ${term} 已映射到英文 slug ${alternates.en}，请更新测试夹具`);
    }
    return buildGlossaryDefinitionPath('zh', term);
}

async function assertLanguageUrlAndSeo(page, locale) {
    const expectedUrl = new URL(`?lang=${locale}`, baseUrl).href;
    const expectedSeoUrl = new URL(`?lang=${locale}`, `${seoOrigin}/`).href;
    const actualUrl = page.url();
    if (actualUrl !== expectedUrl) {
        throw new Error(`地址栏期望 ${expectedUrl}，实际 ${actualUrl}`);
    }

    await page.waitForFunction(
        (expected) => {
            const canonical = document.querySelector('link[rel="canonical"]')?.href;
            const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute('content');
            const selfAlternate = document.querySelector(
                `link[rel="alternate"][hreflang="${document.documentElement.lang}"]`,
            )?.href;
            return canonical === expected && ogUrl === expected && selfAlternate === expected;
        },
        expectedSeoUrl,
        { timeout: 15000 },
    );

    const seo = await page.evaluate(() => ({
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute('content'),
        selfAlternate: document.querySelector(`link[rel="alternate"][hreflang="${document.documentElement.lang}"]`)
            ?.href,
    }));
    if (seo.canonical !== expectedSeoUrl || seo.ogUrl !== expectedSeoUrl || seo.selfAlternate !== expectedSeoUrl) {
        throw new Error(
            `SEO URL 未同步：canonical=${seo.canonical}，og:url=${seo.ogUrl}，hreflang=${seo.selfAlternate}`,
        );
    }
}

/**
 * 切换语言并断言词条详情 URL 变为对照 locale+slug，刷新后仍保持。
 * @returns {Promise<number>} issue count
 */
async function assertGlossarySlugSwitch(page, nextLocale) {
    const expectedTerm = REQUIRED_GLOSSARY_TERM_ALTERNATES[nextLocale];
    if (!expectedTerm) {
        console.error(`❌ [词条 slug] 未知 locale: ${nextLocale}`);
        return 1;
    }
    const expectedPath = buildGlossaryDefinitionPath(nextLocale, expectedTerm);
    let issues = 0;

    console.log(`🔎 正在点击 ${nextLocale}，验证词条对照 slug 导航...`);
    await page.locator(`[data-testid="language-option-${nextLocale}"]`).first().click();

    try {
        await page.waitForFunction(
            ({ path, locale }) =>
                window.location.pathname === path &&
                window.location.search === `?ref=nav&lang=${locale}` &&
                window.location.hash === '#section',
            { path: expectedPath, locale: nextLocale },
            { timeout: 15000 },
        );
    } catch {
        console.error(`❌ [词条 slug] 点击 ${nextLocale} 后期望 path=${expectedPath}，实际: ${getPathname(page)}`);
        return 1;
    }

    const { mounted, label } = await assertPageMounted(page, expectedPath, { timeout: 15000 });
    if (!mounted) {
        console.error(`❌ [词条 slug] 切换到 ${nextLocale} 后词条页未挂载（等待 ${label}）`);
        issues++;
    }

    console.log(`🔎 正在刷新，验证对照 slug 持久化: ${expectedPath}`);
    await page.reload({ waitUntil: 'load', timeout: 60000 });

    const pathAfterReload = getPathname(page);
    if (pathAfterReload !== expectedPath) {
        console.error(`❌ [词条 slug 持久化] 刷新后期望 path=${expectedPath}，实际: ${pathAfterReload}`);
        issues++;
    }

    const afterReload = await assertPageMounted(page, expectedPath, { timeout: 30000 });
    if (!afterReload.mounted) {
        console.error(`❌ [词条 slug 持久化] 刷新后词条页未挂载（等待 ${afterReload.label}）`);
        issues++;
    }

    if (issues === 0) {
        console.log(`   切换 ${nextLocale}: URL=${expectedPath}，刷新后仍保持`);
    }
    return issues;
}

/**
 * 全新 context、无 cookie：访问 /?lang= 深链，断言 UI / document.lang / cookie。
 * 覆盖 hreflang 与分享链接的真实落地路径（非点击切换）。
 * @param {import('playwright').Browser} browser
 * @param {string} lang
 * @param {{ homeLinkText?: string }} [opts]
 * @returns {Promise<number>} issue count
 */
function expectedActiveLocale(lang) {
    return { enPressed: lang === 'en', zhPressed: lang === 'zh', zhTWPressed: lang === 'zh-TW' };
}

async function openLangQueryLanding(context, lang) {
    const landingUrl = new URL(baseUrl);
    landingUrl.searchParams.set('lang', lang);
    const page = await context.newPage();

    console.log(`🔎 正在验证 ?lang= 深链落地: ${landingUrl}`);
    await page.goto(landingUrl.toString(), { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
    await page.waitForFunction(
        (expectedLang) => {
            const btn = document.querySelector(`[data-testid="language-option-${expectedLang}"]`);
            return btn && btn.getAttribute('aria-pressed') === 'true';
        },
        lang,
        { timeout: 15000 },
    );
    return page;
}

function assertLandingActiveButtons(active, lang) {
    const expected = expectedActiveLocale(lang);
    return reportIssueWhen(
        active.enPressed !== expected.enPressed ||
            active.zhPressed !== expected.zhPressed ||
            active.zhTWPressed !== expected.zhTWPressed,
        `❌ [?lang= 落地] /?lang=${lang} 期望仅 language-option-${lang} 的 aria-pressed=true，实际 en=${active.enPressed} zh=${active.zhPressed} zh-TW=${active.zhTWPressed}`,
    );
}

function assertLandingState(active, cookie, lang, opts) {
    let issues = assertLandingActiveButtons(active, lang);
    issues += reportIssueWhen(
        active.docLang !== lang,
        `❌ [?lang= 落地] /?lang=${lang} 期望 <html lang="${lang}">，实际: ${active.docLang}`,
    );
    issues += reportIssueWhen(
        !cookie || cookie.value !== lang,
        `❌ [?lang= 落地] /?lang=${lang} 期望 cookie language=${lang}，实际: ${cookie ? cookie.value : '(无)'}`,
    );
    issues += reportIssueWhen(
        isInsecureDeploymentCookie(cookie),
        '❌ [?lang= 落地] 生产/预发环境 language cookie 应含 Secure 标志',
    );
    const shouldCheckHomeText = opts.homeLinkText !== undefined && opts.homeLinkText !== null;
    issues += reportIssueWhen(
        shouldCheckHomeText && active.homeLinkText !== opts.homeLinkText,
        `❌ [?lang= 落地] /?lang=${lang} 导航「首页」期望「${opts.homeLinkText}」，实际: ${active.homeLinkText}`,
    );
    return issues;
}

async function assertLangQueryLanding(browser, lang, opts = {}, deps = {}) {
    const openLanding = deps.openLangQueryLanding || openLangQueryLanding;
    const readActiveLocale = deps.getActiveLocale || getActiveLocale;
    const readLanguageCookie = deps.getLanguageCookie || getLanguageCookie;
    let context;
    let issues = 0;

    try {
        context = await browser.newContext({
            viewport: DESKTOP_VIEWPORT,
            // 固定浏览器语言为简体，避免无 cookie 时被 Accept-Language 干扰；应以 ?lang= 为准
            locale: 'zh-CN',
        });
        const page = await openLanding(context, lang);
        const active = await readActiveLocale(page);
        const cookie = await readLanguageCookie(context);
        issues += assertLandingState(active, cookie, lang, opts);

        if (issues === 0) {
            console.log(`   /?lang=${lang}: aria-pressed / document.lang / cookie 均正确`);
        }
    } catch (e) {
        console.error(`❌ [?lang= 落地] /?lang=${lang}: ${e.message}`);
        issues++;
    } finally {
        if (context) await context.close();
    }

    return issues;
}

/**
 * 覆盖 /?lang=en 与 /?lang=zh-TW 深链落地（各用全新无 cookie context）。
 * @param {import('playwright').Browser} browser
 * @returns {Promise<number>} issue count
 */
async function runLangQueryLandingChecks(browser) {
    let issues = 0;
    issues += await assertLangQueryLanding(browser, 'en');
    if (issues > 0) {
        return issues;
    }
    // 与点击切换断言风格一致：繁体导航「首页」→「首頁」
    issues += await assertLangQueryLanding(browser, 'zh-TW', { homeLinkText: '首頁' });
    return issues;
}

/**
 * 打开必测词条，覆盖 EN / 繁中跨语言 slug 切换。
 * @returns {Promise<number>} issue count
 */
async function runGlossarySlugLanguageChecks(page) {
    const startLocale = 'zh';
    const startTerm = REQUIRED_GLOSSARY_TERM_ALTERNATES[startLocale];
    const startPath = buildGlossaryDefinitionPath(startLocale, startTerm);
    const startUrl = new URL(`${startPath}?lang=zh&ref=nav#section`, baseUrl).toString();

    console.log(`🔎 正在打开必测词条: ${startUrl}`);
    await page.goto(startUrl, { waitUntil: 'load', timeout: 60000 });

    const { mounted, label } = await assertPageMounted(page, startPath, { timeout: 30000 });
    if (!mounted) {
        console.error(`❌ [词条页] 必测词条未挂载（等待 ${label}）: ${startUrl}`);
        return 1;
    }
    if (getPathname(page) !== startPath) {
        console.error(`❌ [词条页] 期望 path=${startPath}，实际: ${getPathname(page)}`);
        return 1;
    }
    console.log(`   已打开必测词条: ${startPath}`);

    let issues = 0;
    issues += await assertGlossarySlugSwitch(page, 'en');
    if (issues > 0) {
        return issues;
    }
    issues += await assertGlossarySlugSwitch(page, 'zh-TW');
    return issues;
}

/**
 * 无英文对照 slug 时应降级到列表页，同时保留可分享语言、其他参数和 hash。
 * 再通过刷新与全新 context 验证 URL 本身足以恢复语言。
 * @returns {Promise<number>} issue count
 */
async function runGlossaryMissingAlternateCheck(browser, page) {
    const sourcePath = buildMissingEnglishAlternateSourcePath(MISSING_EN_ALTERNATE_TERM);
    const sourceUrl = new URL(`${sourcePath}?lang=zh&ref=nav#section`, baseUrl);
    console.log(`🔎 正在验证无英文对照词条降级: ${sourcePath}`);
    await page.goto(sourceUrl.toString(), { waitUntil: 'load', timeout: 60000 });
    await page.locator('[data-testid="language-option-en"]').first().click();

    const expectedUrl = new URL('/glossary?ref=nav&lang=en#section', baseUrl).toString();
    await page.waitForFunction((expected) => window.location.href === expected, expectedUrl, { timeout: 15000 });

    const expectedSeoUrl = new URL('/glossary?lang=en', seoOrigin).toString();
    await page.waitForFunction(
        (expected) =>
            document.querySelector('link[rel="canonical"]')?.href === expected &&
            document.querySelector('meta[property="og:url"]')?.getAttribute('content') === expected,
        expectedSeoUrl,
        { timeout: 15000 },
    );

    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
    await page.waitForFunction(
        () => document.querySelector('[data-testid="language-option-en"]')?.getAttribute('aria-pressed') === 'true',
        { timeout: 15000 },
    );
    const afterReload = await getActiveLocale(page);
    if (page.url() !== expectedUrl || !afterReload.enPressed || afterReload.docLang !== 'en') {
        console.error(`❌ [无对照 slug] 刷新后未保持英文 URL/状态: ${page.url()}`);
        return 1;
    }

    const freshContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT, locale: 'zh-CN' });
    try {
        const freshPage = await freshContext.newPage();
        await freshPage.goto(expectedUrl, { waitUntil: 'load', timeout: 60000 });
        await freshPage.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
        const freshLocale = await getActiveLocale(freshPage);
        if (!freshLocale.enPressed || freshLocale.docLang !== 'en') {
            console.error('❌ [无对照 slug] 全新 context 未从降级 URL 恢复英文');
            return 1;
        }
    } finally {
        await freshContext.close();
    }

    console.log('   无对照 slug: 参数/hash、SEO、刷新与全新 context 均正确');
    return 0;
}

/**
 * 语言切换后的普通站内 Link 必须继续携带 locale；复制目标页 URL 到无存储 context
 * 后，URL 本身应足以恢复语言。
 * @returns {Promise<number>} issue count
 */
async function runCrossPageLanguageCheck(browser, page) {
    console.log('🔎 正在验证切换英文后的跨页导航与无存储分享 URL...');
    await page.goto(new URL('/?lang=zh', baseUrl).toString(), { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
    await page.locator('[data-testid="language-option-en"]').first().click();
    await page.locator('[data-testid="navbar-link-navbar_terminology_list"]').click();

    const expectedUrl = new URL('/glossary?lang=en', baseUrl).toString();
    const expectedSeoUrl = new URL('/glossary?lang=en', seoOrigin).toString();
    try {
        await page.waitForFunction(
            ({ url, seoUrl }) =>
                window.location.href === url &&
                document.querySelector('link[rel="canonical"]')?.href === seoUrl &&
                document.querySelector('meta[property="og:url"]')?.getAttribute('content') === seoUrl &&
                document.querySelector('link[rel="alternate"][hreflang="en"]')?.href === seoUrl,
            { url: expectedUrl, seoUrl: expectedSeoUrl },
            { timeout: 15000 },
        );
    } catch {
        console.error(`❌ [跨页语言 URL] 期望 ${expectedUrl} 且 SEO 同步，实际: ${page.url()}`);
        return 1;
    }

    const freshContext = await browser.newContext({ viewport: DESKTOP_VIEWPORT, locale: 'zh-CN' });
    try {
        const freshPage = await freshContext.newPage();
        await freshPage.goto(expectedUrl, { waitUntil: 'load', timeout: 60000 });
        await freshPage.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
        const freshLocale = await getActiveLocale(freshPage);
        if (!freshLocale.enPressed || freshLocale.docLang !== 'en') {
            console.error('❌ [跨页语言 URL] 全新 context 未从复制的术语表 URL 恢复英文');
            return 1;
        }
    } finally {
        await freshContext.close();
    }

    console.log('   跨页导航与全新 context 均从 /glossary?lang=en 保持英文');
    return 0;
}

/**
 * 教程页必须渲染真实语言入口，并在点击三种语言时保留当前深链位置。
 * @returns {Promise<number>} issue count
 */
async function runTutorialLanguageChecks(page) {
    const startUrl = new URL('/tutorial?lang=zh&ref=nav#step-one', baseUrl).toString();
    console.log(`🔎 正在验证教程页三语言切换入口: ${startUrl}`);
    await navigateToMountedTutorial(page, startUrl);

    for (const locale of ['zh-TW', 'en', 'zh']) {
        await page.locator(`[data-testid="language-option-${locale}"]`).first().click();
        const expectedUrl = new URL(`/tutorial?ref=nav&lang=${locale}#step-one`, baseUrl).toString();
        const expectedSeoUrl = new URL(`/tutorial?lang=${locale}`, seoOrigin).toString();
        try {
            await page.waitForFunction(
                ({ lang, url, seoUrl }) =>
                    document.querySelector(`[data-testid="language-option-${lang}"]`)?.getAttribute('aria-pressed') ===
                        'true' &&
                    window.location.href === url &&
                    document.querySelector('link[rel="canonical"]')?.href === seoUrl &&
                    document.querySelector('meta[property="og:url"]')?.getAttribute('content') === seoUrl &&
                    document.querySelector(`link[rel="alternate"][hreflang="${lang}"]`)?.href === seoUrl,
                { lang: locale, url: expectedUrl, seoUrl: expectedSeoUrl },
                { timeout: 15000 },
            );
        } catch {
            console.error(`❌ [教程页语言切换] ${locale} 未保持路由/参数/hash 或 SEO: ${page.url()}`);
            return 1;
        }
    }

    console.log('   教程页 zh-TW / en / zh 均可真实点击并保持深链与 SEO');
    return 0;
}

function reportIssueWhen(condition, message) {
    if (!condition) return 0;
    console.error(message);
    return 1;
}

function validateZhTWState(state, cookie, phase) {
    let issues = 0;
    issues += reportIssueWhen(
        !cookie || cookie.value !== 'zh-TW',
        `❌ [${phase}] cookie 期望 language=zh-TW，实际: ${cookie?.value ?? '(无)'}`,
    );
    issues += reportIssueWhen(
        state.zhTWPressed !== true || state.enPressed !== false || state.zhPressed !== false,
        `❌ [${phase}] 期望仅 zh-TW 选中，实际 en=${state.enPressed} zh=${state.zhPressed} zh-TW=${state.zhTWPressed}`,
    );
    issues += reportIssueWhen(
        state.homeLinkText !== '首頁',
        `❌ [${phase}] 繁体文案期望「首頁」，实际: ${state.homeLinkText}`,
    );
    return issues;
}

function isInsecureDeploymentCookie(cookie) {
    const requiresSecureCookie = ENV === 'production' || ENV === 'staging';
    return requiresSecureCookie && cookie && !cookie.secure;
}

async function checkInitialHomeState({ context, page }) {
    console.log(`🔎 正在打开首页: ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
    const state = await getActiveLocale(page);
    const cookie = await getLanguageCookie(context);
    let issues = reportIssueWhen(cookie, `❌ [初始状态] 未点击前不应存在 language cookie，实际: ${cookie?.value}`);
    issues += reportIssueWhen(
        state.zhPressed !== true,
        `❌ [初始状态] 默认语言应为中文（zh 的 aria-pressed=true），实际 en=${state.enPressed} zh=${state.zhPressed} zh-TW=${state.zhTWPressed}`,
    );
    if (issues === 0) console.log('   初始状态: 中文（无 cookie）');
    return issues;
}

async function reportSeoIssue(page, locale, phase) {
    try {
        await assertLanguageUrlAndSeo(page, locale);
        return 0;
    } catch (e) {
        console.error(`❌ [URL / SEO 同步] ${phase} ${e.message}`);
        return 1;
    }
}

async function clickEnglishAndCheck({ context, page }) {
    console.log('🔎 正在点击 EN 切换按钮...');
    await page.locator('[data-testid="language-option-en"]').first().click();
    await page.waitForFunction(
        () => document.querySelector('[data-testid="language-option-en"]')?.getAttribute('aria-pressed') === 'true',
        { timeout: 15000 },
    );
    const state = await getActiveLocale(page);
    const cookie = await getLanguageCookie(context);
    let issues = reportIssueWhen(
        !cookie || cookie.value !== 'en',
        `❌ [cookie 写入] 点击 EN 后 cookie 期望 language=en，实际: ${cookie?.value ?? '(无)'}`,
    );
    issues += reportIssueWhen(
        isInsecureDeploymentCookie(cookie),
        '❌ [cookie Secure] 生产/预发环境 language cookie 应含 Secure 标志',
    );
    issues += reportIssueWhen(
        state.enPressed !== true || state.zhPressed !== false || state.zhTWPressed !== false,
        `❌ [UI 切换] 点击 EN 后期望仅 en 选中，实际 en=${state.enPressed} zh=${state.zhPressed} zh-TW=${state.zhTWPressed}`,
    );
    issues += reportIssueWhen(
        state.docLang !== 'en',
        `❌ [document.lang] 点击 EN 后期望 <html lang="en">，实际: ${state.docLang}`,
    );
    issues += await reportSeoIssue(page, 'en', '点击 EN 后');
    if (issues === 0) console.log('   点击 EN 后: UI 切换为英文，cookie=language=en');
    return issues;
}

async function reloadEnglishAndCheck({ context, page }) {
    console.log('🔎 正在刷新页面，验证语言持久化...');
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
    const state = await getActiveLocale(page);
    const cookie = await getLanguageCookie(context);
    let issues = reportIssueWhen(
        !cookie || cookie.value !== 'en',
        `❌ [持久化] 刷新后 cookie 期望 language=en，实际: ${cookie?.value ?? '(无)'}`,
    );
    issues += reportIssueWhen(
        state.enPressed !== true || state.zhPressed !== false || state.zhTWPressed !== false,
        `❌ [持久化] 刷新后期望仍为英文（仅 en 选中），实际 en=${state.enPressed} zh=${state.zhPressed} zh-TW=${state.zhTWPressed}`,
    );
    if (issues === 0) console.log('   刷新后: 仍为英文，cookie 持久化生效');
    return issues;
}

async function clickTraditionalChineseAndCheck({ context, page }) {
    console.log('🔎 正在点击 zh-TW 切换按钮...');
    await page.locator('[data-testid="language-option-zh-TW"]').first().click();
    await page.waitForFunction(
        () => document.querySelector('[data-testid="language-option-zh-TW"]')?.getAttribute('aria-pressed') === 'true',
        { timeout: 15000 },
    );
    const state = await getActiveLocale(page);
    const cookie = await getLanguageCookie(context);
    let issues = validateZhTWState(state, cookie, 'cookie 写入 / UI 切换');
    issues += reportIssueWhen(
        state.docLang !== 'zh-TW',
        `❌ [document.lang] 点击 zh-TW 后期望 <html lang="zh-TW">，实际: ${state.docLang}`,
    );
    issues += await reportSeoIssue(page, 'zh-TW', '点击 zh-TW 后');
    if (issues === 0) console.log('   点击 zh-TW 后: UI 切换为繁体，cookie=language=zh-TW');
    return issues;
}

async function reloadTraditionalAndSwitchToChinese({ context, page }) {
    console.log('🔎 正在刷新页面，验证 zh-TW 语言持久化...');
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    await page.waitForSelector('[data-testid="language-select"]', { timeout: 30000 });
    const state = await getActiveLocale(page);
    const cookie = await getLanguageCookie(context);
    let issues = validateZhTWState(state, cookie, '持久化');
    console.log('🔎 正在点击 zh 切换按钮，验证简中 URL / SEO 同步...');
    await page.locator('[data-testid="language-option-zh"]').first().click();
    try {
        await page.waitForFunction(
            () => document.querySelector('[data-testid="language-option-zh"]')?.getAttribute('aria-pressed') === 'true',
            { timeout: 15000 },
        );
        await assertLanguageUrlAndSeo(page, 'zh');
    } catch (e) {
        console.error(`❌ [URL / SEO 同步] 点击 zh 后 ${e.message}`);
        issues++;
    }
    if (issues === 0) console.log('   刷新后: 仍为繁体，cookie 持久化生效');
    return issues;
}

function createMainStages(deps, browser, context, page) {
    const state = { browser, context, page };
    return [
        { run: () => deps.checkInitialHomeState(state), failure: '❌ 初始状态异常，终止后续检查。' },
        { run: () => deps.clickEnglishAndCheck(state), failure: '❌ 点击 EN 后断言失败，终止后续检查。' },
        { run: () => deps.reloadEnglishAndCheck(state), failure: '❌ EN 持久化断言失败，终止后续检查。' },
        { run: () => deps.clickTraditionalChineseAndCheck(state), failure: '❌ 点击 zh-TW 后断言失败，终止后续检查。' },
        { run: () => deps.reloadTraditionalAndSwitchToChinese(state) },
        { run: () => deps.runCrossPageLanguageCheck(browser, page) },
        { run: () => deps.runTutorialLanguageChecks(page) },
        { run: () => deps.runGlossarySlugLanguageChecks(page) },
        { run: () => deps.runGlossaryMissingAlternateCheck(browser, page) },
    ];
}

async function runStages(stages) {
    for (const stage of stages) {
        const issues = await stage.run();
        if (issues > 0) {
            if (stage.failure) console.error(stage.failure);
            return issues;
        }
    }
    return 0;
}

const defaultRunDependencies = {
    launchBrowser: () => chromium.launch(),
    runLangQueryLandingChecks,
    checkInitialHomeState,
    clickEnglishAndCheck,
    reloadEnglishAndCheck,
    clickTraditionalChineseAndCheck,
    reloadTraditionalAndSwitchToChinese,
    runCrossPageLanguageCheck,
    runTutorialLanguageChecks,
    runGlossarySlugLanguageChecks,
    runGlossaryMissingAlternateCheck,
};

async function runMainContextStages(browser, deps) {
    const context = await browser.newContext({ viewport: DESKTOP_VIEWPORT, locale: 'zh-CN' });
    try {
        const page = await context.newPage();
        return await runStages(createMainStages(deps, browser, context, page));
    } finally {
        await context.close();
    }
}

async function run(dependencyOverrides = {}) {
    if (!baseUrl) {
        console.error(`❌ 未知环境: ${ENV}`);
        return 1;
    }
    const deps = { ...defaultRunDependencies, ...dependencyOverrides };
    console.log(`🚀 [E2E] 正在为 [${ENV}] 验证语言切换端到端流程...`);
    console.log(`🔗 目标 URL: ${baseUrl}`);
    const browser = await deps.launchBrowser();
    let issues = 0;
    try {
        issues = await deps.runLangQueryLandingChecks(browser);
        if (issues > 0) console.error('❌ ?lang= 深链落地断言失败，终止后续检查。');
        if (issues === 0) issues = await runMainContextStages(browser, deps);
        if (issues === 0) {
            console.log(
                '✅ [成功] 语言切换端到端流程通过：?lang= 深链落地；三种语言 URL/SEO 同步；词条页对照 slug 与无对照降级均保持可分享 URL',
            );
        }
    } catch (e) {
        console.error(`❌ [错误] ${e.message}`);
        issues++;
    } finally {
        await browser.close();
    }
    return issues;
}

async function main(runChecks = run) {
    try {
        const issues = await runChecks();
        process.exitCode = issues > 0 ? 1 : 0;
    } catch (err) {
        console.error('致命错误:', err);
        process.exitCode = 1;
    }
}

module.exports = {
    MISSING_EN_ALTERNATE_TERM,
    buildMissingEnglishAlternateSourcePath,
    main,
    run,
    __test: { assertLangQueryLanding, assertLandingState, runStages },
};

if (require.main === module) {
    void main();
}
