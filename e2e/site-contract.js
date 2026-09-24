// 与被测站点当前发布的 sitemap 和 SEO 契约保持一致。
const SITE_ORIGIN = 'https://www.goplay.appcookies.com';
const SEO_LOCALES = ['zh', 'zh-TW', 'en'];
const STATIC_PATHS = [
    '/',
    '/glossary',
    '/learning',
    '/tutorial',
    '/h5-tutorial/laiwan-life',
    '/h5-tutorial/laiwanpai-com',
];

function buildStaticPageUrls(paths, locales = SEO_LOCALES, origin = SITE_ORIGIN) {
    return paths.flatMap((pathname) => locales.map((locale) => `${origin}${pathname}?lang=${encodeURIComponent(locale)}`));
}

module.exports = { SITE_ORIGIN, SEO_LOCALES, STATIC_PATHS, buildStaticPageUrls };
