const { test, expect } = require('@playwright/test');
const { buildScenarios, LANGUAGE_COOKIE_KEY, MOBILE_USER_AGENT } = require('./scenarios');
const {
    materializeImagesForScreenshot,
    prepareBeforeNavigate,
    prepareAfterNavigate,
} = require('./helpers/preparePage');
const disableAnimations = require('./helpers/disableAnimations');
const { fetchBookMedia } = require('./helpers/fetchBookMedia');
const { requireStagingUrl } = require('../e2e/staging-url');

const BASE_URL = requireStagingUrl().replace(/\/$/, '');
const scenarios = buildScenarios(BASE_URL);

// main/react/mui/intl/vendor 是初始入口脚本（见 bundle-size.budget.json），文件名固定；
// 路由懒加载 chunk 用 webpack 生成的 id，按"非入口脚本"排除法匹配，避免依赖具体 chunk 名。
const ENTRY_JS_RE = /\/assets\/(main|react|mui|intl|vendor)\.[^/]+\.js(?:\?.*)?$/;
// 使用之前随前端构建发布的 manifest 内容，既保持快照中的版本和二维码不变，
// 也不再要求 dist 内保留 APK 文件。
const APK_INDEX_FIXTURE = { apk_files: ['顶级玩家-2.0.2308151624.apk', '顶级玩家-2.0.2308151249.apk'] };
const TUTORIAL_IMAGE_PRELOAD_MARGIN_PX = 96;
// 书籍文件迁移到 S3 后，纯静态的视觉服务器无法模拟生产 nginx 对 /book/ 的反代。
// 这些对象是一年 immutable 缓存，优先使用 staging、失败时回退 production，
// 可保留真实封面及既有基线，并避免单个对象存储端点的瞬时 TLS 故障中断整套测试。
const bookMediaCache = new Map();

async function mockS3Media(page, apkIndexHandler) {
    await page.route(
        '**/apk/index.json',
        apkIndexHandler ||
            ((route) =>
                route.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify(APK_INDEX_FIXTURE),
                })),
    );
    await page.route('**/book/*_cover*.{jpg,webp}', async (route) => {
        const { pathname } = new URL(route.request().url());
        const cachedMedia = bookMediaCache.get(pathname);
        if (cachedMedia) {
            await route.fulfill(cachedMedia);
            return;
        }

        let response = await fetchBookMedia(pathname);
        // WebP 的生成与前端发布是两个独立步骤。视觉基线应能在对象尚未
        // 上传的阶段继续使用 JPEG 回退，而不是把 S3 的暂时 404 截进快照。
        if (!response.ok && pathname.endsWith('.webp')) {
            response = await fetchBookMedia(pathname.replace(/\.webp$/i, '.jpg'));
        }

        if (!response.ok) {
            throw new Error(`Book cover request failed with ${response.status}: ${pathname}`);
        }

        const cachedResponse = {
            status: response.status,
            contentType: response.headers.get('content-type') || 'image/jpeg',
            body: Buffer.from(await response.arrayBuffer()),
        };
        bookMediaCache.set(pathname, cachedResponse);
        await route.fulfill(cachedResponse);
    });
}

async function openHomepageAtBreakpoint(page, context, width, locale = 'en', height = 900, apkIndexHandler) {
    const readyTextByLocale = {
        zh: '德州扑克约局社区',
        'zh-TW': '德州撲克約局社群',
        en: "Texas Hold'em Poker Game Community",
    };
    const viewport = { label: `breakpoint-${width}x${height}`, width, height };
    const scenario = {
        label: `${locale}_breakpoint-${width}_homepage`,
        url: `${BASE_URL}/`,
        locale,
        readyText: readyTextByLocale[locale],
        delay: 0,
        selectors: ['viewport'],
        viewports: [viewport],
    };

    await prepareBeforeNavigate(page, context, scenario, viewport);
    await mockS3Media(page, apkIndexHandler);
    await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
    await prepareAfterNavigate(page, scenario);
}

async function materializeDeferredGlossaryGroups(page) {
    const complete = await page.evaluate(async () => {
        const groups = Array.from(document.querySelectorAll('[data-glossary-group]'));
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

        // The glossary deliberately mounts off-screen groups only when they near the
        // viewport. Visit each placeholder so a full-page visual baseline contains
        // the same complete document a user gets after reading the page.
        for (const group of groups) {
            if (!group.querySelector(':scope > ul')) {
                group.scrollIntoView({ block: 'center' });
                await nextFrame();
            }
        }

        window.scrollTo(0, 0);
        await nextFrame();
        return groups.every((group) => group.querySelector(':scope > ul'));
    });

    expect(complete, 'all deferred glossary groups should be rendered before a full-page screenshot').toBe(true);
}

test.describe('visual regression', () => {
    for (const scenario of scenarios) {
        test(scenario.label, async ({ page, context }) => {
            const viewport = scenario.viewports[0];
            await prepareBeforeNavigate(page, context, scenario, viewport);
            await mockS3Media(page);
            await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
            await prepareAfterNavigate(page, scenario);

            if (scenario.label === 'zh_mobile_homepage_menu_open') {
                const viewportSize = page.viewportSize();
                for (const testId of ['navbar-logo', 'navbar-brand-text']) {
                    const brandPart = page.getByTestId(testId);
                    await expect(brandPart, `${testId} should remain visible while the menu is open`).toBeVisible();
                    const bounds = await brandPart.boundingBox();

                    expect(bounds, `${testId} should have a rendered bounding box`).not.toBeNull();
                    expect(
                        bounds.x,
                        `${testId} should not be clipped by the left viewport edge`,
                    ).toBeGreaterThanOrEqual(0);
                    expect(
                        bounds.x + bounds.width,
                        `${testId} should not be clipped by the right viewport edge`,
                    ).toBeLessThanOrEqual(viewportSize.width);
                    expect(bounds.y, `${testId} should not be clipped by the top viewport edge`).toBeGreaterThanOrEqual(
                        0,
                    );
                    expect(
                        bounds.y + bounds.height,
                        `${testId} should not be clipped by the bottom viewport edge`,
                    ).toBeLessThanOrEqual(viewportSize.height);
                }
            }

            if (scenario.label === 'zh_pixel-9_learning') {
                const layout = await page
                    .locator('section')
                    .filter({ has: page.locator('article') })
                    .evaluate((list) => {
                        const cards = Array.from(list.querySelectorAll('article'));
                        const firstCard = cards[0];
                        const cover = firstCard.querySelector('[data-testid="learning-book-cover"]');
                        const download = firstCard.querySelector('[data-testid="learning-download-link"]');
                        const rating = firstCard.querySelector('[data-testid="learning-rating-link"]');
                        const cardRect = firstCard.getBoundingClientRect();
                        const coverRect = cover.getBoundingClientRect();
                        const downloadRect = download.getBoundingClientRect();

                        return {
                            columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
                            cardWidth: cardRect.width,
                            titleFontSize: parseFloat(getComputedStyle(firstCard.querySelector('h2')).fontSize),
                            downloadInsideCard:
                                downloadRect.left >= cardRect.left && downloadRect.right <= cardRect.right,
                            ratingClickable: rating instanceof HTMLAnchorElement && rating.href.length > 0,
                            coverAspectRatio: coverRect.width / coverRect.height,
                        };
                    });

                expect(layout.columns).toBe(1);
                expect(layout.cardWidth).toBeGreaterThanOrEqual(360);
                expect(layout.titleFontSize).toBeGreaterThanOrEqual(18);
                expect(layout.downloadInsideCard).toBe(true);
                expect(layout.ratingClickable).toBe(true);
                expect(layout.coverAspectRatio).toBeCloseTo(448 / 633, 2);
            }

            // 无交互场景应从页面顶部采集；有交互的场景（如术语表索引）可按其操作保留滚动位置。
            const hasInteraction = Boolean(
                scenario.hoverSelector ||
                scenario.hoverSelectors ||
                scenario.clickSelector ||
                scenario.clickSelectors ||
                scenario.keyPressSelector ||
                scenario.keyPressSelectors ||
                scenario.focusSelector ||
                scenario.focusSelectors ||
                scenario.scrollToSelector,
            );
            if (!hasInteraction) {
                expect(await page.evaluate(() => window.scrollY)).toBe(0);
            }

            if (scenario.label.includes('_glossary_definition')) {
                const { footerBottom, pageBottom } = await page.evaluate(() => {
                    const footer = document.querySelector('footer');
                    return {
                        footerBottom: footer.getBoundingClientRect().bottom + window.scrollY,
                        pageBottom: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
                    };
                });
                // Flex layout can distribute an odd number of CSS pixels into a
                // half-pixel track. Keep the footer flush while allowing that
                // browser rounding artifact.
                expect(
                    Math.abs(footerBottom - pageBottom),
                    'definition footer should reach the bottom of the page',
                ).toBeLessThanOrEqual(1);
            }

            for (const selector of scenario.singleLineSelectors ?? []) {
                const lineCount = await page.locator(selector).evaluate((element) => {
                    const range = document.createRange();
                    range.selectNodeContents(element);
                    return range.getClientRects().length;
                });
                expect(lineCount, `${selector} should render on one line`).toBe(1);
            }

            if (scenario.label.includes('_learning_rating_')) {
                const layout = await page
                    .locator('[data-testid="learning-rating-link"]')
                    .first()
                    .evaluate((link) => {
                        const card = link.closest('article');
                        const tooltip = link.querySelector('[role="tooltip"]');
                        const linkRect = link.getBoundingClientRect();
                        const cardRect = card.getBoundingClientRect();
                        const tooltipRect = tooltip.getBoundingClientRect();
                        const authorRect = card.querySelector('p').getBoundingClientRect();
                        const downloadRect = card
                            .querySelector('[data-testid="learning-download-link"]')
                            .getBoundingClientRect();
                        const overlaps = (first, second) =>
                            first.left < second.right &&
                            first.right > second.left &&
                            first.top < second.bottom &&
                            first.bottom > second.top;
                        return {
                            tooltipVisible: getComputedStyle(tooltip).opacity === '1',
                            linkInsideCard: linkRect.left >= cardRect.left && linkRect.right <= cardRect.right,
                            tooltipInsideCard:
                                tooltipRect.left >= cardRect.left &&
                                tooltipRect.right <= cardRect.right &&
                                tooltipRect.top >= cardRect.top &&
                                tooltipRect.bottom <= cardRect.bottom,
                            tooltipClearOfAuthor: !overlaps(tooltipRect, authorRect),
                            tooltipClearOfDownload: !overlaps(tooltipRect, downloadRect),
                        };
                    });
                expect(layout).toEqual({
                    tooltipVisible: true,
                    linkInsideCard: true,
                    tooltipInsideCard: true,
                    tooltipClearOfAuthor: true,
                    tooltipClearOfDownload: true,
                });
            }

            const fullPage = (scenario.selectors?.[0] ?? 'document') === 'document';
            if (fullPage) {
                await materializeDeferredGlossaryGroups(page);

                // content-visibility 为真实用户的长术语表减少首屏开销，但 Chromium 的
                // fullPage 截图会保留其 contain-intrinsic-size 占位高度。视觉基准应比较
                // 完整渲染的文档，而不是这些离屏占位符。
                await page.evaluate(
                    () =>
                        new Promise((resolve) => {
                            document.querySelectorAll('[id^="group-"]').forEach((group) => {
                                group.style.setProperty('content-visibility', 'visible', 'important');
                                group.style.setProperty('contain-intrinsic-size', 'auto', 'important');
                            });
                            requestAnimationFrame(() => requestAnimationFrame(resolve));
                        }),
                );
            }

            if (scenario.label === 'en_small-desktop_glossary') {
                const bGroupLayout = await page.locator('#group-B > ul').evaluate((list) => {
                    const items = Array.from(list.querySelectorAll(':scope > li'));
                    const links = items.map((item) => item.querySelector('a'));
                    const columnLefts = [
                        ...new Set(items.map((item) => Math.round(item.getBoundingClientRect().left))),
                    ];
                    const tailRowCounts = Object.values(
                        items.slice(-5).reduce((rows, item) => {
                            const top = Math.round(item.getBoundingClientRect().top);
                            rows[top] = (rows[top] ?? 0) + 1;
                            return rows;
                        }, {}),
                    );

                    return {
                        display: getComputedStyle(list).display,
                        columnCount: getComputedStyle(list).gridTemplateColumns.split(' ').length,
                        columnCountFromItems: columnLefts.length,
                        fontSizes: [...new Set(links.map((link) => getComputedStyle(link).fontSize))],
                        tailRowCounts,
                    };
                });

                expect(bGroupLayout).toEqual({
                    display: 'grid',
                    columnCount: 4,
                    columnCountFromItems: 4,
                    fontSizes: ['15px'],
                    tailRowCounts: [4, 1],
                });
            }

            // 先由 helpers 做稳定化，再单次截图对比（避免 toHaveScreenshot 双帧稳定在长页上超时）
            const screenshot = await page.screenshot({
                fullPage,
                animations: 'disabled',
                caret: 'hide',
                scale: 'css',
            });
            expect(screenshot).toMatchSnapshot(`${scenario.label}.png`);
        });
    }
});

test.describe('glossary mobile sticky layout', () => {
    test('keeps the sticky index below the fixed navbar after scrolling', async ({ page, context }) => {
        const viewport = { label: 'mobile-sticky', width: 375, height: 812 };
        const scenario = {
            label: 'zh_mobile_glossary_sticky_layout',
            url: `${BASE_URL}/glossary`,
            locale: 'zh',
            readyPlaceholder: '搜索德州扑克术语',
            waitForLoading: true,
            delay: 0,
            selectors: ['viewport'],
            viewports: [viewport],
        };

        await prepareBeforeNavigate(page, context, scenario, viewport);
        await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
        await prepareAfterNavigate(page, scenario);

        await page.getByTestId('glossary-letter-H').click();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

        const layout = await page.evaluate(() => {
            const navbar = document.querySelector('[data-testid="navbar"]');
            const stickyIndex = document.querySelector('[data-testid="glossary-sticky-index"]');
            const targetGroup = document.querySelector('#group-H');
            const navbarRect = navbar.getBoundingClientRect();
            const stickyIndexRect = stickyIndex.getBoundingClientRect();
            const targetGroupRect = targetGroup.getBoundingClientRect();

            return {
                navbarPosition: getComputedStyle(navbar).position,
                stickyIndexPosition: getComputedStyle(stickyIndex).position,
                navbarBottom: navbarRect.bottom,
                stickyIndexTop: stickyIndexRect.top,
                stickyIndexBottom: stickyIndexRect.bottom,
                targetGroupTop: targetGroupRect.top,
            };
        });

        expect(layout.navbarPosition).toBe('fixed');
        expect(layout.stickyIndexPosition).toBe('sticky');
        expect(layout.stickyIndexTop, 'sticky index should start below the navbar').toBeGreaterThanOrEqual(
            layout.navbarBottom,
        );
        // Chromium may place scroll anchors on a half CSS pixel; allow one pixel of rounding
        // while still ensuring the group is not obscured by the sticky index.
        expect(layout.targetGroupTop, 'scrolled group should start below the sticky index').toBeGreaterThanOrEqual(
            layout.stickyIndexBottom - 1,
        );
    });
});

test.describe('glossary index active state', () => {
    for (const viewport of [
        { label: 'desktop', width: 1440, height: 900 },
        { label: 'mobile', width: 375, height: 812 },
    ]) {
        test(`${viewport.label} highlights every clicked index letter`, async ({ page, context }) => {
            const scenario = {
                label: `zh_${viewport.label}_glossary_index_active`,
                url: `${BASE_URL}/glossary`,
                locale: 'zh',
                readyPlaceholder: '搜索德州扑克术语',
                waitForLoading: true,
                delay: 0,
                selectors: ['viewport'],
                viewports: [viewport],
            };

            await prepareBeforeNavigate(page, context, scenario, viewport);
            await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
            await prepareAfterNavigate(page, scenario);

            const letters = await page.locator('[data-testid^="glossary-letter-"]').allTextContents();
            expect(letters.length).toBeGreaterThan(1);
            for (const letter of letters) {
                const index = page.getByTestId(`glossary-letter-${letter}`);
                await index.click();
                await expect(index, `${letter} should be active after clicking its index`).toHaveAttribute(
                    'aria-current',
                    'true',
                );
            }
        });
    }
});

test.describe('glossary VPIP index navigation', () => {
    for (const [locale, readyPlaceholder] of [
        ['zh', '搜索德州扑克术语'],
        ['zh-TW', '搜尋德州撲克術語'],
        ['en', 'Search glossary'],
    ]) {
        for (const viewport of [
            { label: 'desktop', width: 1440, height: 900 },
            { label: 'tablet', width: 768, height: 1024 },
            { label: 'mobile', width: 375, height: 812 },
        ]) {
            test(`${locale} ${viewport.label} keeps the V group and VPIP below the sticky index`, async ({
                page,
                context,
            }) => {
                const scenario = {
                    label: `${locale}_${viewport.label}_glossary_vpip_index`,
                    url: `${BASE_URL}/glossary`,
                    locale,
                    readyPlaceholder,
                    waitForLoading: true,
                    delay: 0,
                    selectors: ['viewport'],
                    viewports: [viewport],
                };

                await prepareBeforeNavigate(page, context, scenario, viewport);
                await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
                await prepareAfterNavigate(page, scenario);

                const index = page.getByTestId('glossary-letter-V');
                await index.click();
                await expect(index).toHaveAttribute('aria-current', 'true');

                const layout = await page.evaluate(() => {
                    const stickyBottom = document
                        .querySelector('[data-testid="glossary-sticky-index"]')
                        .getBoundingClientRect().bottom;
                    const group = document.querySelector('#group-V');
                    const term = document.querySelector('[data-testid="glossary-term-vpip"]');
                    const groupRect = group.getBoundingClientRect();
                    const termRect = term.getBoundingClientRect();
                    return {
                        groupPosition: getComputedStyle(group).position,
                        termPosition: getComputedStyle(term.parentElement).position,
                        groupTop: groupRect.top,
                        termTop: termRect.top,
                        termBottom: termRect.bottom,
                        stickyBottom,
                        viewportHeight: window.innerHeight,
                    };
                });

                expect(layout.groupPosition).not.toBe('absolute');
                expect(layout.termPosition).not.toBe('absolute');
                expect(layout.groupTop).toBeGreaterThanOrEqual(layout.stickyBottom - 1);
                expect(layout.termTop).toBeGreaterThanOrEqual(layout.stickyBottom - 1);
                expect(layout.termBottom).toBeLessThanOrEqual(layout.viewportHeight);
            });
        }
    }
});

test.describe('learning mobile card layout', () => {
    for (const width of [393, 412, 430]) {
        test(`${width}px keeps books in one readable column`, async ({ page, context }) => {
            const viewport = { label: `mobile-${width}`, width, height: 923 };
            const scenario = {
                label: `zh_mobile-${width}_learning-layout`,
                url: `${BASE_URL}/learning`,
                locale: 'zh',
                readyText: '无限德州扑克进阶指南',
                delay: 0,
                selectors: ['viewport'],
                viewports: [viewport],
            };

            await prepareBeforeNavigate(page, context, scenario, viewport);
            await mockS3Media(page);
            await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
            await prepareAfterNavigate(page, scenario);

            const layout = await page
                .locator('section')
                .filter({ has: page.locator('article') })
                .evaluate((list) => {
                    const cards = Array.from(list.querySelectorAll('article'));
                    const cardWidths = cards.map((card) => card.getBoundingClientRect().width);
                    const downloadLinksFit = cards.every((card) => {
                        const cardRect = card.getBoundingClientRect();
                        const linkRect = card
                            .querySelector('[data-testid="learning-download-link"]')
                            .getBoundingClientRect();
                        return linkRect.left >= cardRect.left && linkRect.right <= cardRect.right;
                    });

                    return {
                        columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
                        minimumCardWidth: Math.min(...cardWidths),
                        titleFontSizes: cards.map((card) =>
                            parseFloat(getComputedStyle(card.querySelector('h2')).fontSize),
                        ),
                        downloadLinksFit,
                        pageHasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
                    };
                });

            expect(layout.columns).toBe(1);
            expect(layout.minimumCardWidth).toBeGreaterThanOrEqual(360);
            expect(layout.titleFontSizes.every((fontSize) => fontSize >= 18)).toBe(true);
            expect(layout.downloadLinksFit).toBe(true);
            expect(layout.pageHasHorizontalOverflow).toBe(false);
        });
    }

    for (const width of [320, 360]) {
        test(`${width}px keeps the English download action on one line`, async ({ page, context }) => {
            const viewport = { label: `mobile-${width}`, width, height: 923 };
            const scenario = {
                label: `en_mobile-${width}_learning-layout`,
                url: `${BASE_URL}/learning`,
                locale: 'en',
                readyText: "No-Limit Hold'em For Advanced Players",
                delay: 0,
                selectors: ['viewport'],
                viewports: [viewport],
            };

            await prepareBeforeNavigate(page, context, scenario, viewport);
            await mockS3Media(page);
            await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
            await prepareAfterNavigate(page, scenario);

            const layout = await page.getByTestId('learning-download-link').evaluate((link) => {
                const cardRect = link.closest('article').getBoundingClientRect();
                const linkRect = link.getBoundingClientRect();
                const label = link.querySelector('[data-testid="learning-download-label"]');
                const range = document.createRange();
                range.selectNodeContents(label);
                const lineTops = new Set(Array.from(range.getClientRects()).map((rect) => Math.round(rect.top)));

                return {
                    lineCount: lineTops.size,
                    linkInsideCard: linkRect.left >= cardRect.left && linkRect.right <= cardRect.right,
                    pageHasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
                };
            });

            expect(layout.lineCount).toBe(1);
            expect(layout.linkInsideCard).toBe(true);
            expect(layout.pageHasHorizontalOverflow).toBe(false);
        });
    }
});

test.describe('homepage responsive breakpoint styles', () => {
    for (const { width, expectedLogoSize } of [
        { width: 480, expectedLogoSize: '13.5px' },
        { width: 769, expectedLogoSize: '15.75px' },
    ]) {
        test(`${width}px keeps mobile navigation and language controls readable`, async ({ page, context }) => {
            await openHomepageAtBreakpoint(page, context, width);
            await page.getByTestId('navbar-mobile-menu-button').click();

            const styles = await page.evaluate(() => {
                const computed = (selector) => getComputedStyle(document.querySelector(selector));
                const brand = computed('[data-testid="navbar-brand-text"]');
                const menuItem = computed('[data-testid="navbar-mobile-menu-item-navbar_home_page"]');
                const languageOption = computed(
                    '[data-testid="navbar-mobile-menu"] [data-testid="language-option-en"]',
                );

                return {
                    brandFontSize: brand.fontSize,
                    brandLineHeight: brand.lineHeight,
                    menuFontSize: menuItem.fontSize,
                    menuLineHeight: menuItem.lineHeight,
                    menuPaddingTop: menuItem.paddingTop,
                    languageFontSize: languageOption.fontSize,
                    languagePaddingTop: languageOption.paddingTop,
                };
            });

            expect(styles).toEqual({
                brandFontSize: expectedLogoSize,
                brandLineHeight: expectedLogoSize,
                menuFontSize: '11.25px',
                menuLineHeight: '15.1875px',
                menuPaddingTop: '8.1px',
                languageFontSize: '10.125px',
                languagePaddingTop: '5.625px',
            });
        });
    }

    test('800px applies responsive H5 typography and two-column spacing', async ({ page, context }) => {
        await openHomepageAtBreakpoint(page, context, 800);

        const styles = await page.evaluate(() => {
            const downloadMethod = document.querySelector('[data-testid="h5-download-method"]');
            const blocks = Array.from(document.querySelectorAll('[data-testid="h5-version-block"]'));
            const title = getComputedStyle(document.querySelector('[data-testid="h5-button-title"]'));
            const subtitle = getComputedStyle(document.querySelector('[data-testid="h5-button-subtitle"]'));
            const tutorial = getComputedStyle(document.querySelector('[data-testid="h5-tutorial-text"]'));
            const downloadStyles = getComputedStyle(downloadMethod);
            const blockRects = blocks.map((block) => block.getBoundingClientRect());

            return {
                titleFontSize: title.fontSize,
                titleLineHeight: title.lineHeight,
                subtitleFontSize: subtitle.fontSize,
                subtitleLineHeight: subtitle.lineHeight,
                tutorialFontSize: tutorial.fontSize,
                maxWidth: downloadStyles.maxWidth,
                columnGap: downloadStyles.columnGap,
                containerWidth: downloadMethod.getBoundingClientRect().width,
                blockWidths: blockRects.map((rect) => rect.width),
                renderedGap: blockRects[1].left - blockRects[0].right,
            };
        });

        expect(styles).toMatchObject({
            titleFontSize: '11.25px',
            titleLineHeight: '10.8px',
            subtitleFontSize: '8.1px',
            subtitleLineHeight: '9.315px',
            tutorialFontSize: '8.1px',
            maxWidth: '100%',
            columnGap: '9px',
        });
        expect(styles.blockWidths).toHaveLength(2);
        styles.blockWidths.forEach((width) => {
            expect(width).toBeCloseTo((styles.containerWidth - 9) / 2, 1);
        });
        expect(styles.renderedGap).toBeCloseTo(9, 1);
    });

    test('801px keeps the H5 download group capped at its desktop width', async ({ page, context }) => {
        await openHomepageAtBreakpoint(page, context, 801);

        await expect(page.getByTestId('h5-download-method')).toHaveCSS('max-width', '612px');
    });

    for (const width of [801, 820]) {
        test(`${width}px keeps the local download control stationary while the APK index is loading`, async ({
            page,
            context,
        }) => {
            let releaseApkResponse;
            const apkResponseGate = new Promise((resolve) => {
                releaseApkResponse = resolve;
            });

            await openHomepageAtBreakpoint(page, context, width, 'en', 900, async (route) => {
                await apkResponseGate;
                await route.fulfill({
                    contentType: 'application/json',
                    body: JSON.stringify(APK_INDEX_FIXTURE),
                });
            });

            await expect(page.getByTestId('home-qrcode-layout-slot')).toBeAttached();
            await expect(page.getByTestId('home-qrcode')).toHaveCount(0);
            const localDownloadControl = page.getByTestId('download-button-icon-link');
            const loadingLeft = (await localDownloadControl.boundingBox()).x;

            releaseApkResponse();
            await expect(page.getByTestId('home-qrcode')).toBeVisible();
            const loadedLeft = (await localDownloadControl.boundingBox()).x;

            expect(loadedLeft).toBeCloseTo(loadingLeft, 1);
        });
    }

    for (const { width, height, locales } of [
        { width: 801, height: 900, locales: ['en'] },
        { width: 820, height: 1180, locales: ['zh', 'zh-TW', 'en'] },
        { width: 834, height: 900, locales: ['zh', 'zh-TW', 'en'] },
        { width: 900, height: 900, locales: ['en'] },
    ]) {
        for (const locale of locales) {
            test(`${width}x${height}px ${locale} keeps the QR code clear of every store download control`, async ({
                page,
                context,
            }) => {
                await openHomepageAtBreakpoint(page, context, width, locale, height);

                const layout = await page.evaluate(() => {
                    const qrContainer = document.querySelector('[data-testid="home-qrcode-container"]');
                    const qr = document.querySelector('[data-testid="home-qrcode"]');
                    const controls = Array.from(
                        document.querySelectorAll(
                            '[data-testid="ios-download-trigger"], [data-testid="download-button-icon-link"]',
                        ),
                    );
                    const qrContainerRect = qrContainer.getBoundingClientRect();
                    const qrRect = qr.getBoundingClientRect();
                    const overlaps = (first, second) =>
                        first.left < second.right &&
                        first.right > second.left &&
                        first.top < second.bottom &&
                        first.bottom > second.top;

                    return {
                        qrVisible: getComputedStyle(qrContainer).display !== 'none',
                        qrWidth: qrRect.width,
                        qrHeight: qrRect.height,
                        controlCount: controls.length,
                        controlsAreClear: controls.every((control) => {
                            const rect = control.getBoundingClientRect();
                            return rect.width > 0 && rect.height > 0 && !overlaps(qrContainerRect, rect);
                        }),
                    };
                });

                expect(layout).toMatchObject({
                    qrVisible: true,
                    controlCount: 2,
                    controlsAreClear: true,
                });
                expect(layout.qrWidth).toBeGreaterThanOrEqual(120);
                expect(layout.qrHeight).toBeGreaterThanOrEqual(120);
            });
        }
    }

    test('801x500px keeps the QR code fully visible after scrolling to the page bottom', async ({ page, context }) => {
        await openHomepageAtBreakpoint(page, context, 801, 'en', 500);

        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForFunction(() => window.scrollY > 0);

        const layout = await page.evaluate(() => {
            const qrContainer = document.querySelector('[data-testid="home-qrcode-container"]');
            const qr = document.querySelector('[data-testid="home-qrcode"]');
            const containerRect = qrContainer.getBoundingClientRect();
            const qrRect = qr.getBoundingClientRect();

            return {
                scrollY: window.scrollY,
                containerTop: containerRect.top,
                containerBottom: containerRect.bottom,
                qrWidth: qrRect.width,
                qrHeight: qrRect.height,
                fullyVisible: containerRect.top >= 0 && containerRect.bottom <= window.innerHeight,
            };
        });

        expect(layout.scrollY).toBeGreaterThan(0);
        expect(layout.fullyVisible).toBe(true);
        expect(layout.qrWidth).toBeGreaterThanOrEqual(120);
        expect(layout.qrHeight).toBeGreaterThanOrEqual(120);
    });
});

test.describe('screenshot image materialization', () => {
    test('loads distant lazy images one at a time in Chromium, including across an image failure', async ({ page }) => {
        test.setTimeout(15000);
        await page.setViewportSize({ width: 800, height: 600 });

        const imageUrls = [0, 1, 2].map((index) => `https://materialize.test/image-${index}.svg`);
        const requestedUrls = [];
        await page.route('https://materialize.test/**', async (route) => {
            const url = route.request().url();
            requestedUrls.push(url);
            if (url === imageUrls[1]) {
                await route.fulfill({ status: 404, contentType: 'image/svg+xml', body: '' });
                return;
            }
            await route.fulfill({
                contentType: 'image/svg+xml',
                body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
            });
        });

        await page.setContent(`
            <style>
                body { margin: 0; }
                .spacer { height: 6000px; }
                img { display: block; width: 10px; height: 10px; }
            </style>
            <div class="spacer"></div>
            <img loading="lazy" src="${imageUrls[0]}" width="10" height="10">
            <div class="spacer"></div>
            <img loading="lazy" src="${imageUrls[1]}" width="10" height="10">
            <div class="spacer"></div>
            <img loading="lazy" src="${imageUrls[2]}" width="10" height="10">
        `);
        await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        expect(requestedUrls).toEqual([]);

        // Model the Chromium failure mode from CI: changing the property to eager does
        // not immediately schedule an off-screen request, so native lazy-load visibility
        // checks must observe each image after it is scrolled into the viewport.
        await page.locator('img').evaluateAll((images) => {
            for (const image of images) {
                Object.defineProperty(image, 'loading', {
                    configurable: true,
                    get: () => 'lazy',
                    set: () => {},
                });
            }
        });

        await page.evaluate(materializeImagesForScreenshot);

        expect(requestedUrls).toEqual(imageUrls);
        const imageStates = await page
            .locator('img')
            .evaluateAll((images) =>
                images.map((image) => ({ complete: image.complete, naturalWidth: image.naturalWidth })),
            );
        expect(imageStates).toEqual([
            { complete: true, naturalWidth: 10 },
            { complete: true, naturalWidth: 0 },
            { complete: true, naturalWidth: 10 },
        ]);
    });
});

test.describe('tutorial step image lazy loading', () => {
    for (const viewport of [
        { label: 'desktop-short-zh', width: 1024, height: 768, mobile: false, locale: 'zh' },
        { label: 'desktop-short-en', width: 1024, height: 768, mobile: false, locale: 'en' },
        { label: 'tablet-tall', width: 768, height: 1024, mobile: false, locale: 'zh' },
        { label: 'mobile', width: 390, height: 844, mobile: true, locale: 'zh' },
    ]) {
        test(`${viewport.label} only starts images in or near the initial viewport`, async ({ page, context }) => {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await context.addCookies([{ name: LANGUAGE_COOKIE_KEY, value: viewport.locale, url: `${BASE_URL}/` }]);
            if (viewport.mobile) {
                await page.addInitScript((userAgent) => {
                    Object.defineProperty(Navigator.prototype, 'userAgent', {
                        get: () => userAgent,
                        configurable: true,
                    });
                }, MOBILE_USER_AGENT);
            }

            const imageRequests = new Set();
            page.on('request', (request) => {
                if (request.resourceType() === 'image') {
                    imageRequests.add(request.url());
                }
            });

            await page.goto(`${BASE_URL}/tutorial`, { waitUntil: 'load' });
            await page.getByTestId('tutorial-step-one').waitFor({ state: 'visible' });
            await page.evaluate(async () => {
                await document.fonts?.ready;
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });

            const stepImages = page.locator('img[data-tutorial-step-image]');
            await expect(stepImages).toHaveCount(7);
            const initialImages = await stepImages.evaluateAll((images) =>
                images.map((image) => ({
                    loading: image.getAttribute('loading'),
                    loaded: image.dataset.loaded === 'true',
                    requestedUrl: new URL(
                        image.closest('picture').querySelector('source[data-tutorial-src-set]').dataset.tutorialSrcSet,
                        document.baseURI,
                    ).href,
                    top: image.getBoundingClientRect().top,
                    bottom: image.getBoundingClientRect().bottom,
                })),
            );

            expect(
                initialImages
                    .filter((image) => image.top < viewport.height && image.bottom > 0)
                    .every((image) => image.loading === 'eager' && image.loaded),
            ).toBe(true);
            expect(
                initialImages
                    .filter((image) => image.top >= viewport.height)
                    .every((image) => image.loading === 'lazy'),
            ).toBe(true);
            expect(
                initialImages
                    .filter((image) => image.top >= viewport.height + TUTORIAL_IMAGE_PRELOAD_MARGIN_PX)
                    .every((image) => !image.loaded && !imageRequests.has(image.requestedUrl)),
            ).toBe(true);
            expect(
                initialImages.filter((image) => image.top >= viewport.height + TUTORIAL_IMAGE_PRELOAD_MARGIN_PX).length,
            ).toBeGreaterThan(0);
        });
    }

    test('starts a slow step image before it enters the viewport', async ({ page, context }) => {
        const viewport = { width: 1024, height: 768 };
        await page.setViewportSize(viewport);
        await context.addCookies([{ name: LANGUAGE_COOKIE_KEY, value: 'zh', url: `${BASE_URL}/` }]);
        await page.goto(`${BASE_URL}/tutorial`, { waitUntil: 'load' });
        await page.getByTestId('tutorial-step-one').waitFor({ state: 'visible' });
        await page.evaluate(async () => {
            await document.fonts?.ready;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });

        const stepImages = page.locator('img[data-tutorial-step-image]');
        const deferredIndex = await stepImages.evaluateAll((images) =>
            images.findIndex((image) => image.dataset.loaded === 'false'),
        );
        expect(deferredIndex).toBeGreaterThanOrEqual(0);
        const deferredStepImage = stepImages.nth(deferredIndex);
        await expect(deferredStepImage).toHaveAttribute('loading', 'lazy');
        const webpUrl = await deferredStepImage.evaluate(
            (image) =>
                new URL(
                    image.closest('picture').querySelector('source[data-tutorial-src-set]').dataset.tutorialSrcSet,
                    document.baseURI,
                ).href,
        );

        let requestStarted = false;
        await page.route(webpUrl, async (route) => {
            requestStarted = true;
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await route.continue();
        });

        await deferredStepImage.evaluate((image, margin) => {
            const distanceToPreload = image.getBoundingClientRect().top - window.innerHeight - margin / 2;
            window.scrollBy(0, Math.max(1, distanceToPreload));
        }, TUTORIAL_IMAGE_PRELOAD_MARGIN_PX);
        await expect.poll(() => requestStarted).toBe(true);
        await expect(deferredStepImage).toHaveAttribute('data-loaded', 'true');
        expect(await deferredStepImage.evaluate((image) => image.getBoundingClientRect().top)).toBeGreaterThan(
            viewport.height,
        );
        expect(await deferredStepImage.evaluate((image) => image.naturalWidth)).toBe(0);

        await expect.poll(() => deferredStepImage.evaluate((image) => image.naturalWidth > 0)).toBe(true);
        expect(await deferredStepImage.evaluate((image) => image.getBoundingClientRect().top)).toBeGreaterThan(
            viewport.height,
        );

        await deferredStepImage.scrollIntoViewIfNeeded();
        expect(await deferredStepImage.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    });

    test('mobile viewport defers step images and loads every image while scrolling', async ({ page, context }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await context.addCookies([{ name: LANGUAGE_COOKIE_KEY, value: 'zh', url: `${BASE_URL}/` }]);
        await page.addInitScript((userAgent) => {
            Object.defineProperty(Navigator.prototype, 'userAgent', {
                get: () => userAgent,
                configurable: true,
            });
        }, MOBILE_USER_AGENT);

        const imageRequests = new Set();
        page.on('request', (request) => {
            if (request.resourceType() === 'image') {
                imageRequests.add(request.url());
            }
        });

        await page.goto(`${BASE_URL}/tutorial`, { waitUntil: 'domcontentloaded' });
        await page.getByTestId('tutorial-step-one').waitFor({ state: 'visible' });
        await page.waitForLoadState('load');
        await page.evaluate(async () => {
            await document.fonts?.ready;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        });

        const stepImages = page.locator('img[data-tutorial-step-image]');
        await expect(stepImages).toHaveCount(7);
        const webpUrls = await stepImages.evaluateAll((images) =>
            images.map((image) => {
                const source = image.closest('picture').querySelector('source[data-tutorial-src-set]');
                return new URL(source.dataset.tutorialSrcSet, document.baseURI).href;
            }),
        );

        const initialImages = await stepImages.evaluateAll((images) =>
            images.map((image) => ({
                loading: image.getAttribute('loading'),
                loaded: image.dataset.loaded === 'true',
                top: image.getBoundingClientRect().top,
                bottom: image.getBoundingClientRect().bottom,
            })),
        );
        expect(initialImages.filter((image) => image.top >= 844).every((image) => image.loading === 'lazy')).toBe(true);
        expect(
            initialImages
                .filter((image) => image.top >= 844 + TUTORIAL_IMAGE_PRELOAD_MARGIN_PX)
                .every((image) => !image.loaded),
        ).toBe(true);
        expect(
            webpUrls.filter(
                (url, index) =>
                    initialImages[index].top >= 844 + TUTORIAL_IMAGE_PRELOAD_MARGIN_PX && imageRequests.has(url),
            ),
        ).toHaveLength(0);
        expect(webpUrls.filter((url) => imageRequests.has(url)).length).toBeLessThan(7);
        const initialDocumentHeight = await page.evaluate(() => document.documentElement.scrollHeight);

        for (let index = 0; index < (await stepImages.count()); index += 1) {
            const image = stepImages.nth(index);
            await image.scrollIntoViewIfNeeded();
            await expect(image).toHaveAttribute('data-loaded', 'true');
            await expect
                .poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0))
                .toBe(true);
        }

        expect(webpUrls.filter((url) => imageRequests.has(url))).toHaveLength(7);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(initialDocumentHeight);
    });
});

// loading spinner 只在极短窗口内可见，靠拦截请求人为拉长这个窗口，
// 而不是真的等首屏/路由 chunk 加载完——那样拍到的就是已加载完成的页面了。
test.describe('loading spinner', () => {
    test('zh_desktop_boot_loading', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await disableAnimations.apply(page);

        // 延迟全部入口脚本，让 React 挂载前、index.html 里纯 CSS 的兜底 loading 保持可见
        await page.route('**/assets/*.js', async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await route.continue();
        });

        // 'commit' 只等导航提交、不等脚本执行，否则会连同上面的延迟一起卡在 goto 里
        await page.goto(`${BASE_URL}/`, { waitUntil: 'commit' });
        await page.waitForSelector('[data-testid="boot-loading"]', { state: 'visible', timeout: 10000 });
        await disableAnimations.apply(page);

        const screenshot = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
        expect(screenshot).toMatchSnapshot('zh_desktop_boot_loading.png');
    });

    test('zh_desktop_fullpage_loading', async ({ page, context }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await disableAnimations.apply(page);
        await context.addCookies([{ name: LANGUAGE_COOKIE_KEY, value: 'zh', url: `${BASE_URL}/` }]);

        // 入口脚本正常加载好让 React 挂载；只延迟路由懒加载 chunk，
        // 让 App.tsx 的 Suspense fallback（LoadingSpinner fullPage）保持可见
        await page.route('**/assets/*.js', async (route) => {
            if (ENTRY_JS_RE.test(route.request().url())) {
                await route.continue();
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await route.continue();
        });

        await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-testid="loading-spinner"]', { state: 'visible', timeout: 10000 });
        // 兜底 boot-loading 会一直覆盖到首屏内容提交（见 src/bootLoading.ts），
        // 此处手动移除，以便对其下层的 Suspense fallback（LoadingSpinner fullPage）截图
        await page.evaluate(() => document.getElementById('boot-loading')?.remove());
        await disableAnimations.apply(page);

        const screenshot = await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
        expect(screenshot).toMatchSnapshot('zh_desktop_fullpage_loading.png');
    });
});

test.describe('glossary cold deck', () => {
    for (const [locale, slug, name, sources, letter] of [
        ['zh', 'lengpaizu', '冷牌组', ['lengyin', 'meipai'], 'L'],
        ['zh-TW', 'lengpaizu', '冷牌組', ['lengyin', 'meipai'], 'L'],
        ['en', 'colddeck', 'Cold Deck', ['cooler', 'carddead', 'badbeat'], 'C'],
    ]) {
        for (const viewport of [
            { label: 'desktop', width: 1440, height: 900 },
            { label: 'mobile', width: 375, height: 812 },
        ]) {
            test(`${locale} ${viewport.label} cold deck definition and incoming links`, async ({ page, context }) => {
                const scenario = {
                    label: `${locale}_${viewport.label}_cold_deck`,
                    url: `${BASE_URL}/glossary/${locale}/${slug}`,
                    locale,
                    readySelector: '[data-testid="definition-body"]',
                    waitForLoading: true,
                    delay: 0,
                    selectors: ['document'],
                    viewports: [viewport],
                };
                await prepareBeforeNavigate(page, context, scenario, viewport);
                await page.goto(scenario.url, { waitUntil: 'domcontentloaded' });
                await prepareAfterNavigate(page, scenario);
                await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
                await expect(page).toHaveScreenshot(`${locale}-${viewport.label}-cold-deck.png`, { fullPage: true });

                for (const source of sources) {
                    await page.goto(`${BASE_URL}/glossary/${locale}/${source}`);
                    const topics = page.getByTestId('related-topics');
                    const link = topics.getByRole('link', { name, exact: true });
                    await expect(link).toHaveAttribute('href', `/glossary/${locale}/${slug}`);
                    if (locale !== 'en') await expect(topics).not.toContainText('Cold Deck');
                    await link.click();
                    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
                }
                await page.goto(`${BASE_URL}/glossary`);
                await page.getByTestId(`glossary-letter-${letter}`).click();
                const term = page.locator(`[data-glossary-group="${letter}"]`).getByTestId(`glossary-term-${slug}`);
                await expect(term).toBeVisible();
                await expect(term).toHaveAttribute('href', `/glossary/${locale}/${slug}`);
            });
        }
    }
});
