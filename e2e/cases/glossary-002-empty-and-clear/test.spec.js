const { test, expect } = require('@playwright/test');

test('GLOSSARY-002: 无结果后清空搜索', async ({ page }, testInfo) => {
    const inputId = testInfo.project.name === 'mobile' ? 'glossary-mobile-search-input' : 'glossary-search-input';
    await test.step('准备英文术语表', async () => {
        await page.goto('/glossary?lang=en');
        await expect(page.getByTestId(inputId)).toHaveCount(1);
    });
    await test.step('输入不存在的术语', async () => {
        await page.getByTestId(inputId).fill('zzznevermatch999');
        await expect(page.getByTestId('glossary-no-results')).toHaveCount(1);
        await expect(page.getByTestId('glossary-count')).toContainText('0 of');
    });
    await test.step('清空搜索并恢复列表', async () => {
        const clear = page.getByTestId('glossary-empty-clear');
        await expect(clear).toHaveCount(1);
        await clear.click();
        await expect(page.getByTestId(inputId)).toHaveValue('');
        await expect(page.getByTestId('glossary-term-agame')).toHaveCount(1);
        await expect(page.getByTestId('glossary-no-results')).toHaveCount(0);
    });
});
