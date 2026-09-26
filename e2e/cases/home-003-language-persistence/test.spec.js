const { test, expect } = require('@playwright/test');

// 默认语言与选择的英文不同，防止偏好丢失后浏览器默认英文造成误通过。
test.use({ locale: 'zh-CN' });

test('HOME-003: 切换英文后刷新及无参数访问保持', async ({ page, context }, testInfo) => {
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
        await expect.poll(async () => {
            const cookies = await context.cookies(page.url());
            return cookies.find((cookie) => cookie.name === 'language')?.value;
        }).toBe('en');
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

    for (const destination of [
        { path: '/', name: '首页', contentId: 'home-title', text: 'Texas Hold' },
        {
            path: '/learning',
            name: '学习页',
            contentId: 'learning-page',
            text: 'Curated Texas Hold\'em books available for download.',
        },
    ]) {
        await test.step(`不带语言参数重新打开${destination.name}，仍从 Cookie 恢复英文`, async () => {
            // 直接加载没有 lang 的地址，不能用已携带 lang 的站内链接替代。
            await page.goto(destination.path, { waitUntil: 'domcontentloaded' });
            const content = page.getByTestId(destination.contentId);
            await expect(content).toHaveCount(1);
            await expect(content).toBeVisible();
            await expect(content).toContainText(destination.text);

            let languageControls = page;
            if (testInfo.project.name === 'mobile') {
                const menuButton = page.getByTestId('navbar-mobile-menu-button');
                await expect(menuButton).toHaveCount(1);
                await menuButton.click();
                languageControls = page.getByTestId('navbar-mobile-menu');
                await expect(languageControls).toHaveCount(1);
                await expect(languageControls).toBeVisible();
            }
            for (const locale of ['zh', 'zh-TW', 'en']) {
                const option = languageControls.getByTestId(`language-option-${locale}`);
                await expect(option).toHaveCount(1);
                await expect(option).toHaveAttribute('aria-pressed', String(locale === 'en'));
            }
        });
    }
});
