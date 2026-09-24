const { test, expect } = require('@playwright/test');

test('HOME-002: 首页安装教程入口', async ({ page }) => {
    await test.step('准备英文首页', async () => {
        await page.goto('/?lang=en');
        await expect(page.getByTestId('home-title')).toHaveCount(1);
    });
    await test.step('操作第一组添加至桌面入口', async () => {
        // ISSUE-002: 部署页面的链接尚无 ID；此断言会明确失败，建议 ID 尚未落实。
        const link = page.getByTestId('home-h5-tutorial-link-laiwan-life');
        await expect(link, 'ISSUE-002：首页第一组“添加至桌面”链接缺少测试定位契约').toHaveCount(1);
        await link.click();
    });
    await test.step('断言安装教程路由', async () => {
        await expect(page).toHaveURL(/\/h5-tutorial\/laiwan-life\?lang=en$/);
        await expect(page.getByTestId('h5-tutorial-url-link-0')).toHaveCount(1);
    });
});
