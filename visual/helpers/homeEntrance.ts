import { expect, type Page } from '@playwright/test';

/** 隐藏二维码的地址编码，保留截图中的二维码位置、大小和说明文字。
 * @param page - 截取首页的页面。
 */
export async function maskHomeDownloadQr(page: Page): Promise<void> {
    const payloads = page.locator('main:has([data-testid="home-title"]) figure svg path:last-child');
    await payloads.evaluateAll(
        /** 修改呈现属性，避免部署站点的 CSP 拦截注入样式。 */ (paths) => {
            for (const path of paths) path.setAttribute('fill', 'none');
        },
    );
}

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

/** 等待字体和图片就绪，完成应用预览截图的交叉渐显。 */
export async function prepareHomeAssets(page: Page) {
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
