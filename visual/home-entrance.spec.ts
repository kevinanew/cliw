import { test, expect } from '@playwright/test';
import { resolveLocales, resolveViewports } from './scenarios';
import { holdRequests, prepareMotion } from './helpers/motion';

const viewports = resolveViewports().filter((viewport) => ['desktop', 'mobile'].includes(viewport.label));

test.describe('首页入口立即可用 home_entrance', () => {
    for (const locale of resolveLocales()) {
        for (const viewport of viewports) {
            test(`${locale.code}_${viewport.label}_home_entrance`, async ({ page }, testInfo) => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await prepareMotion(page, locale.code, testInfo.project.use.baseURL!);
                const artwork = await holdRequests(page, /\.webp$/);
                try {
                    await page.goto('/', { waitUntil: 'domcontentloaded' });
                    await expect(page.getByTestId('home-title')).toBeVisible();
                    await expect(page.getByTestId('download-button-icon-link')).toHaveAttribute('href', /\.apk$/);
                    expect(artwork.count()).toBeGreaterThan(0);

                    const controls = [
                        'home-title',
                        'h5-play-link-laiwan-life',
                        'h5-play-link-laiwanpai-com',
                        'ios-download-trigger',
                        'download-button-icon-link',
                    ];
                    for (const testId of controls) {
                        const control = page.getByTestId(testId);
                        await expect(control).toBeVisible();
                        const opacity = await control.evaluate((element) => {
                            let opacity = 1;
                            for (let current: Element | null = element; current; current = current.parentElement) {
                                opacity *= Number(getComputedStyle(current).opacity);
                            }
                            return opacity;
                        });
                        expect(opacity, `${testId} 不应等待插图或入场动画才可见`).toBe(1);
                    }
                } finally {
                    artwork.release();
                }
            });
        }
    }
});
