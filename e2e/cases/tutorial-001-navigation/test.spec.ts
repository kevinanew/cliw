import { test, expect } from '@playwright/test';

test('TUTORIAL-001: 教程导航进入术语页并返回', async ({ page }, testInfo) => {
    const mobile = testInfo.project.name === 'mobile';
    await test.step('准备中文教程及响应式导航', async () => {
        await page.goto('/tutorial?lang=zh', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('tutorial-step-one')).toHaveCount(1);
        await expect(page.getByTestId('tutorial-step-one')).toBeVisible();
        if (mobile) {
            const button = page.getByTestId('mobile-nav-menu-button');
            await expect(button).toHaveCount(1);
            await button.click();
            await expect(page.getByTestId('mobile-drawer-content')).toHaveCount(1);
            await expect(page.getByTestId('mobile-drawer-content')).toBeVisible();
        }
    });
    await test.step('通过导航进入术语页', async () => {
        const link = page.getByTestId(
            mobile ? 'mobile-nav-link-glossary' : 'tutorial-nav-link-navbar_terminology_list',
        );
        await expect(link).toHaveCount(1);
        await expect(link).toHaveAttribute('href', '/glossary');
        await link.click();
        await expect(page).toHaveURL((url) => url.pathname === '/glossary' && url.searchParams.get('lang') === 'zh');
        await expect(page.getByTestId('glossary-header')).toHaveCount(1);
        await expect(page.getByTestId('glossary-header')).toBeVisible();
        await expect(page.getByTestId('mobile-drawer-content')).toHaveCount(0);
    });
    await test.step('浏览器返回教程后内容与导航恢复', async () => {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL((url) => url.pathname === '/tutorial' && url.searchParams.get('lang') === 'zh');
        await expect(page.getByTestId('tutorial-step-one')).toHaveCount(1);
        await expect(page.getByTestId('tutorial-step-one')).toBeVisible();
        if (mobile) {
            await expect(page.getByTestId('mobile-drawer-content')).toHaveCount(0);
            await expect(page.getByTestId('mobile-nav-menu-button')).toBeVisible();
        }
    });
});
