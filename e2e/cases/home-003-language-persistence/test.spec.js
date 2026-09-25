const { test, expect } = require('@playwright/test');

test('HOME-003: 切换语言后刷新保持', async ({ page }, testInfo) => {
    let englishOption;
    await test.step('准备中文首页', async () => {
        await page.goto('/?lang=zh', { waitUntil: 'domcontentloaded' });
        if (testInfo.project.name === 'mobile') {
            const menu = page.getByTestId('navbar-mobile-menu-button');
            await expect(menu).toHaveCount(1);
            await menu.click();
            const mobileMenu = page.getByTestId('navbar-mobile-menu');
            await expect(mobileMenu).toHaveCount(1);
            englishOption = mobileMenu.getByTestId('language-option-en');
        } else {
            englishOption = page.getByTestId('language-option-en');
        }
        await expect(englishOption).toHaveCount(1);
    });
    await test.step('切换英文', async () => {
        await englishOption.click();
        await expect(page).toHaveURL(/\?lang=en$/);
        await expect(page.getByTestId('home-title')).toContainText('Texas Hold');
        if (testInfo.project.name === 'desktop') {
            await expect(englishOption).toHaveAttribute('aria-pressed', 'true');
        }
    });
    await test.step('刷新并断言语言保持', async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        if (testInfo.project.name === 'mobile') {
            const menu = page.getByTestId('navbar-mobile-menu-button');
            await expect(menu).toHaveCount(1);
            await menu.click();
            const mobileMenu = page.getByTestId('navbar-mobile-menu');
            await expect(mobileMenu).toHaveCount(1);
            const persistedEnglish = mobileMenu.getByTestId('language-option-en');
            await expect(persistedEnglish).toHaveCount(1);
            await expect(persistedEnglish).toHaveAttribute('aria-pressed', 'true');
        } else {
            const persistedEnglish = page.getByTestId('language-option-en');
            await expect(persistedEnglish).toHaveCount(1);
            await expect(persistedEnglish).toHaveAttribute('aria-pressed', 'true');
        }
        await expect(page.getByTestId('home-title')).toContainText('Texas Hold');
    });
});
