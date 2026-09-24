import {
    LOCALES,
    VIEWPORTS,
    WIDE_VIEWPORT_LABELS,
    NARROW_VIEWPORT_LABELS,
    SPECIAL_SCENARIO_SCOPES,
    PIXEL_9_LEARNING_VIEWPORT,
    PAGES,
    MOBILE_MENU_OPEN_SCENARIO,
    MOBILE_LANGUAGE_SWITCH_SCENARIO,
    TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO,
    APPLE_DOWNLOAD_MODAL_SCENARIO,
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
} from './scenarios';

describe('resolveLocales', () => {
    const originalEnv = process.env.VISUAL_LOCALES;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.VISUAL_LOCALES;
        } else {
            process.env.VISUAL_LOCALES = originalEnv;
        }
    });

    test('默认只返回简中 zh', () => {
        delete process.env.VISUAL_LOCALES;
        expect(resolveLocales(undefined).map((locale) => locale.code)).toEqual(['zh']);
        expect(resolveLocales('').map((locale) => locale.code)).toEqual(['zh']);
        expect(resolveLocales('zh').map((locale) => locale.code)).toEqual(['zh']);
    });

    test('all 返回全部语言', () => {
        expect(resolveLocales('all').map((locale) => locale.code)).toEqual(LOCALES.map((locale) => locale.code));
    });

    test('支持逗号分隔多语言', () => {
        expect(resolveLocales('zh,en').map((locale) => locale.code)).toEqual(['zh', 'en']);
    });

    test('未知语言抛错', () => {
        expect(() => resolveLocales('fr')).toThrow(/Unknown locale/);
    });

    test('读取 process.env.VISUAL_LOCALES', () => {
        process.env.VISUAL_LOCALES = 'en';
        expect(resolveLocales().map((locale) => locale.code)).toEqual(['en']);
    });
});

describe('resolveViewports', () => {
    const originalEnv = process.env.VISUAL_VIEWPORTS;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.VISUAL_VIEWPORTS;
        } else {
            process.env.VISUAL_VIEWPORTS = originalEnv;
        }
    });

    test('未设置或 all 返回全部视口', () => {
        delete process.env.VISUAL_VIEWPORTS;
        expect(resolveViewports(undefined)).toEqual(VIEWPORTS);
        expect(resolveViewports('')).toEqual(VIEWPORTS);
        expect(resolveViewports('all')).toEqual(VIEWPORTS);
    });

    test('支持逗号分隔并拒绝未知视口', () => {
        expect(resolveViewports('desktop,pixel-9').map((viewport) => viewport.label)).toEqual(['desktop', 'pixel-9']);
        expect(() => resolveViewports('tablet')).toThrow(/Unknown viewport/);
    });
});

describe('visual scenarios', () => {
    const allScenarios = buildScenarios('http://127.0.0.1:8080', { localesEnv: 'all', viewportsEnv: 'all' });
    const zhScenarios = buildScenarios('http://127.0.0.1:8080', { localesEnv: 'zh', viewportsEnv: 'all' });
    const definitionScenarioCount = LOCALES.length * VIEWPORTS.length;
    const definitionNotFoundCount = LOCALES.length * VIEWPORTS.length;
    const searchFilterScenarioCount = LOCALES.length * VIEWPORTS.length;
    const interactionScenarioCount =
        LOCALES.length * NARROW_VIEWPORT_LABELS.length + // 菜单
        NARROW_VIEWPORT_LABELS.length + // 简中 -> 英文切换
        LOCALES.length * NARROW_VIEWPORT_LABELS.length + // Drawer
        LOCALES.length * VIEWPORTS.length + // Apple 弹窗
        LOCALES.length * VIEWPORTS.length + // 评分
        LOCALES.length * WIDE_VIEWPORT_LABELS.length * GLOSSARY_CLICK_INDEX_SCENARIOS.length;

    test('默认（简中）场景数量正确', () => {
        expect(zhScenarios).toHaveLength(54);
        zhScenarios.forEach((scenario) => {
            expect(scenario.locale).toBe('zh');
            expect(scenario.label.startsWith('zh_')).toBe(true);
        });
    });

    test('全量场景覆盖每个页面、语言、视口组合', () => {
        const pageScenarioCount = PAGES.length * LOCALES.length * VIEWPORTS.length;
        expect(allScenarios).toHaveLength(
            pageScenarioCount +
                interactionScenarioCount +
                definitionScenarioCount +
                definitionNotFoundCount +
                searchFilterScenarioCount,
        );
        expect(allScenarios).toHaveLength(158);
    });

    test('完整模式恰好包含 12 个非空组合并输出可核对的分组计数', () => {
        const counts = new Map<string, number>();
        allScenarios.forEach((scenario) => {
            const key = `${scenario.locale}/${scenario.viewports[0].label}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        });
        expect(counts.size).toBe(12);
        LOCALES.forEach((locale) =>
            VIEWPORTS.forEach((viewport) => expect(counts.get(`${locale.code}/${viewport.label}`)).toBeGreaterThan(0)),
        );
        expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(allScenarios.length);
    });

    test('所有专项范围都有明确原因，且设备形态范围由统一配置声明', () => {
        Object.values(SPECIAL_SCENARIO_SCOPES).forEach((scope) => expect(scope.reason).toBeTruthy());
        expect(SPECIAL_SCENARIO_SCOPES.mobileMenu.viewports).toEqual(NARROW_VIEWPORT_LABELS);
        expect(SPECIAL_SCENARIO_SCOPES.tutorialDrawer.viewports).toEqual(NARROW_VIEWPORT_LABELS);
        expect(SPECIAL_SCENARIO_SCOPES.glossaryIndex.viewports).toEqual(WIDE_VIEWPORT_LABELS);
        expect(SPECIAL_SCENARIO_SCOPES.languageSwitch.locales).toEqual(['zh']);

        const assertScope = (suffix: string, locales: string[], viewports: string[]) => {
            const actual = allScenarios
                .filter((scenario) => scenario.label.endsWith(suffix))
                .map((scenario) => `${scenario.locale}/${scenario.viewports[0].label}`);
            expect(new Set(actual)).toEqual(
                new Set(locales.flatMap((locale) => viewports.map((viewport) => `${locale}/${viewport}`))),
            );
        };
        const localeCodes = LOCALES.map((locale) => locale.code);
        assertScope('_homepage_menu_open', localeCodes, NARROW_VIEWPORT_LABELS);
        assertScope('_homepage_language_switch_en', ['zh'], NARROW_VIEWPORT_LABELS);
        assertScope('_tutorial_drawer_open', localeCodes, NARROW_VIEWPORT_LABELS);
        assertScope(
            '_homepage_apple_modal_open',
            localeCodes,
            VIEWPORTS.map((viewport) => viewport.label),
        );
        assertScope(
            '_glossary_definition_not_found',
            localeCodes,
            VIEWPORTS.map((viewport) => viewport.label),
        );
        assertScope(
            '_glossary_search_filter',
            localeCodes,
            VIEWPORTS.map((viewport) => viewport.label),
        );
    });

    test('场景按语言 → 视口顺序排列', () => {
        const expectedOrder = LOCALES.flatMap((locale) =>
            VIEWPORTS.map((viewport) => `${locale.code}_${viewport.label}`),
        );
        const actualOrder = [
            ...new Set(allScenarios.map((scenario) => `${scenario.locale}_${scenario.viewports[0].label}`)),
        ];
        expect(actualOrder).toEqual(expectedOrder);
    });

    test('每个场景都包含语言标识与就绪条件，label 为 locale_viewport_page', () => {
        allScenarios.forEach((scenario) => {
            expect(scenario.locale).toMatch(/^(zh|zh-TW|en)$/);
            expect(scenario.label.startsWith(`${scenario.locale}_`)).toBe(true);
            expect(scenario.label).toContain(`_${scenario.viewports[0].label}_`);
            const hasReadyCheck = Boolean(scenario.readyText || scenario.readyPlaceholder || scenario.readySelector);
            expect(hasReadyCheck).toBe(true);
        });
    });

    test('基础页面覆盖全部 3×4 语言视口组合', () => {
        PAGES.forEach((page) => {
            LOCALES.forEach((locale) => {
                VIEWPORTS.forEach((viewport) => {
                    const label = scenarioLabel(locale, viewport, page.label);
                    expect(allScenarios.some((scenario) => scenario.label === label)).toBe(true);
                });
            });
        });
    });

    test('small-desktop 严格为 1024×768，覆盖三语基础页面', () => {
        const smallDesktop = VIEWPORTS.find((viewport) => viewport.label === 'small-desktop');
        expect(smallDesktop).toEqual({ label: 'small-desktop', width: 1024, height: 768 });

        const scenarios = allScenarios.filter((scenario) => scenario.viewports[0].label === 'small-desktop');
        expect(scenarios).toHaveLength(LOCALES.length * 13);
        scenarios.forEach((scenario) => expect(scenario.viewports).toEqual([smallDesktop]));
    });

    test('Pixel 9 412×923 覆盖三语基础页面', () => {
        expect(PIXEL_9_LEARNING_VIEWPORT).toEqual({ label: 'pixel-9', width: 412, height: 923 });

        const scenario = allScenarios.find((item) => item.label === 'zh_pixel-9_learning');
        expect(scenario).toBeDefined();
        expect(scenario!.locale).toBe('zh');
        expect(scenario!.url).toBe('http://127.0.0.1:8080/learning');
        expect(scenario!.viewports).toEqual([PIXEL_9_LEARNING_VIEWPORT]);
        const pixelScenarios = allScenarios.filter((item) => item.viewports[0].label === 'pixel-9');
        expect(new Set(pixelScenarios.map((item) => item.locale))).toEqual(new Set(LOCALES.map((item) => item.code)));
        expect(pixelScenarios.length).toBeGreaterThan(PAGES.length * LOCALES.length);
    });

    test('术语表场景会等待异步内容加载完成', () => {
        const glossaryScenarios = allScenarios.filter((scenario) => scenario.label.includes('_glossary'));
        expect(glossaryScenarios).toHaveLength(60);
        glossaryScenarios.forEach((scenario) => {
            expect(scenario.waitForLoading).toBe(true);
        });
    });

    test('首页手机版菜单展开场景会点击汉堡按钮', () => {
        const menuOpenScenario = allScenarios.find((scenario) =>
            scenario.label.endsWith(`_${MOBILE_MENU_OPEN_SCENARIO.labelSuffix}`),
        );

        expect(menuOpenScenario).toBeDefined();
        expect(menuOpenScenario!.label).toBe('zh_mobile_homepage_menu_open');
        expect(menuOpenScenario!.clickSelector).toBe('[data-testid="navbar-mobile-menu-button"]');
        expect(menuOpenScenario!.postInteractionWait).toBe(MOBILE_MENU_OPEN_SCENARIO.postInteractionWait);
        expect(menuOpenScenario!.viewports).toEqual([
            VIEWPORTS.find((viewport) => viewport.label === MOBILE_MENU_OPEN_SCENARIO.viewportLabel),
        ]);
    });

    test('首页移动端语言切换场景会打开菜单、切换英文并等待菜单关闭', () => {
        const scenario = allScenarios.find((item) =>
            item.label.endsWith(`_${MOBILE_LANGUAGE_SWITCH_SCENARIO.labelSuffix}`),
        );

        expect(scenario).toBeDefined();
        expect(scenario!.label).toBe('zh_mobile_homepage_language_switch_en');
        expect(scenario!.clickSelectors).toEqual(MOBILE_LANGUAGE_SWITCH_SCENARIO.clickSelectors);
        expect(scenario!.postInteractionHide).toBe('[data-testid="navbar-mobile-menu"]');
        expect(scenario!.selectors).toEqual(['viewport']);
    });

    test('教程页移动视口使用默认桌面 UA，回归验证导航只依赖宽度', () => {
        const mobileTutorialScenarios = allScenarios.filter(
            (scenario) => scenario.label.includes('_mobile_tutorial') && !scenario.label.includes('drawer'),
        );
        expect(mobileTutorialScenarios).toHaveLength(LOCALES.length);
        mobileTutorialScenarios.forEach((scenario) => {
            expect(scenario.userAgent).toBeUndefined();
        });

        const desktopTutorial = allScenarios.find((scenario) => scenario.label === 'zh_desktop_tutorial');
        expect(desktopTutorial?.userAgent).toBeUndefined();
    });

    test('教程页移动端抽屉展开场景会点击菜单并等待抽屉内容', () => {
        const drawerScenario = allScenarios.find((scenario) =>
            scenario.label.endsWith(`_${TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.labelSuffix}`),
        );

        expect(drawerScenario).toBeDefined();
        expect(drawerScenario!.label).toBe('zh_mobile_tutorial_drawer_open');
        expect(drawerScenario!.clickSelector).toBe('[data-testid="mobile-nav-menu-button"]');
        expect(drawerScenario!.postInteractionWait).toBe(TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.postInteractionWait);
        expect(drawerScenario!.userAgent).toBeUndefined();
        expect(drawerScenario!.selectors).toEqual(['viewport']);
        expect(drawerScenario!.viewports).toEqual([
            VIEWPORTS.find((viewport) => viewport.label === TUTORIAL_MOBILE_DRAWER_OPEN_SCENARIO.viewportLabel),
        ]);
    });

    test('首页 Apple 下载弹窗覆盖三语全部视口', () => {
        const modalScenarios = allScenarios.filter((scenario) => scenario.label.includes('_apple_modal_open'));

        expect(modalScenarios).toHaveLength(LOCALES.length * VIEWPORTS.length);
        expect(APPLE_DOWNLOAD_MODAL_SCENARIO.viewportLabels).toEqual(WIDE_VIEWPORT_LABELS);

        LOCALES.forEach((locale) =>
            VIEWPORTS.forEach((viewport) => {
                const scenario = modalScenarios.find(
                    (item) => item.label === `${locale.code}_${viewport.label}_homepage_apple_modal_open`,
                );
                expect(scenario).toBeDefined();
            }),
        );
    });

    test('学习页评分 tooltip 覆盖桌面 hover 与移动端键盘 focus', () => {
        const scenarios = allScenarios.filter((scenario) => scenario.label.includes('_learning_rating_'));
        expect(scenarios).toHaveLength(LOCALES.length * VIEWPORTS.length);
        scenarios.forEach((scenario) => {
            if (WIDE_VIEWPORT_LABELS.includes(scenario.viewports[0].label)) {
                expect(scenario.hoverSelector).toBe('article:first-of-type [data-testid="learning-rating-link"]');
            } else {
                expect(scenario.focusSelector).toBe('article:first-of-type [data-testid="learning-rating-link"]');
            }
        });
        scenarios.forEach((scenario) => expect(scenario.selectors).toEqual(['viewport']));
    });

    test('术语表点击索引场景仅在宽屏生成，点击字母 A 和 H 且截图当前视口分辨率', () => {
        const clickIndexScenarios = allScenarios.filter((scenario) => scenario.label.includes('_click_index_'));

        expect(clickIndexScenarios).toHaveLength(12);
        GLOSSARY_CLICK_INDEX_SCENARIOS.forEach((config) => {
            const currentScenarios = clickIndexScenarios.filter((s) => s.label.endsWith(`_${config.labelSuffix}`));
            expect(currentScenarios).toHaveLength(6);
            currentScenarios.forEach((scenario) => {
                expect(scenario.clickSelector).toBe(config.clickSelector);
                expect(scenario.selectors).toEqual(['viewport']);
                expect(scenario.postInteractionWait).toBe(config.postInteractionWait);
                expect(WIDE_VIEWPORT_LABELS).toContain(scenario.viewports[0].label);
            });
        });
    });

    test('词条详情页覆盖各语言全部视口', () => {
        const definitionScenarios = allScenarios.filter(
            (scenario) => scenario.label.includes('_glossary_definition') && !scenario.label.includes('not_found'),
        );

        expect(definitionScenarios).toHaveLength(definitionScenarioCount);
        LOCALES.forEach((locale) => {
            const termConfig = GLOSSARY_DEFINITION_TERMS[locale.code as keyof typeof GLOSSARY_DEFINITION_TERMS];
            VIEWPORTS.forEach((viewport) => {
                const scenario = definitionScenarios.find(
                    (item) => item.label === scenarioLabel(locale, viewport, 'glossary_definition'),
                );
                expect(scenario).toBeDefined();
                expect(scenario!.url).toBe(`http://127.0.0.1:8080/glossary/${locale.code}/${termConfig.term}`);
                expect(scenario!.readyText).toBe(termConfig.readyText);
                expect(scenario!.waitForLoading).toBe(true);
            });
        });
    });

    test('词条不存在态覆盖三语全部视口', () => {
        const notFoundScenarios = allScenarios.filter((scenario) =>
            scenario.label.includes('_glossary_definition_not_found'),
        );

        expect(notFoundScenarios).toHaveLength(definitionNotFoundCount);
        LOCALES.forEach((locale) =>
            VIEWPORTS.forEach((viewport) => {
                const scenario = notFoundScenarios.find(
                    (item) => item.label === scenarioLabel(locale, viewport, 'glossary_definition_not_found'),
                );
                expect(scenario).toBeDefined();
                expect(scenario!.url).toBe(
                    `http://127.0.0.1:8080/glossary/${locale.code}/${GLOSSARY_DEFINITION_NOT_FOUND_SCENARIO.term}`,
                );
                expect(scenario!.readySelector).toBe(GLOSSARY_DEFINITION_NOT_FOUND_SCENARIO.readySelector);
                expect(scenario!.waitForLoading).toBe(true);
            }),
        );
    });

    test('术语表搜索过滤场景会用 keyPressSelector 输入查询并截取视口', () => {
        const searchScenarios = allScenarios.filter((scenario) => scenario.label.endsWith('_search_filter'));

        expect(searchScenarios).toHaveLength(searchFilterScenarioCount);
        LOCALES.forEach((locale) => {
            VIEWPORTS.forEach((viewport) => {
                const scenario = searchScenarios.find(
                    (item) => item.label === scenarioLabel(locale, viewport, 'glossary', 'search_filter'),
                );
                expect(scenario).toBeDefined();
                expect(scenario!.keyPressSelector).toEqual({
                    selector: NARROW_VIEWPORT_LABELS.includes(viewport.label)
                        ? '[data-testid="glossary-mobile-search-input"]'
                        : '[data-testid="glossary-search-input"]',
                    keyPress: GLOSSARY_SEARCH_QUERIES[locale.code as keyof typeof GLOSSARY_SEARCH_QUERIES],
                });
                expect(scenario!.selectors).toEqual(['viewport']);
                const readySelector =
                    GLOSSARY_SEARCH_READY_SELECTORS[locale.code as keyof typeof GLOSSARY_SEARCH_READY_SELECTORS];
                expect(scenario!.postInteractionWait).toBe(readySelector);
                expect(scenario!.scrollIntoViewSelector).toBe(
                    viewport.label === 'small-desktop' ? readySelector : undefined,
                );
                expect(scenario!.postInteractionHide).toBe(
                    GLOSSARY_SEARCH_HIDE_SELECTORS[locale.code as keyof typeof GLOSSARY_SEARCH_HIDE_SELECTORS],
                );
            });
        });
    });
});
