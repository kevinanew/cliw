const { LANGUAGE_COOKIE_KEY } = require('../scenarios');
const disableAnimations = require('./disableAnimations');
const clickAndHoverHelper = require('./clickAndHoverHelper');
const stabilizeVideos = require('./stabilizeVideos');
const stabilizeBackdropFilter = require('./stabilizeBackdropFilter');
const loadCookies = require('./loadCookies');

/**
 * 全页截图需要包含视口外的懒加载图片。Chromium 不会主动请求这些图片，若直接
 * 等待 img.complete，页面会永久卡住。仅在视觉测试页面中把未完成的 lazy 图片
 * 物化为 eager，再等待图片成功或失败，生产页面的加载策略不受影响。
 */
async function materializeImagesForScreenshot() {
    function materializeTutorialImages() {
        const tutorialImages = Array.from(document.querySelectorAll('img[data-tutorial-step-image]'));
        for (const img of tutorialImages) {
            if (img.getAttribute('src')) continue;

            const source = img.closest('picture')?.querySelector('source[data-tutorial-src-set]');
            if (source) source.srcset = source.dataset.tutorialSrcSet;
            img.src = img.dataset.tutorialSrc;
            img.dataset.loaded = 'true';
        }
    }

    function getImageState(img) {
        const isLazy = img.loading === 'lazy';
        const hasNoDrawablePixels = img.naturalWidth === 0;
        return {
            isLazy,
            hasNoDrawablePixels,
            needsViewportTrigger: isLazy && (!img.complete || hasNoDrawablePixels),
        };
    }

    function waitForTwoAnimationFrames() {
        if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
        return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    function activateLazyImage(img) {
        const state = getImageState(img);
        if (!state.isLazy) return { wasLazy: false, frameWait: null };

        img.loading = 'eager';
        if (!state.needsViewportTrigger || typeof img.scrollIntoView !== 'function') {
            return { wasLazy: true, frameWait: null };
        }

        img.scrollIntoView({ block: 'center', inline: 'nearest' });
        return { wasLazy: true, frameWait: waitForTwoAnimationFrames() };
    }

    function ensureImageRequestStarted(img) {
        if (!img.complete || img.naturalWidth !== 0) return;

        const selectedSource = img.currentSrc || img.src;
        if (!selectedSource) return;

        const canInspectResources =
            typeof performance !== 'undefined' && typeof performance.getEntriesByName === 'function';
        const requestAlreadyStarted = canInspectResources && performance.getEntriesByName(selectedSource).length > 0;
        if (!requestAlreadyStarted) img.src = selectedSource;
    }

    async function safelyDecodeImage(img) {
        try {
            await img.decode();
            if (img.naturalWidth === 0) throw new Error('Image decode resolved without rendered image data');
        } catch {
            // 图片失败态也属于稳定结果，无需让整套视觉测试卡住。
        }
    }

    // 教程步骤图在接近视口前不会设置 src/srcset。全页视觉回归需要显式物化这些
    // 测试页面中的资源，否则截图只能得到为稳定宽高预留的空白占位。
    materializeTutorialImages();

    const images = Array.from(document.images);
    for (const img of images) {
        const { wasLazy, frameWait } = activateLazyImage(img);
        if (frameWait) await frameWait;
        if (wasLazy) ensureImageRequestStarted(img);
        await safelyDecodeImage(img);
    }

    // decode() resolve 表示图片可用于绘制；再让出两帧，确保 Chromium
    // 完成样式、布局和像素提交后才把控制权还给截图步骤。
    await waitForTwoAnimationFrames();
}

/**
 * 导航前准备：视口、减弱动效、语言 cookie。
 */
async function prepareBeforeNavigate(page, context, scenario, viewport) {
    await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await disableAnimations.apply(page);

    if (scenario.locale) {
        const { origin } = new URL(scenario.url);
        await context.addCookies([
            {
                name: LANGUAGE_COOKIE_KEY,
                value: scenario.locale,
                url: `${origin}/`,
            },
        ]);
    }

    // 需要覆盖 UA 的专项场景必须在导航前注入。
    if (scenario.userAgent) {
        await page.addInitScript((userAgent) => {
            Object.defineProperty(Navigator.prototype, 'userAgent', {
                get() {
                    return userAgent;
                },
                configurable: true,
            });
        }, scenario.userAgent);
    }

    await loadCookies(context, scenario);
}

/**
 * 导航后等待页面就绪并做截图前稳定化。
 */
async function prepareAfterNavigate(page, scenario) {
    console.log(`SCENARIO > ${scenario.label}`);

    await page.waitForSelector('#laiwan', { timeout: 30000 });
    await page.waitForLoadState('load');

    if (scenario.waitForLoading) {
        await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), {
            timeout: 30000,
        });
    }

    if (scenario.readySelector) {
        await page.locator(scenario.readySelector).first().waitFor({
            state: 'visible',
            timeout: 30000,
        });
    } else if (scenario.readyPlaceholder) {
        await page.locator(`input[placeholder="${scenario.readyPlaceholder}"]:visible`).first().waitFor({
            timeout: 30000,
        });
    } else if (scenario.readyText) {
        await page.getByText(scenario.readyText, { exact: true }).first().waitFor({
            state: 'visible',
            timeout: 30000,
        });
    }

    await page.evaluate(async () => {
        if (!document.fonts) {
            return;
        }

        // 自托管字体（Inter / Noto Sans SC）只有在实际用到时才会被浏览器触发下载，
        // 如果截图时机早于该触发时刻，document.fonts.ready 会针对"当前"（空）的
        // 加载队列立即 resolve，从而在字体真正下载完成前就已经完成截图。
        // 这里显式主动加载，确保字体请求已经发出，再等待 ready 队列清空。
        await Promise.all([
            document.fonts.load('400 16px Inter'),
            document.fonts.load('700 16px Inter'),
            document.fonts.load('400 16px "Noto Sans SC"'),
            document.fonts.load('700 16px "Noto Sans SC"'),
        ]);

        if (document.fonts.ready) {
            await document.fonts.ready;
        }
    });

    await page.evaluate(materializeImagesForScreenshot);

    // BlurUpImage 在 img.complete 之后仍需一次 React 状态更新才会加上 data-loaded。
    // 若截图早于该更新，会拍到模糊占位层（opacity:0 的高清图），导致桌面端首页不稳定。
    await page.waitForFunction(
        () => {
            const fullImages = Array.from(document.querySelectorAll('[data-testid="blur-up-full"]'));
            if (fullImages.length === 0) {
                return true;
            }
            return fullImages.every(
                (img) => img.getAttribute('data-loaded') === 'true' || (img.complete && img.naturalWidth === 0),
            );
        },
        { timeout: 10000 },
    );

    // 每个场景都使用新页面，但浏览器仍可能在资源加载或焦点恢复时保留滚动位置。
    // 截图前显式回到文档起点，确保无交互的长页基准从导航、说明和第一项内容开始。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction(() => window.scrollX === 0 && window.scrollY === 0);

    await disableAnimations.apply(page);
    await clickAndHoverHelper(page, scenario);
    await stabilizeVideos.apply(page);
    await stabilizeBackdropFilter.apply(page);

    const delayMs = Number(scenario.delay) || 0;
    if (delayMs > 0) {
        await page.waitForTimeout(delayMs);
    }
}

module.exports = {
    materializeImagesForScreenshot,
    prepareBeforeNavigate,
    prepareAfterNavigate,
};
