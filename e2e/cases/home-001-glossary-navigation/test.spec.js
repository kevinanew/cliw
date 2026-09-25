const { test, expect } = require('@playwright/test');

test('HOME-001: 首页导航进入术语表', async ({ page }, testInfo) => {
    await test.step('准备英文首页', async () => {
        await page.goto('/?lang=en', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('home-title')).toHaveCount(1);
    });
    await test.step('操作导航入口', async () => {
        if (testInfo.project.name === 'mobile') {
            const menu = page.getByTestId('navbar-mobile-menu-button');
            await expect(menu).toHaveCount(1);
            await menu.click();
            const link = page.getByTestId('navbar-mobile-menu-item-navbar_terminology_list');
            await expect(link).toHaveCount(1);
            await link.click();
        } else {
            const link = page.getByTestId('navbar-link-navbar_terminology_list');
            await expect(link).toHaveCount(1);
            await link.click();
        }
    });
    await test.step('断言术语页和语言', async () => {
        await expect(page).toHaveURL(/\/glossary\?lang=en$/);
        await expect(page.getByTestId('glossary-header')).toHaveCount(1);
        await expect(page.getByTestId('glossary-header')).toContainText('Texas Hold');
    });
});
