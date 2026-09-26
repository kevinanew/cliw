import { test, expect } from '@playwright/test';

for (const version of ['laiwan-life', 'laiwanpai-com']) {
    test(`HOME-008: ${version} 网页版入口与安装教程地址一致`, async ({ page }) => {
        let playUrl: string;
        await test.step('读取首页对应版本的网页版入口', async () => {
            await page.goto('/?lang=zh', { waitUntil: 'domcontentloaded' });
            const play = page.getByTestId(`h5-play-link-${version}`);
            await expect(play, '网页版链接需要部署稳定业务 test id').toHaveCount(1);
            await expect(play).toBeVisible();
            playUrl = (await play.getAttribute('href')) ?? '';
            expect(new URL(playUrl).protocol).toBe('https:');
        });
        await test.step('实际打开对应安装教程并核对两个地址', async () => {
            const tutorial = page.getByTestId(`h5-tutorial-link-${version}`);
            await expect(tutorial).toHaveCount(1);
            await tutorial.click();
            await expect(page).toHaveURL(
                (url) => url.pathname === `/h5-tutorial/${version}` && url.searchParams.get('lang') === 'zh',
            );
            for (const id of ['h5-tutorial-url-link-0', 'h5-tutorial-url-link-1']) {
                const link = page.getByTestId(id);
                await expect(link).toHaveCount(1);
                await expect(link).toHaveAttribute('href', playUrl);
                await expect(link).toHaveText(playUrl);
            }
        });
    });
}
