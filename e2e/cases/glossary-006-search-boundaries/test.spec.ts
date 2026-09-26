import { test, expect } from '@playwright/test';

test('GLOSSARY-006: 搜索忽略英文大小写与首尾空格，纯空格恢复全集', async ({ page }, testInfo) => {
    const input = page.getByTestId(
        testInfo.project.name === 'mobile' ? 'glossary-mobile-search-input' : 'glossary-search-input',
    );
    const names = page.getByTestId(/^glossary-term-name-/);
    const count = page.getByTestId('glossary-count');
    let allNames: string[];
    let initialCount: string;
    let matchedNames: string[];
    let matchedCount: string;
    await test.step('记录完整英文列表', async () => {
        await page.goto('/glossary?lang=en', { waitUntil: 'domcontentloaded' });
        await expect(input).toHaveCount(1);
        await expect(count).toHaveCount(1);
        await expect(page.getByTestId('glossary-term-agame')).toHaveCount(1);
        await expect(count).toContainText('terms ·');
        allNames = await names.allTextContents();
        initialCount = await count.innerText();
        expect(allNames.length).toBeGreaterThan(1);
    });
    await test.step('建立小写查询的结果基准', async () => {
        await input.fill('bluff');
        await expect(page.getByTestId('glossary-term-acehigh')).toHaveCount(0);
        await expect(page.getByTestId('glossary-term-bluff')).toHaveCount(1);
        await expect(count).toContainText('matched');
        matchedNames = await names.allTextContents();
        matchedCount = await count.innerText();
        expect(matchedNames.length).toBeGreaterThan(0);
        expect(matchedNames.length).toBeLessThan(allNames.length);
    });
    await test.step('大写并带空格时结果与计数一致', async () => {
        await input.fill('  BLUFF  ');
        await expect(page.getByTestId('glossary-page')).toHaveAttribute('data-searching', 'true');
        await expect(names).toHaveText(matchedNames);
        await expect(count).toHaveText(matchedCount);
    });
    await test.step('纯空格查询恢复所有词条', async () => {
        await input.fill('   ');
        await expect(names).toHaveText(allNames);
        await expect(count).toHaveText(initialCount);
        await expect(page.getByTestId('glossary-page')).toHaveAttribute('data-searching', 'false');
        await expect(page.getByTestId('glossary-no-results')).toHaveCount(0);
    });
});
