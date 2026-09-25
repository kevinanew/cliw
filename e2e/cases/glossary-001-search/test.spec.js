const { test, expect } = require('@playwright/test');

test('GLOSSARY-001: 搜索术语命中', async ({ page }, testInfo) => {
    await test.step('准备英文术语表', async () => {
        await page.goto('/glossary?lang=en');
        await expect(page.getByTestId('glossary-header')).toHaveCount(1);
    });
    await test.step('输入已知术语', async () => {
        const input = page.getByTestId(testInfo.project.name === 'mobile' ? 'glossary-mobile-search-input' : 'glossary-search-input');
        await expect(input).toHaveCount(1);
        await input.fill('A-Game');
    });
    await test.step('断言匹配条目及计数', async () => {
        await expect(page.getByTestId('glossary-term-agame')).toHaveCount(1);
        await expect(page.getByTestId('glossary-term-agame')).toHaveText('A-Game');
        await expect(page.getByTestId('glossary-count')).toContainText('matched');
    });
});
