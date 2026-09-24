/**
 * 按路由等待 SPA 页面级 data-testid，避免 #laiwan 静态壳误判已挂载。
 */

const MOUNT_SELECTORS = {
    home: '[data-testid="home-title"]',
    glossaryList: '[data-testid="glossary-header"]',
    glossaryDefinition: '[data-testid="definition-term-name"]',
    h5Tutorial: '[data-testid="h5-tutorial-url-link-0"]',
    tutorial: '[data-testid="tutorial-step-one"]',
    learning: '[data-testid="learning-page"]',
};

/** 导航性能门禁用的「页面实际可用」选择器（严于挂载） */
const READY_SELECTORS = {
    learningPage: '[data-testid="learning-page"]',
    learningCover: '[data-testid="learning-book-cover"]',
    glossaryFirstTerm: '[data-testid^="glossary-term-name-"]',
};

/**
 * 与 App 路由对齐：
 * - /glossary/:locale → Navigate 到 /glossary → glossary-header
 * - /glossary/:anyLocale/:term → Definition（非法 locale 会 normalize 后仍挂定义页）
 *
 * @param {string} pathname
 * @returns {{ selector: string, label: string }}
 */
function getMountSelector(pathname) {
    if (pathname === '/' || pathname === '') {
        return { selector: MOUNT_SELECTORS.home, label: 'home-title' };
    }
    if (pathname === '/glossary') {
        return { selector: MOUNT_SELECTORS.glossaryList, label: 'glossary-header' };
    }
    // 定义页：任意 locale（合法/非法）+ term
    if (/^\/glossary\/[^/]+\/[^/]+$/.test(pathname)) {
        return { selector: MOUNT_SELECTORS.glossaryDefinition, label: 'definition-term-name' };
    }
    // 仅 locale：合法与否都会落到术语列表（重定向到 /glossary）
    if (/^\/glossary\/[^/]+$/.test(pathname)) {
        return { selector: MOUNT_SELECTORS.glossaryList, label: 'glossary-header' };
    }
    if (pathname.startsWith('/h5-tutorial/')) {
        return { selector: MOUNT_SELECTORS.h5Tutorial, label: 'h5-tutorial-url-link-0' };
    }
    if (pathname === '/tutorial') {
        return { selector: MOUNT_SELECTORS.tutorial, label: 'tutorial-step-one' };
    }
    if (pathname === '/learning') {
        return { selector: MOUNT_SELECTORS.learning, label: 'learning-page' };
    }
    return { selector: MOUNT_SELECTORS.home, label: 'home-title' };
}

/**
 * @param {import('playwright').Page} page
 * @param {string} pathname
 * @param {{ timeout?: number }} [options]
 * @returns {Promise<{ mounted: boolean, label: string }>}
 */
async function assertPageMounted(page, pathname, { timeout = 15000 } = {}) {
    const { selector, label } = getMountSelector(pathname);

    try {
        await page.waitForSelector(selector, { timeout });
        return { mounted: true, label };
    } catch {
        return { mounted: false, label };
    }
}

module.exports = {
    assertPageMounted,
    getMountSelector,
    MOUNT_SELECTORS,
    READY_SELECTORS,
};
