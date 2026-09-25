const { test, expect } = require('@playwright/test');

test('HOME-002: 首页安装教程入口', async ({ page }) => {
    await test.step('准备英文首页', async () => {
        await page.goto('/?lang=en');
        await expect(page.getByTestId('home-title')).toHaveCount(1);
    });
    await test.step('操作第一组添加至桌面入口', async () => {
        const link = page.locator('a[href="/h5-tutorial/laiwan-life"]');
        await expect(link).toHaveCount(1);
        await link.click();
    });
    await test.step('断言安装教程路由', async () => {
        await expect(page).toHaveURL(/\/h5-tutorial\/laiwan-life\?lang=en$/);
        await expect(page.getByTestId('h5-tutorial-url-link-0')).toHaveCount(1);
    });
});
