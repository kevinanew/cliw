const { test, expect } = require('@playwright/test');

test('HOME-006: 首页第二组 H5 教程入口与返回', async ({ page }) => {
    await test.step('打开中文首页', async () => {
        await page.goto('/?lang=zh', { waitUntil: 'domcontentloaded' });
        const title = page.getByTestId('home-title');
        await expect(title).toHaveCount(1);
        await expect(title).toBeVisible();
    });

    await test.step('点击第二组添加至桌面入口', async () => {
        // 两组入口文案相同，按业务标识区分，不依赖 DOM 顺序。
        const link = page.getByTestId('h5-tutorial-link-laiwanpai-com');
        await expect(link, 'ISSUE-003：第二组 H5 教程入口缺少唯一 test ID，需在网站源码补齐').toHaveCount(1);
        await expect(link).toHaveAttribute('href', '/h5-tutorial/laiwanpai-com');
        await link.click();
        await expect(page).toHaveURL(
            (url) => url.pathname === '/h5-tutorial/laiwanpai-com' && url.searchParams.get('lang') === 'zh',
        );
    });

    await test.step('教程地址与步骤中的 H5 地址一致', async () => {
        const introductionLink = page.getByTestId('h5-tutorial-url-link-0');
        const stepLink = page.getByTestId('h5-tutorial-url-link-1');
        await expect(introductionLink).toHaveCount(1);
        await expect(stepLink).toHaveCount(1);
        await expect(introductionLink).toBeVisible();
        await expect(stepLink).toBeVisible();
        const href = await introductionLink.getAttribute('href');
        expect(new URL(href).protocol).toBe('https:');
        await expect(introductionLink).toHaveText(href);
        await expect(stepLink).toHaveAttribute('href', href);
        await expect(stepLink).toHaveText(href);
    });

    await test.step('浏览器返回后第二组入口仍可用', async () => {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL((url) => url.pathname === '/' && url.searchParams.get('lang') === 'zh');
        await expect(page.getByTestId('home-title')).toBeVisible();
        await expect(page.getByTestId('h5-tutorial-link-laiwanpai-com')).toBeVisible();
    });
});
