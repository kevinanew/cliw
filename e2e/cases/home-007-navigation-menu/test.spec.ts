import { test, expect } from '@playwright/test';

test('HOME-007: 主导航进入学习页并通过品牌链接返回', async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile';
    await test.step('打开中文首页并准备主导航', async () => {
        await page.goto('/?lang=zh', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('home-title')).toHaveCount(1);
        if (mobile) {
            const toggle = page.getByTestId('navbar-mobile-menu-button');
            await expect(toggle).toHaveCount(1);
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await toggle.click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await expect(page.getByTestId('navbar-mobile-menu')).toHaveCount(1);
            await expect(page.getByTestId('navbar-mobile-menu')).toBeVisible();
        }
    });
    await test.step('进入学习页并确认手机菜单关闭', async () => {
        const link = page.getByTestId(
            mobile ? 'navbar-mobile-menu-item-navbar_learning' : 'navbar-link-navbar_learning',
        );
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('href', '/learning');
        await link.click();
        await expect(page).toHaveURL((url) => url.pathname === '/learning' && url.searchParams.get('lang') === 'zh');
        await expect(page.getByTestId('learning-page')).toHaveCount(1);
        await expect(page.getByTestId('learning-page')).toBeVisible();
        if (mobile) {
            await expect(page.getByTestId('navbar-mobile-menu')).toHaveCount(0);
            await expect(page.getByTestId('navbar-mobile-menu-button')).toHaveAttribute('aria-expanded', 'false');
        }
    });
    await test.step('点击品牌链接返回首页，保留语言', async () => {
        const home = page.getByTestId('navbar-home-link');
        await expect(home, '品牌首页链接需要部署 navbar-home-link 标识').toHaveCount(1);
        await expect(home).toHaveAttribute('href', '/');
        await home.click();
        await expect(page).toHaveURL((url) => url.pathname === '/' && url.searchParams.get('lang') === 'zh');
        await expect(page.getByTestId('home-title')).toHaveCount(1);
        await expect(page.getByTestId('home-title')).toBeVisible();
    });
});
