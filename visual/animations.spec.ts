import { test, expect } from '@playwright/test';
import { resolveLocales, resolveViewports, GLOSSARY_DEFINITION_TERMS } from './scenarios';
import {
    prepareMotion,
    openHome,
    readyAssets,
    finishFinite,
    paint,
    motions,
    requireMotion,
    frame,
    holdRequests,
    freezeClock,
} from './helpers/motion';

const viewports = resolveViewports().filter(
    /** 动画采用桌面与手机两种布局，其余尺寸由静态矩阵覆盖。 */ (viewport) =>
        ['desktop', 'mobile'].includes(viewport.label),
);

for (const locale of resolveLocales()) {
    for (const viewport of viewports) {
        const prefix = `${locale.code}-${viewport.label}`;
        const desktop = viewport.label === 'desktop';
        test.describe(`${locale.code}_${viewport.label}_animations`, /** 为每种语言与布局注册动画场景。 */ () => {
            test.beforeEach(
                /** 固定视口和语言，启用真实动画。 */ async ({ page }, testInfo) => {
                    await page.setViewportSize({ width: viewport.width, height: viewport.height });
                    await prepareMotion(page, locale.code, testInfo.project.use.baseURL!);
                },
            );

            test('首页循环光效与悬浮', /** 验证所有持续关键帧及错开的扩散光环。 */ async ({ page }) => {
                await openHome(page);
                const contracts: [string, number, number][] = [
                    ['orb-drift-a', 18000, 1],
                    ['orb-drift-b', 22000, 1],
                    ['orb-drift-c', 26000, 1],
                    ['glow-pulse', 5000, 1],
                    ['glow-pulse-soft', 6000, 1],
                    ...(desktop
                        ? ([
                              ['float-bob', 5500, 1],
                              ['shadow-breath', 5000, 1],
                              ['wave', 5500, 3],
                          ] as [string, number, number][])
                        : []),
                ];
                const ids: number[] = [];
                for (const [name, duration, count] of contracts) {
                    // CSS Modules 的生产动画名为哈希；使用时长与属性组合定位，再检查数量和运行状态。
                    const keyframeProperty = name.startsWith('glow')
                        ? 'textShadow'
                        : name === 'wave'
                          ? 'width'
                          : 'transform';
                    ids.push(...(await requireMotion(page, { duration, keyframeProperty }, duration, count)));
                }
                const loops = (await motions(page)).filter(
                    /** 读取所测循环的时间契约。 */ (motion) => ids.includes(motion.id),
                );
                for (const loop of loops) expect(loop.iterations).toBe(Infinity);
                if (desktop)
                    expect(
                        (await motions(page, { keyframeProperty: 'width' }))
                            .map(/** 读取光环延迟。 */ (motion) => motion.delay)
                            .sort(),
                    ).toEqual([0, 1000, 3000]);
                for (const time of [0, 2750, 5225, 5500, 13000]) {
                    await frame(page, `${prefix}-ambient-${time}ms`, ids, time);
                }
            });

            test('按钮扫光与悬停复位', /** 同时覆盖下载按钮和 H5 按钮的两套扫光实现。 */ async ({ page }) => {
                await openHome(page);
                for (const testId of [
                    'download-button-icon-link',
                    'ios-download-trigger',
                    'h5-play-link-laiwan-life',
                    'h5-tutorial-link-laiwanpai-com',
                ]) {
                    const target = page.getByTestId(testId);
                    await target.hover();
                    await paint(page);
                    const ids = await requireMotion(page, { keyframeProperty: 'left' }, 900);
                    const transitions = (await motions(page)).filter(
                        /** 包含按钮的位移、边框与阴影过渡。 */ (motion) => motion.property !== '',
                    );
                    expect(
                        transitions.some(
                            /** 确认按钮确实有悬停位移。 */ (motion) =>
                                motion.property === 'transform' && motion.duration === 250,
                        ),
                    ).toBe(true);
                    const all = [...ids, ...transitions.map(/** 提取关联过渡。 */ (motion) => motion.id)];
                    for (const time of [125, 450, 899])
                        await frame(page, `${prefix}-${testId}-hover-${time}ms`, all, time);
                    await finishFinite(page);
                    await page.mouse.move(1, viewport.height - 1);
                    await paint(page);
                    const exit = (await motions(page)).filter(
                        /** 捕获离开按钮后的复位过渡。 */ (motion) => motion.property !== '',
                    );
                    expect(exit.length).toBeGreaterThan(0);
                    await frame(
                        page,
                        `${prefix}-${testId}-leave-125ms`,
                        exit.map(/** 提取复位动画。 */ (motion) => motion.id),
                        125,
                    );
                    await finishFinite(page);
                }
            });

            test('iOS 加载与弹窗', /** 用请求闸门捕获下载加载圆环、弹层弹出和关闭。 */ async ({ page }) => {
                const gate = await holdRequests(page, /\/assets\/ios-dialog\.[^/]+\.js/);
                try {
                    await openHome(page);
                    await page.getByTestId('ios-download-trigger').click();
                    await expect(page.getByTestId('ios-download-loading')).toBeVisible();
                    expect(gate.count()).toBeGreaterThan(0);
                    const spin = await requireMotion(
                        page,
                        { within: 'ios-download-loading', duration: 700, keyframeProperty: 'transform' },
                        700,
                    );
                    await finishFinite(page);
                    for (const time of [0, 175, 350])
                        await frame(
                            page,
                            `${prefix}-ios-loading-${time}ms`,
                            spin,
                            time,
                            page.getByTestId('ios-download-loading'),
                            4,
                        );
                    gate.release();
                    await expect(page.getByTestId('ios-download-modal')).toBeAttached();
                    await readyAssets(page);
                    const pop = await requireMotion(page, { name: 'modalPop' }, 320);
                    const backdrop = (await motions(page)).filter(
                        /** 同步捕获 MUI 背景渐显。 */ (motion) => motion.property === 'opacity',
                    );
                    expect(backdrop.length).toBeGreaterThan(0);
                    const all = [...pop, ...backdrop.map(/** 提取背景动画。 */ (motion) => motion.id)];
                    for (const time of [0, 160, 319]) await frame(page, `${prefix}-ios-modal-${time}ms`, all, time);
                    await finishFinite(page);
                    for (const testId of [
                        'ios-download-modal-close',
                        'ios-download-modal-link',
                        'ios-download-modal-tutorial-link',
                    ]) {
                        await page.getByTestId(testId).hover();
                        await paint(page);
                        const hover = (await motions(page)).filter(
                            /** 捕获弹层控件反馈。 */ (motion) => motion.property !== '',
                        );
                        expect(hover.length).toBeGreaterThan(0);
                        await frame(
                            page,
                            `${prefix}-${testId}-100ms`,
                            hover.map(/** 提取控件过渡。 */ (motion) => motion.id),
                            100,
                        );
                        await finishFinite(page);
                        if (testId !== 'ios-download-modal-close') {
                            await page.getByTestId(testId).evaluate(
                                /** 保留真实按压反馈，但阻止测试触发商店或教程导航。 */ (element) => {
                                    element.addEventListener(
                                        'click',
                                        /** 仅取消这一次链接跳转。 */ (event) => event.preventDefault(),
                                        { once: true },
                                    );
                                },
                            );
                            await page.mouse.down();
                            await paint(page);
                            const active = await requireMotion(page, { within: testId, property: 'filter' }, 200);
                            const movement = await requireMotion(page, { within: testId, property: 'transform' }, 200);
                            await frame(page, `${prefix}-${testId}-pressed-100ms`, [...active, ...movement], 100);
                            await finishFinite(page);
                            await page.mouse.up();
                            await finishFinite(page);
                        }
                    }
                    await page.getByTestId('ios-download-modal-close').click();
                    await expect(page.getByTestId('ios-download-modal')).toHaveCount(0);
                } finally {
                    gate.release();
                }
            });

            test('术语详情渐入', /** 验证详情正文初态、中间态和完成态。 */ async ({ page }) => {
                const term = GLOSSARY_DEFINITION_TERMS[locale.code as keyof typeof GLOSSARY_DEFINITION_TERMS];
                await page.goto(`/glossary/${locale.code}/${term.term}`);
                await expect(page.getByTestId('definition-term-name')).toHaveText(term.termName);
                await readyAssets(page);
                const ids = await requireMotion(
                    page,
                    { within: 'definition-term-name', keyframeProperty: 'opacity' },
                    250,
                );
                for (const time of [0, 125, 250]) await frame(page, `${prefix}-definition-${time}ms`, ids, time);
            });

            test('背景和手机图渐显', /** 延迟高清图片，比较占位图、交叉渐显和清晰图。 */ async ({ page }) => {
                const probe = await page.context().newPage();
                await probe.goto('/');
                await expect(probe.getByTestId('blur-up-full')).toHaveAttribute('data-loaded', 'true');
                await expect(probe.getByTestId('home-background-image')).toHaveAttribute('data-loaded', 'true');
                const imageUrls = await probe
                    .getByTestId(/^(home-background-image|blur-up-full)$/)
                    .evaluateAll(
                        /** 从真实业务标识读取构建后的资源地址。 */ (images) =>
                            images.map(
                                /** 优先使用浏览器选中的图片格式。 */ (image) =>
                                    (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src,
                            ),
                    );
                await probe.close();
                const gate = await holdRequests(
                    page,
                    /** 仅阻塞高清图，保留模糊占位图。 */ (url) => imageUrls.includes(url.href),
                );
                try {
                    await page.goto('/', { waitUntil: 'domcontentloaded' });
                    await expect(page.getByTestId('home-title')).toBeVisible();
                    await expect(page.getByTestId('home-background-image')).toHaveAttribute('data-loaded', 'false');
                    await expect(page.getByTestId('blur-up-full')).toHaveAttribute('data-loaded', 'false');
                    await readyAssets(page, ['home-background-image', 'blur-up-full']);
                    await finishFinite(page);
                    expect(gate.count()).toBeGreaterThan(0);
                    await frame(page, `${prefix}-images-placeholder`, [], 0);
                    gate.release();
                    await expect(page.getByTestId('home-background-image')).toHaveAttribute('data-loaded', 'true');
                    await expect(page.getByTestId('blur-up-full')).toHaveAttribute('data-loaded', 'true');
                    await readyAssets(page);
                    const ids: number[] = [];
                    for (const testId of [
                        'home-background-image',
                        'home-background-placeholder',
                        ...(desktop ? ['blur-up-full', 'blur-up-placeholder'] : []),
                    ]) {
                        ids.push(
                            ...(await requireMotion(
                                page,
                                { within: testId, property: 'opacity' },
                                testId.startsWith('home-') ? 550 : 450,
                            )),
                        );
                    }
                    for (const time of [0, 225, 549]) await frame(page, `${prefix}-images-fade-${time}ms`, ids, time);
                } finally {
                    gate.release();
                }
            });

            test('鼠标视差与离开复位', /** 检查真实鼠标事件驱动的背景和手机变换。 */ async ({ page }) => {
                await openHome(page);
                for (const [label, x, y] of [
                    ['top-left', 10, 100],
                    ['bottom-right', viewport.width - 10, viewport.height - 10],
                ] as const) {
                    await page.mouse.move(x, y);
                    await paint(page);
                    const ids = await requireMotion(
                        page,
                        { within: 'home-background-image', property: 'transform' },
                        500,
                    );
                    await expect(page.getByTestId('home-background-image')).toHaveAttribute(
                        'style',
                        /translate3d\((?!0\.00px, 0\.00px)/,
                    );
                    for (const time of [250, 499])
                        await frame(page, `${prefix}-parallax-${label}-${time}ms`, ids, time);
                    await finishFinite(page);
                }
                await page.evaluate(
                    /** 模拟鼠标离开浏览器窗口，触发真实业务复位监听器。 */ () =>
                        window.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null })),
                );
                await paint(page);
                const ids = await requireMotion(page, { within: 'home-background-image', property: 'transform' }, 500);
                await frame(page, `${prefix}-parallax-reset-250ms`, ids, 250);
                await finishFinite(page);
                await expect(page.getByTestId('home-background-image')).toHaveCSS(
                    'transform',
                    'matrix(1.06, 0, 0, 1.06, 0, 0)',
                );
            });

            test('学习页卡片、评分与下载反馈', /** 覆盖卡片浮起、评分提示渐显及下载按钮变色。 */ async ({ page }) => {
                await page.goto('/learning');
                const card = page.getByTestId(
                    `learning-book-no-limit-holdem-advanced-${locale.code === 'en' ? 'en' : 'zh'}`,
                );
                await expect(card).toBeVisible();
                await readyAssets(page);
                await finishFinite(page);
                for (const testId of ['learning-rating-link', 'learning-download-link']) {
                    const control = card.getByTestId(testId).first();
                    if (!desktop && testId === 'learning-rating-link') await control.focus();
                    else await control.hover();
                    await paint(page);
                    const changed = (
                        await motions(page, {
                            within: `learning-book-no-limit-holdem-advanced-${locale.code === 'en' ? 'en' : 'zh'}`,
                        })
                    ).filter(/** 只记录控件及卡片的真实过渡。 */ (motion) => motion.property !== '');
                    expect(changed.length).toBeGreaterThan(0);
                    if (testId === 'learning-rating-link')
                        await requireMotion(page, { within: 'learning-rating-tooltip', property: 'opacity' }, 150);
                    for (const time of [75, 179])
                        await frame(
                            page,
                            `${prefix}-${testId}-${time}ms`,
                            changed.map(/** 提取过渡编号。 */ (motion) => motion.id),
                            time,
                        );
                    await finishFinite(page);
                }
            });

            test('语言控件与术语搜索反馈', /** 覆盖语言按钮、搜索框和字母索引的颜色过渡。 */ async ({ page }) => {
                await page.goto('/glossary');
                await expect(page.getByTestId('glossary-stats')).toBeVisible();
                await readyAssets(page);
                await finishFinite(page);
                if (!desktop) {
                    await page.getByTestId('navbar-mobile-menu-button').click();
                    await finishFinite(page);
                }
                const language = page
                    .getByTestId(`language-option-${locale.code === 'en' ? 'zh' : 'en'}`)
                    .filter({ visible: true });
                await language.hover();
                await paint(page);
                const languageIds = await requireMotion(
                    page,
                    { within: `language-option-${locale.code === 'en' ? 'zh' : 'en'}`, property: 'background-color' },
                    150,
                );
                await frame(page, `${prefix}-language-hover-75ms`, languageIds, 75, page.getByTestId('navbar'));
                if (desktop) {
                    await page.getByTestId('glossary-search-input').focus();
                    await paint(page);
                    const search = (await motions(page, { within: 'glossary-search-input' })).filter(
                        /** 四个边框颜色作为同一搜索框反馈。 */ (motion) => motion.property.startsWith('border-'),
                    );
                    expect(search).toHaveLength(4);
                    await frame(
                        page,
                        `${prefix}-search-focus-75ms`,
                        search.map(/** 提取边框过渡。 */ (motion) => motion.id),
                        75,
                        page.getByTestId('glossary-sticky-index'),
                    );
                    await finishFinite(page);
                    await page.getByTestId('glossary-letter-H').hover();
                    await paint(page);
                    const index = await requireMotion(
                        page,
                        { within: 'glossary-letter-H', property: 'background-color' },
                        150,
                    );
                    await frame(
                        page,
                        `${prefix}-index-hover-75ms`,
                        index,
                        75,
                        page.getByTestId('glossary-sticky-index'),
                    );
                    await finishFinite(page);
                    await language.click();
                    await expect(language).toHaveAttribute('aria-pressed', 'true');
                    await readyAssets(page);
                    const selection = await requireMotion(
                        page,
                        { within: `language-option-${locale.code === 'en' ? 'zh' : 'en'}`, property: 'color' },
                        150,
                    );
                    const selectedBackground = await requireMotion(
                        page,
                        {
                            within: `language-option-${locale.code === 'en' ? 'zh' : 'en'}`,
                            property: 'background-color',
                        },
                        150,
                    );
                    await frame(
                        page,
                        `${prefix}-language-selected-75ms`,
                        [...selection, ...selectedBackground],
                        75,
                        page.getByTestId('navbar'),
                    );
                }
            });

            test('路由进度条与圆环', /** 保持学习页模块请求，检查导航期间的进度反馈。 */ async ({ page }) => {
                const gate = await holdRequests(page, /\/assets\/learning\.[^/]+\.js/);
                try {
                    await openHome(page);
                    if (!desktop) {
                        await page.getByTestId('navbar-mobile-menu-button').click();
                        await finishFinite(page);
                    }
                    await freezeClock(page);
                    await page
                        .getByTestId(`${desktop ? 'navbar-link' : 'navbar-mobile-menu-item'}-navbar_learning`)
                        .click();
                    await paint(page);
                    await expect(page.getByTestId('route-progress')).toBeAttached();
                    await expect(page.getByTestId('route-progress-bar')).toBeVisible();
                    const spin = await requireMotion(
                        page,
                        { within: 'route-progress', name: 'nprogress-spinner' },
                        400,
                    );
                    const bar = await requireMotion(page, { within: 'route-progress-bar', property: 'transform' }, 200);
                    for (const time of [0, 100, 199]) {
                        await frame(
                            page,
                            `${prefix}-route-progress-${time}ms`,
                            [...spin, ...bar],
                            time,
                            page.getByTestId('navbar'),
                        );
                        await frame(
                            page,
                            `${prefix}-route-spinner-${time}ms`,
                            [...spin, ...bar],
                            time,
                            page.getByTestId('route-progress').locator('[role="spinner"]'),
                            4,
                        );
                    }
                    await page.emulateMedia({ reducedMotion: 'reduce' });
                    await paint(page);
                    await finishFinite(page);
                    expect((await motions(page, { within: 'route-progress' })).length).toBe(0);
                    await frame(page, `${prefix}-route-progress-reduced`, [], 0, page.getByTestId('navbar'));
                    gate.release();
                    await page.clock.resume();
                    await expect(page.getByTestId('learning-page')).toBeVisible();
                    await expect(page.getByTestId('route-progress')).toHaveCount(0);
                } finally {
                    gate.release();
                }
            });

            for (const loading of ['boot', 'react', 'inline'] as const) {
                test(`${loading} 加载呼吸`, /** 保持首屏加载窗口，检查标志和光晕的真实循环。 */ async ({ page }) => {
                    const pattern =
                        loading === 'inline'
                            ? '**/terminologies/**'
                            : loading === 'boot'
                              ? /\/assets\/.*\.js/
                              : /\/assets\/(?!(main|react|mui|intl|vendor)\.)[^/]+\.js/;
                    const gate = await holdRequests(page, pattern);
                    try {
                        await page.goto(loading === 'inline' ? '/glossary' : '/', { waitUntil: 'commit' });
                        const testId = loading === 'boot' ? 'boot-loading' : 'loading-spinner';
                        await expect(page.getByTestId(testId)).toBeAttached();
                        if (loading === 'inline') {
                            await expect(page.getByTestId('glossary-header')).toBeVisible();
                            await expect(page.getByTestId('boot-loading')).toHaveCount(0);
                            await page.getByTestId(testId).scrollIntoViewIfNeeded();
                        }
                        if (loading === 'react')
                            await page.evaluate(
                                /** 单独查看被首屏兜底覆盖的 React 加载组件。 */ () =>
                                    document.getElementById('boot-loading')?.remove(),
                            );
                        await readyAssets(page);
                        const ids = await requireMotion(page, { within: testId, duration: 2200 }, 2200, 2);
                        const scene = page.getByTestId(testId).locator(':scope > div').first();
                        for (const time of [0, 1100, 2200])
                            await frame(page, `${prefix}-${loading}-loading-${time}ms`, ids, time, scene, 32);
                        await page.emulateMedia({ reducedMotion: 'reduce' });
                        await paint(page);
                        expect((await motions(page, { within: testId })).length).toBe(0);
                        await frame(page, `${prefix}-${loading}-loading-reduced`, [], 0);
                    } finally {
                        gate.release();
                    }
                });
            }

            if (!desktop) {
                test('教程抽屉进出', /** 同时检查抽屉位移和背景遮罩的进入、退出过程。 */ async ({ page }) => {
                    await page.goto('/tutorial');
                    await expect(page.getByTestId('tutorial-step-one')).toBeVisible();
                    await readyAssets(page);
                    await finishFinite(page);
                    await freezeClock(page);
                    await page.getByTestId('mobile-nav-menu-button').click();
                    await paint(page);
                    const slide = await requireMotion(
                        page,
                        { within: 'mobile-drawer-content', property: 'transform' },
                        225,
                    );
                    const fade = await requireMotion(page, { property: 'opacity' }, 225);
                    for (const time of [0, 112, 224])
                        await frame(page, `${prefix}-drawer-open-${time}ms`, [...slide, ...fade], time);
                    await finishFinite(page);
                    await page.clock.runFor(300);
                    await page.keyboard.press('Escape');
                    await paint(page);
                    const exit = await requireMotion(
                        page,
                        { within: 'mobile-drawer-content', property: 'transform' },
                        195,
                    );
                    const exitFade = await requireMotion(page, { property: 'opacity' }, 195);
                    for (const time of [0, 97, 194])
                        await frame(page, `${prefix}-drawer-close-${time}ms`, [...exit, ...exitFade], time);
                    await page.clock.runFor(300);
                    await expect(page.getByTestId('mobile-drawer-content')).toHaveCount(0);
                });

                test('汉堡按钮开合', /** 覆盖三条菜单线的旋转、位移和透明度。 */ async ({ page }) => {
                    await openHome(page);
                    const button = page.getByTestId('navbar-mobile-menu-button');
                    for (const state of ['open', 'closed']) {
                        await button.click();
                        await paint(page);
                        const ids = (await motions(page, { within: 'navbar-mobile-menu-button' })).filter(
                            /** 排除非过渡动画。 */ (motion) => motion.property !== '',
                        );
                        expect(ids).toHaveLength(5);
                        for (const motion of ids) expect(motion.duration).toBe(86);
                        for (const time of [0, 43, 85])
                            await frame(
                                page,
                                `${prefix}-menu-${state}-${time}ms`,
                                ids.map(/** 提取菜单线过渡。 */ (motion) => motion.id),
                                time,
                                page.getByTestId('navbar'),
                            );
                        await finishFinite(page);
                        await expect(button).toHaveAttribute('aria-expanded', String(state === 'open'));
                    }
                });
            }

            test('减少动态效果', /** 验证生产媒体查询实际停用持续动画且内容保持可见。 */ async ({ page }) => {
                await page.emulateMedia({ reducedMotion: 'reduce' });
                await openHome(page);
                const created = await motions(page);
                expect(
                    created.filter(
                        /** 不允许保留长动画或无限循环。 */ (motion) =>
                            motion.iterations === Infinity || Number(motion.duration) > 0.01,
                    ),
                ).toEqual([]);
                const before = await page
                    .getByTestId('home-background-image')
                    .evaluate(/** 读取静态背景变换。 */ (element) => getComputedStyle(element).transform);
                await page.mouse.move(viewport.width - 1, viewport.height - 1);
                await paint(page);
                await expect(page.getByTestId('home-background-image')).toHaveCSS('transform', before);
                await frame(page, `${prefix}-reduced-home`, [], 0);
                await page.getByTestId('ios-download-trigger').click();
                await expect(page.getByTestId('ios-download-modal')).toBeVisible();
                await readyAssets(page);
                await finishFinite(page);
                expect(
                    (await motions(page)).every(
                        /** 所有残留动画必须为瞬时单次。 */ (motion) =>
                            Number(motion.duration) <= 0.01 && motion.iterations !== Infinity,
                    ),
                ).toBe(true);
                await frame(page, `${prefix}-reduced-modal`, [], 0);
                await page.goto('/learning');
                const card = page.getByTestId(
                    `learning-book-no-limit-holdem-advanced-${locale.code === 'en' ? 'en' : 'zh'}`,
                );
                await expect(card).toBeVisible();
                await readyAssets(page);
                await card.hover();
                await finishFinite(page);
                await expect(card).toHaveCSS('transform', 'none');
                await frame(page, `${prefix}-reduced-learning`, [], 0);
                const term = GLOSSARY_DEFINITION_TERMS[locale.code as keyof typeof GLOSSARY_DEFINITION_TERMS];
                await page.goto(`/glossary/${locale.code}/${term.term}`);
                await expect(page.getByTestId('definition-term-name')).toHaveText(term.termName);
                await readyAssets(page);
                expect((await motions(page, { within: 'definition-term-name' })).length).toBe(0);
                await frame(page, `${prefix}-reduced-definition`, [], 0);
                if (!desktop) {
                    await page.goto('/tutorial');
                    await expect(page.getByTestId('tutorial-step-one')).toBeVisible();
                    await readyAssets(page);
                    await page.getByTestId('mobile-nav-menu-button').click();
                    await finishFinite(page);
                    await expect(page.getByTestId('mobile-drawer-content')).toBeVisible();
                    expect(
                        (await motions(page)).every(
                            /** 减少动效时不允许较长的抽屉过渡。 */ (motion) => Number(motion.duration) <= 0.01,
                        ),
                    ).toBe(true);
                    await frame(page, `${prefix}-reduced-drawer`, [], 0);
                }
            });
        });
    }
}
