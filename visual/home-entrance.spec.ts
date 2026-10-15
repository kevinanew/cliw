import { test, expect } from '@playwright/test';
import { LANGUAGE_COOKIE_KEY, PAGES, resolveLocales, resolveViewports } from './scenarios';
import {
    captureHomeAnimations,
    prepareHomeAssets,
    assertHomeEntranceTiming,
    seekHomeEntrance,
} from './helpers/homeEntrance';

const homepage = PAGES.find((page) => page.label === 'homepage');
const viewports = resolveViewports().filter((viewport) => ['desktop', 'mobile'].includes(viewport.label));
const checkpoints = [0, 200, 400, 600, 1000, 1400];

test.describe('首页分批入场 home_entrance', () => {
    for (const locale of resolveLocales()) {
        const expectedTitle = Object.entries(homepage?.expectedReadyText ?? {})
            .find(([code]) => code === locale.code)?.[1];
        if (!expectedTitle) throw new Error(`缺少 ${locale.code} 的首页标题契约`);
        for (const viewport of viewports) {
            test(`${locale.code}_${viewport.label}_home_entrance`, async ({ page, context }, testInfo) => {
                await page.setViewportSize({ width: viewport.width, height: viewport.height });
                await page.emulateMedia({ reducedMotion: 'no-preference' });
                await context.addCookies([{
                    name: LANGUAGE_COOKIE_KEY,
                    value: locale.code,
                    url: `${new URL(testInfo.project.use.baseURL!).origin}/`,
                }]);
                await captureHomeAnimations(page);
                // 与现有静态首页快照使用相同版本数据，避免发布新 APK 改变动画截图。
                await page.route('**/apk/index.json', (route) => route.fulfill({
                    json: { apk_files: ['顶级玩家-2.0.2308151624.apk', '顶级玩家-2.0.2308151249.apk'] },
                }));
                await page.goto('/', { waitUntil: 'load' });
                await expect(page.getByTestId('home-title')).toHaveText(expectedTitle);
                await prepareHomeAssets(page);
                await assertHomeEntranceTiming(page, viewport.label === 'desktop');

                for (const milliseconds of checkpoints) {
                    await test.step(`入场后 ${milliseconds}ms`, async () => {
                        await seekHomeEntrance(page, milliseconds);
                        // 必须允许动画，避免截图 API 将已暂停的入场动画快进到结束。
                        const screenshot = await page.screenshot({
                            animations: 'allow',
                            caret: 'hide',
                            scale: 'css',
                            fullPage: true,
                        });
                        expect(screenshot).toMatchSnapshot(
                            `${locale.code}-${viewport.label}-home-entrance-${milliseconds}ms.png`,
                        );
                    });
                }
            });
        }
    }
});
