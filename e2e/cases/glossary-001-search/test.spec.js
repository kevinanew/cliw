const { test, expect } = require('@playwright/test');

test('GLOSSARY-001: 搜索术语命中', async ({ page }, testInfo) => {
    const count = page.getByTestId('glossary-count');
    const matchingTerm = page.getByTestId('glossary-term-agame');
    const unrelatedTerm = page.getByTestId('glossary-term-acehigh');
    let totalTerms;
    let letterIds;

    await test.step('准备英文术语表', async () => {
        await page.goto('/glossary?lang=en', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('glossary-header')).toHaveCount(1);
        await expect(count).toHaveCount(1);
        await expect(count).toContainText('terms ·');
        totalTerms = Number((await count.innerText()).split(' terms')[0]);
        expect(Number.isInteger(totalTerms)).toBe(true);
        expect(totalTerms).toBeGreaterThan(1);
        await expect(matchingTerm).toHaveCount(1);
        // 先确认无关词条已挂载，避免把懒加载造成的缺席误认为搜索过滤成功。
        await expect(unrelatedTerm).toHaveCount(1);
        letterIds = await page.getByTestId(/^glossary-letter-/).evaluateAll(
            (buttons) => buttons.map((button) => button.dataset.testid),
        );
        expect(letterIds).toContain('glossary-letter-A');
        expect(letterIds.length).toBeGreaterThan(1);
    });
    await test.step('输入已知术语', async () => {
        const input = page.getByTestId(testInfo.project.name === 'mobile' ? 'glossary-mobile-search-input' : 'glossary-search-input');
        await expect(input).toHaveCount(1);
        await input.fill('A-Game');
    });
    await test.step('断言匹配条目及计数', async () => {
        await expect(matchingTerm).toHaveCount(1);
        await expect(matchingTerm).toBeVisible();
        await expect(matchingTerm).toHaveText('A-Game');
        await expect(unrelatedTerm).toHaveCount(0);
        await expect(page.getByTestId(/^glossary-term-name-/)).toHaveCount(1);
        await expect(count).toHaveText(`1 of ${totalTerms} matched`);
    });
    await test.step('只有命中字母索引可以操作', async () => {
        for (const letterId of letterIds) {
            const letter = page.getByTestId(letterId);
            await expect(letter).toHaveCount(1);
            if (letterId === 'glossary-letter-A') {
                await expect(letter).toBeEnabled();
            } else {
                await expect(letter).toBeDisabled();
            }
        }
    });
});
