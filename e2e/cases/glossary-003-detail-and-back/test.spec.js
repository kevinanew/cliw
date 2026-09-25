const { test, expect } = require('@playwright/test');

test('GLOSSARY-003: 术语详情与返回列表', async ({ page }) => {
    await test.step('准备英文术语表', async () => {
        await page.goto('/glossary?lang=en', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('glossary-term-agame')).toHaveCount(1);
    });
    await test.step('打开 A-Game 详情', async () => {
        await page.getByTestId('glossary-term-agame').click();
        await expect(page).toHaveURL(/\/glossary\/en\/agame\?lang=en$/);
        await expect(page.getByTestId('definition-term-name')).toHaveCount(1);
        await expect(page.getByTestId('definition-term-name')).toHaveText('A-Game');
        await expect(page.getByTestId('definition-body')).toContainText('best');
    });
    await test.step('返回列表', async () => {
        const back = page.getByTestId('definition-go-back');
        await expect(back).toHaveCount(1);
        await back.click();
        await expect(page).toHaveURL(/\/glossary\?lang=en$/);
        await expect(page.getByTestId('glossary-term-agame')).toHaveCount(1);
    });
});
