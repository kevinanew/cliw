const LANGUAGE_COOKIE_KEY = 'language';

const LOCALES = [
    { code: 'zh', label: '中文' },
    { code: 'zh-TW', label: '繁中' },
    { code: 'en', label: 'English' },
];

const VIEWPORTS = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'small-desktop', width: 1024, height: 768 },
    { label: 'mobile', width: 375, height: 812 },
    { label: 'pixel-9', width: 412, height: 923 },
];

const PIXEL_9_LEARNING_VIEWPORT = VIEWPORTS.find((viewport) => viewport.label === 'pixel-9');
const WIDE_VIEWPORT_LABELS = ['desktop', 'small-desktop'];
const NARROW_VIEWPORT_LABELS = ['mobile', 'pixel-9'];

// 专项场景的范围必须在这里显式声明。测试会逐项验证这些范围，避免新语言或
// 新视口因为历史上的条件分支而被静默漏掉。
const SPECIAL_SCENARIO_SCOPES = Object.freeze({
    mobileMenu: { locales: 'all', viewports: NARROW_VIEWPORT_LABELS, reason: '仅窄屏显示汉堡菜单' },
    languageSwitch: {
        locales: ['zh'],
        viewports: NARROW_VIEWPORT_LABELS,
        reason: '验证从简中切换到英文的跨语言流程；目标英文由同一场景覆盖',
    },
    tutorialDrawer: { locales: 'all', viewports: NARROW_VIEWPORT_LABELS, reason: '教程 Drawer 仅窄屏存在' },
    appleModal: { locales: 'all', viewports: 'all', reason: '弹窗在全部语言和响应式形态均存在' },
    learningRating: { locales: 'all', viewports: 'all', reason: '宽屏使用 hover，窄屏使用 focus' },
    glossaryIndex: { locales: 'all', viewports: WIDE_VIEWPORT_LABELS, reason: '字母索引仅宽屏显示' },
    glossaryDefinition: { locales: 'all', viewports: 'all', reason: '词条详情适用于全部组合' },
    glossaryNotFound: { locales: 'all', viewports: 'all', reason: '词条不存在态适用于全部组合' },
    glossarySearch: { locales: 'all', viewports: 'all', reason: '搜索在全部组合存在，窄屏使用导航搜索框' },
});

const PAGES = [
    {
        label: 'homepage',
        path: '/',
        readyText: {
            zh: '德州扑克约局社区',
            'zh-TW': '德州撲克約局社群',
            en: "Texas Hold'em Poker Game Community",
        },
    },
    {
        label: 'tutorial',
        path: '/tutorial',
        readyText: {
            zh: '一、注册一个新的AppleID并下载来玩:',
            'zh-TW': '一、註冊一個新的AppleID並下載來玩:',
            en: '1. Register a new Apple ID and download GoPlay360',
        },
    },
    {
        label: 'learning',
        path: '/learning',
        readyText: {
            zh: '无限德州扑克进阶指南',
            'zh-TW': '無限德州撲克進階指南',
            en: "No-Limit Hold'em For Advanced Players",
        },
    },
    {
        label: 'glossary',
        path: '/glossary',
        readyPlaceholder: {
            zh: '搜索德州扑克术语',
            'zh-TW': '搜尋德州撲克術語',
            en: 'Search glossary',
        },
        waitForLoading: true,
    },
    {
        label: 'h5-laiwan-life',
        path: '/h5-tutorial/laiwan-life',
        readyText: {
            zh: '什么是H5？',
            'zh-TW': '什麼是H5？',
            en: 'What is H5?',
        },
    },
    {
        label: 'h5-laiwanpai-com',
        path: '/h5-tutorial/laiwanpai-com',
        readyText: {
            zh: '什么是H5？',
            'zh-TW': '什麼是H5？',
            en: 'What is H5?',
        },
    },
];

// 部分专项测试用它确认不同 UA 不影响视口驱动的教程布局。
const MOBILE_USER_AGENT =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const MOBILE_MENU_OPEN_SCENARIO = {
    pageLabel: 'homepage',
    locale: 'zh',
    viewportLabel: 'mobile',
    labelSuffix: 'menu_open',
    clickSelector: '[data-testid="navbar-mobile-menu-button"]',
    // Prefer selector readiness over fixed timeout so slow CI does not capture a half-open menu.
    postInteractionWait: '[data-testid="navbar-mobile-menu"]',
};

const MOBILE_LANGUAGE_SWITCH_SCENARIO = {
    pageLabel: 'homepage',
    locale: 'zh',
    viewportLabel: 'mobile',
    labelSuffix: 'language_switch_en',
    clickSelectors: [
        '[data-testid="navbar-mobile-menu-button"]',
        '[data-testid="navbar-mobile-menu"] [data-testid="language-option-en"]',
    ],
    postInteractionHide: '[data-testid="navbar-mobile-menu"]',
    selectors: ['viewport'],
};

// 教程页独立的 MUI Drawer 导航（与首页 NavBar 汉堡菜单不同）
const TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO = {
    pageLabel: 'tutorial',
    locale: 'zh',
    viewportLabel: 'mobile',
    labelSuffix: 'drawer_open',
    clickSelector: '[data-testid="mobile-nav-menu-button"]',
    postInteractionWait: '[data-testid="mobile-drawer-content"]',
    // 教程页很长；整页截图会把 fixed Drawer 冲掉，只截当前视口
    selectors: ['viewport'],
};

// Apple 下载弹窗：桌面 + 移动端（弹窗有 xs/sm 响应式样式）
const APPLE_DOWNLOAD_MODAL_SCENARIOS = [
    {
        pageLabel: 'homepage',
        viewportLabels: WIDE_VIEWPORT_LABELS,
        labelSuffix: 'apple_modal_open',
        clickSelector: '#apple-download-button',
        postInteractionWait: '#ios-download-modal',
    },
    {
        pageLabel: 'homepage',
        viewportLabels: NARROW_VIEWPORT_LABELS,
        labelSuffix: 'apple_modal_open',
        clickSelector: '#apple-download-button',
        postInteractionWait: '#ios-download-modal',
        singleLineSelectors: ['[data-testid="ios-product-name"]'],
    },
];

/** @deprecated 请用 APPLE_DOWNLOAD_MODAL_SCENARIOS；保留桌面端单项以兼容旧引用 */
const APPLE_DOWNLOAD_MODAL_SCENARIO = APPLE_DOWNLOAD_MODAL_SCENARIOS[0];

const LEARNING_RATING_INTERACTION_SCENARIOS = [
    {
        viewportLabels: WIDE_VIEWPORT_LABELS,
        labelSuffix: 'rating_hover',
        hoverSelector: 'article:first-of-type [data-testid="learning-rating-link"]',
    },
    {
        viewportLabels: NARROW_VIEWPORT_LABELS,
        labelSuffix: 'rating_focus',
        focusSelector: 'article:first-of-type [data-testid="learning-rating-link"]',
    },
];

const GLOSSARY_CLICK_INDEX_SCENARIOS = [
    {
        pageLabel: 'glossary',
        labelSuffix: 'click_index_a',
        clickSelector: '[data-testid="glossary-letter-A"]',
        // Prefer group-in-viewport readiness over fixed timeout (scrollIntoView).
        postInteractionWait: '#group-A',
        selectors: ['viewport'],
    },
    {
        pageLabel: 'glossary',
        labelSuffix: 'click_index_h',
        clickSelector: '[data-testid="glossary-letter-H"]',
        // H 组变短后 content-visibility 的占位高度切换可能把它推出视口；
        // 先等待 React 提交选中态，再用真实布局重新对齐目标。
        postInteractionWait: '[data-testid="glossary-page"][data-index-navigation-ready="true"]',
        scrollToSelector: '#group-H',
        selectors: ['viewport'],
    },
];

// 各语言固定词条详情页（中英文 slug 不同）。
// 选内容最丰富的词条：三语均为 10 个可链接 + 1 个纯文本相关主题，正文多段，
// 能同时覆盖多段落排版、相关主题换行与同组术语侧栏。
const GLOSSARY_DEFINITION_TERMS = {
    zh: { term: 'dezhoupuke', readyText: '德州扑克' },
    'zh-TW': { term: 'dezhoupuke', readyText: '德州撲克' },
    en: { term: 'texasholdem', readyText: "Texas Hold'em" },
};

// 词条不存在态使用各语言路由下同一个确定性无效 slug。
const GLOSSARY_DEFINITION_NOT_FOUND_SCENARIO = {
    term: 'not-a-real-term-visual',
    // The state container is less timing-sensitive than a link label during the
    // definition page's initial transition.
    readySelector: '[data-testid="definition-not-found"]',
};

// 术语表搜索过滤（desktop 用主搜索框；mobile 用导航栏搜索框）
const GLOSSARY_SEARCH_QUERIES = {
    zh: '诈唬',
    'zh-TW': '詐唬',
    en: 'bluff',
};

// 过滤完成后应可见的目标词条（与 GLOSSARY_SEARCH_QUERIES 对齐）
const GLOSSARY_SEARCH_READY_SELECTORS = {
    zh: '[data-testid="glossary-term-banzhahu"]',
    'zh-TW': '[data-testid="glossary-term-banzhahu"]',
    en: '[data-testid="glossary-term-bluff"]',
};

// 过滤前存在、过滤后应卸下的词条（避免目标词条过滤前已在 DOM 导致 wait 立刻返回）
const GLOSSARY_SEARCH_HIDE_SELECTORS = {
    zh: '[data-testid="glossary-term-agaodepaixingzuhe"]',
    'zh-TW': '[data-testid="glossary-term-agaodepaixingzuhe"]',
    en: '[data-testid="glossary-term-acehigh"]',
};

/**
 * 解析 VISUAL_LOCALES：默认 zh；`all` 为全部语言；也可传逗号分隔 code（如 zh,en）。
 * @param {string|undefined} localesEnv
 * @returns {typeof LOCALES}
 */
function resolveLocales(localesEnv = process.env.VISUAL_LOCALES) {
    const raw = (localesEnv ?? 'zh').trim() || 'zh';
    if (raw === 'all') {
        return LOCALES;
    }

    const codes = raw
        .split(',')
        .map((code) => code.trim())
        .filter(Boolean);
    return codes.map((code) => {
        const locale = LOCALES.find((item) => item.code === code);
        if (!locale) {
            throw new Error(
                `Unknown locale in VISUAL_LOCALES: "${code}". ` +
                    `Allowed: ${LOCALES.map((item) => item.code).join(', ')}, or all`,
            );
        }
        return locale;
    });
}

/**
 * 解析 VISUAL_VIEWPORTS：未设置或 `all` 为全部视口；也可传逗号分隔 label。
 * @param {string|undefined} viewportsEnv
 * @returns {typeof VIEWPORTS}
 */
function resolveViewports(viewportsEnv = process.env.VISUAL_VIEWPORTS) {
    const raw = (viewportsEnv ?? '').trim();
    if (!raw || raw === 'all') {
        return VIEWPORTS;
    }

    const labels = raw
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);
    return labels.map((label) => {
        const viewport = VIEWPORTS.find((item) => item.label === label);
        if (!viewport) {
            throw new Error(
                `Unknown viewport in VISUAL_VIEWPORTS: "${label}". ` +
                    `Allowed: ${VIEWPORTS.map((item) => item.label).join(', ')}, or all`,
            );
        }
        return viewport;
    });
}

function scenarioLabel(locale, viewport, pageLabel, suffix = '') {
    const base = `${locale.code}_${viewport.label}_${pageLabel}`;
    return suffix ? `${base}_${suffix}` : base;
}

function buildScenario(baseUrl, page, locale, viewport, overrides = {}) {
    const url = `${baseUrl}${page.path}`;

    return {
        label: overrides.label ?? scenarioLabel(locale, viewport, page.label),
        url,
        locale: locale.code,
        readyText: page.readyText?.[locale.code],
        readyPlaceholder: page.readyPlaceholder?.[locale.code],
        readySelector: page.readySelector,
        waitForLoading: page.waitForLoading ?? false,
        delay: 300,
        clickSelector: '',
        postInteractionWait: 0,
        // document = 整页；viewport = 当前视口
        selectors: ['document'],
        viewports: [viewport],
        ...overrides,
    };
}

function buildLocaleViewportScenarios(baseUrl, locale, viewport) {
    const scenarios = PAGES.map((page) => buildScenario(baseUrl, page, locale, viewport));

    if (SPECIAL_SCENARIO_SCOPES.mobileMenu.viewports.includes(viewport.label)) {
        const page = PAGES.find((item) => item.label === MOBILE_MENU_OPEN_SCENARIO.pageLabel);
        scenarios.push(
            buildScenario(baseUrl, page, locale, viewport, {
                label: scenarioLabel(
                    locale,
                    viewport,
                    MOBILE_MENU_OPEN_SCENARIO.pageLabel,
                    MOBILE_MENU_OPEN_SCENARIO.labelSuffix,
                ),
                clickSelector: MOBILE_MENU_OPEN_SCENARIO.clickSelector,
                postInteractionWait: MOBILE_MENU_OPEN_SCENARIO.postInteractionWait,
            }),
        );
    }

    if (
        locale.code === MOBILE_LANGUAGE_SWITCH_SCENARIO.locale &&
        SPECIAL_SCENARIO_SCOPES.languageSwitch.viewports.includes(viewport.label)
    ) {
        const page = PAGES.find((item) => item.label === MOBILE_LANGUAGE_SWITCH_SCENARIO.pageLabel);
        scenarios.push(
            buildScenario(baseUrl, page, locale, viewport, {
                label: scenarioLabel(
                    locale,
                    viewport,
                    MOBILE_LANGUAGE_SWITCH_SCENARIO.pageLabel,
                    MOBILE_LANGUAGE_SWITCH_SCENARIO.labelSuffix,
                ),
                clickSelectors: MOBILE_LANGUAGE_SWITCH_SCENARIO.clickSelectors,
                postInteractionHide: MOBILE_LANGUAGE_SWITCH_SCENARIO.postInteractionHide,
                selectors: MOBILE_LANGUAGE_SWITCH_SCENARIO.selectors,
            }),
        );
    }

    if (SPECIAL_SCENARIO_SCOPES.tutorialDrawer.viewports.includes(viewport.label)) {
        const page = PAGES.find((item) => item.label === TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.pageLabel);
        scenarios.push(
            buildScenario(baseUrl, page, locale, viewport, {
                label: scenarioLabel(
                    locale,
                    viewport,
                    TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.pageLabel,
                    TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.labelSuffix,
                ),
                clickSelector: TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.clickSelector,
                postInteractionWait: TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.postInteractionWait,
                selectors: TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.selectors,
            }),
        );
    }

    APPLE_DOWNLOAD_MODAL_SCENARIOS.forEach((config) => {
        if (!config.viewportLabels.includes(viewport.label)) {
            return;
        }
        const page = PAGES.find((item) => item.label === config.pageLabel);
        scenarios.push(
            buildScenario(baseUrl, page, locale, viewport, {
                label: scenarioLabel(locale, viewport, config.pageLabel, config.labelSuffix),
                clickSelector: config.clickSelector,
                postInteractionWait: config.postInteractionWait,
                // 英文提示文案没有富文本 product-name span；弹窗本身仍完整覆盖。
                singleLineSelectors: locale.code === 'en' ? undefined : config.singleLineSelectors,
            }),
        );
    });

    LEARNING_RATING_INTERACTION_SCENARIOS.forEach((config) => {
        if (!config.viewportLabels.includes(viewport.label)) {
            return;
        }
        const page = PAGES.find((item) => item.label === 'learning');
        scenarios.push(
            buildScenario(baseUrl, page, locale, viewport, {
                label: scenarioLabel(locale, viewport, page.label, config.labelSuffix),
                hoverSelector: config.hoverSelector,
                focusSelector: config.focusSelector,
                selectors: ['viewport'],
            }),
        );
    });

    if (SPECIAL_SCENARIO_SCOPES.glossaryIndex.viewports.includes(viewport.label)) {
        const glossaryPage = PAGES.find((item) => item.label === 'glossary');
        GLOSSARY_CLICK_INDEX_SCENARIOS.forEach((config) => {
            scenarios.push(
                buildScenario(baseUrl, glossaryPage, locale, viewport, {
                    label: scenarioLabel(locale, viewport, config.pageLabel, config.labelSuffix),
                    clickSelector: config.clickSelector,
                    postInteractionWait: config.postInteractionWait,
                    selectors: config.selectors,
                }),
            );
        });
    }

    const termConfig = GLOSSARY_DEFINITION_TERMS[locale.code];
    const definitionPage = {
        label: 'glossary_definition',
        path: `/glossary/${locale.code}/${termConfig.term}`,
        readyText: { [locale.code]: termConfig.readyText },
        waitForLoading: true,
    };
    scenarios.push(buildScenario(baseUrl, definitionPage, locale, viewport));

    const notFoundPage = {
        label: 'glossary_definition_not_found',
        path: `/glossary/${locale.code}/${GLOSSARY_DEFINITION_NOT_FOUND_SCENARIO.term}`,
        readySelector: GLOSSARY_DEFINITION_NOT_FOUND_SCENARIO.readySelector,
        waitForLoading: true,
    };
    scenarios.push(buildScenario(baseUrl, notFoundPage, locale, viewport));

    const glossaryPage = PAGES.find((item) => item.label === 'glossary');
    const searchSelector = NARROW_VIEWPORT_LABELS.includes(viewport.label)
        ? '[data-testid="glossary-mobile-search-input"]'
        : '[data-testid="glossary-search-input"]';
    scenarios.push(
        buildScenario(baseUrl, glossaryPage, locale, viewport, {
            label: scenarioLabel(locale, viewport, glossaryPage.label, 'search_filter'),
            keyPressSelector: {
                selector: searchSelector,
                keyPress: GLOSSARY_SEARCH_QUERIES[locale.code],
            },
            postInteractionWait: GLOSSARY_SEARCH_READY_SELECTORS[locale.code],
            scrollIntoViewSelector:
                viewport.label === 'small-desktop' ? GLOSSARY_SEARCH_READY_SELECTORS[locale.code] : undefined,
            postInteractionHide: GLOSSARY_SEARCH_HIDE_SELECTORS[locale.code],
            selectors: ['viewport'],
        }),
    );

    return scenarios;
}

/**
 * @param {string} baseUrl
 * @param {{ locales?: typeof LOCALES, localesEnv?: string, viewports?: typeof VIEWPORTS, viewportsEnv?: string }} [options]
 */
function buildScenarios(baseUrl, options = {}) {
    const locales = options.locales ?? resolveLocales(options.localesEnv);
    const viewports = options.viewports ?? resolveViewports(options.viewportsEnv);

    const scenarios = locales.flatMap((locale) =>
        viewports.flatMap((viewport) => buildLocaleViewportScenarios(baseUrl, locale, viewport)),
    );

    return scenarios;
}

module.exports = {
    LANGUAGE_COOKIE_KEY,
    LOCALES,
    VIEWPORTS,
    WIDE_VIEWPORT_LABELS,
    NARROW_VIEWPORT_LABELS,
    SPECIAL_SCENARIO_SCOPES,
    PIXEL_9_LEARNING_VIEWPORT,
    PAGES,
    MOBILE_USER_AGENT,
    MOBILE_MENU_OPEN_SCENARIO,
    MOBILE_LANGUAGE_SWITCH_SCENARIO,
    TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO,
    APPLE_DOWNLOAD_MODAL_SCENARIO,
    APPLE_DOWNLOAD_MODAL_SCENARIOS,
    LEARNING_RATING_INTERACTION_SCENARIOS,
    GLOSSARY_CLICK_INDEX_SCENARIOS,
    GLOSSARY_DEFINITION_TERMS,
    GLOSSARY_DEFINITION_NOT_FOUND_SCENARIO,
    GLOSSARY_SEARCH_QUERIES,
    GLOSSARY_SEARCH_READY_SELECTORS,
    GLOSSARY_SEARCH_HIDE_SELECTORS,
    resolveLocales,
    resolveViewports,
    scenarioLabel,
    buildScenarios,
};
