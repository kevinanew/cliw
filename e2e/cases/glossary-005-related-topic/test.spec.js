const { test, expect } = require('@playwright/test');

test('GLOSSARY-005: 相关主题入口', async ({ page }) => {
    await test.step('准备 A-Game 详情', async () => {
        await page.goto('/glossary/en/agame?lang=en', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('definition-term-name')).toHaveText('A-Game');
        await expect(page.getByTestId('related-topics')).toHaveCount(1);
    });
    await test.step('打开 Z-game 相关主题', async () => {
        const related = page.getByTestId('related-topics').getByRole('link', { name: 'Z-game' });
        await expect(related).toHaveCount(1);
        await related.click();
    });
    await test.step('断言相关术语详情', async () => {
        await expect(page).toHaveURL(/\/glossary\/en\/zgame\?lang=en$/);
        await expect(page.getByTestId('definition-term-name')).toHaveText('Z-game');
    });
});
