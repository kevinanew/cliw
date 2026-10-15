import { expect, type Page } from '@playwright/test';

interface CapturedAnimation {
    animation: Animation;
    initialPlayState: AnimationPlayState;
}

declare global {
    interface Window {
        homeEntranceCapture: Map<Animation, CapturedAnimation>;
    }
}

/** 在业务脚本执行前捕获真实创建的动画，暂停并归零，保留原始时序和关键帧。 */
export async function captureHomeAnimations(page: Page) {
    await page.addInitScript(() => {
        const captured = new Map<Animation, CapturedAnimation>();
        window.homeEntranceCapture = captured;

        function capture() {
            for (const animation of document.getAnimations()) {
                if (captured.has(animation)) continue;
                captured.set(animation, { animation, initialPlayState: animation.playState });
                animation.pause();
                animation.currentTime = 0;
            }
        }

        // 挂载时立即捕获入场动画，逐帧补充图片加载后新创建的过渡；不覆写生产 CSS。
        new MutationObserver(capture).observe(document, { childList: true, subtree: true });
        function captureNextFrame() {
            capture();
            requestAnimationFrame(captureNextFrame);
        }
        requestAnimationFrame(captureNextFrame);
    });
}

/** 等待字体和图片就绪，仅完成资源淡入，其他装饰动画保持在固定进度。 */
export async function prepareHomeAssets(page: Page) {
    await expect(page.getByTestId('home-background-image')).toHaveAttribute('data-loaded', 'true');
    await expect(page.getByTestId('blur-up-full')).toHaveAttribute('data-loaded', 'true');
    await expect(page.getByTestId('download-button-icon-link')).toHaveAttribute('href', /\.apk$/);
    await page.evaluate(async () => {
        await Promise.all([
            document.fonts.load('400 16px Inter'),
            document.fonts.load('700 16px Inter'),
            document.fonts.load('400 16px "Noto Sans SC"'),
            document.fonts.load('700 16px "Noto Sans SC"'),
            ...Array.from(document.images, (image) => image.decode()),
        ]);
        await document.fonts.ready;
        for (const animation of document.getAnimations()) {
            if (animation instanceof CSSTransition) animation.finish();
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
}

/** 验证真实页面的入场动画数量、触发状态与时间契约，防止缺失动画也生成通过的截图。 */
export async function assertHomeEntranceTiming(page: Page, phoneVisible: boolean) {
    const animations = await page.evaluate(() =>
        document.getAnimations().filter((animation) =>
            animation instanceof CSSAnimation && animation.animationName === 'fade-rise',
        ).map((animation) => {
            const timing = animation.effect!.getTiming();
            return {
                delay: timing.delay ?? 0,
                duration: timing.duration,
                iterations: timing.iterations,
                fill: timing.fill,
                direction: timing.direction,
                playbackRate: animation.playbackRate,
                initialPlayState: window.homeEntranceCapture.get(animation)?.initialPlayState,
            };
        }).sort((left, right) => left.delay - right.delay),
    );
    const delays = phoneVisible ? [0, 0, 200, 400, 400, 600, 600] : [0, 0, 200, 400, 400, 600];
    expect(animations, '首页各组必须实际创建并启动预期的入场动画').toEqual(delays.map((delay) => ({
        delay,
        duration: 800,
        iterations: 1,
        fill: 'both',
        direction: 'normal',
        playbackRate: 1,
        initialPlayState: 'running',
    })));

    // 通过已有业务标识检查对应元素，防止互换延迟后总数量仍然相同。
    const anchors = [
        { testId: 'home-title', delay: 0 },
        { testId: 'h5-download-method', delay: 400 },
        { testId: 'ios-download-trigger', delay: 400 },
        { testId: 'home-version-text', delay: 600 },
        ...(phoneVisible ? [{ testId: 'blur-up-full', delay: 600 }] : []),
    ];
    for (const { testId, delay } of anchors) {
        const timings = await page.getByTestId(testId).evaluate((element) =>
            document.getAnimations().filter((animation) => {
                const target = (animation.effect as KeyframeEffect)?.target;
                return animation instanceof CSSAnimation && animation.animationName === 'fade-rise'
                    && target?.contains(element);
            }).map((animation) => animation.effect!.getTiming().delay),
        );
        expect(timings, `${testId} 必须使用正确的入场延迟`).toEqual([delay]);
    }
}

/** 所有入场元素使用同一个毫秒时间轴，保留各自的生产延迟，不按百分比分别推进。 */
export async function seekHomeEntrance(page: Page, milliseconds: number) {
    await page.evaluate(async (time) => {
        for (const animation of document.getAnimations()) {
            if (animation instanceof CSSAnimation && animation.animationName === 'fade-rise') {
                animation.currentTime = time;
            }
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, milliseconds);
}
