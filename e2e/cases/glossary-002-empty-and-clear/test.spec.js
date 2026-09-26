const { test, expect } = require('@playwright/test');

test('GLOSSARY-002: 无结果后清空搜索', async ({ page }, testInfo) => {
    const inputId = testInfo.project.name === 'mobile' ? 'glossary-mobile-search-input' : 'glossary-search-input';
    const count = page.getByTestId('glossary-count');
    let initialCount;
    let totalTerms;
    let letterIds;

    await test.step('准备英文术语表', async () => {
        await page.goto('/glossary?lang=en', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId(inputId)).toHaveCount(1);
        await expect(count).toHaveCount(1);
        await expect(count).toContainText('terms ·');
        initialCount = await count.innerText();
        totalTerms = Number(initialCount.split(' terms')[0]);
        expect(Number.isInteger(totalTerms)).toBe(true);
        expect(totalTerms).toBeGreaterThan(1);
        await expect(page.getByTestId('glossary-term-agame')).toHaveCount(1);
        await expect(page.getByTestId('glossary-term-acehigh')).toHaveCount(1);
        letterIds = await page.getByTestId(/^glossary-letter-/).evaluateAll(
            (buttons) => buttons.map((button) => button.dataset.testid),
        );
        expect(letterIds.length).toBeGreaterThan(1);
        for (const letterId of letterIds) {
            const letter = page.getByTestId(letterId);
            await expect(letter).toHaveCount(1);
            await expect(letter).toBeEnabled();
        }
    });
    await test.step('输入不存在的术语', async () => {
        await page.getByTestId(inputId).fill('zzznevermatch999');
        await expect(page.getByTestId('glossary-no-results')).toHaveCount(1);
        await expect(page.getByTestId('glossary-no-results')).toBeVisible();
        await expect(count).toHaveText(`0 of ${totalTerms} matched`);
        await expect(page.getByTestId(/^glossary-term-name-/)).toHaveCount(0);
        for (const letterId of letterIds) {
            await expect(page.getByTestId(letterId)).toBeDisabled();
        }
    });
    await test.step('清空搜索并恢复列表', async () => {
        const clear = page.getByTestId('glossary-empty-clear');
        await expect(clear).toHaveCount(1);
        await clear.click();
        await expect(page.getByTestId(inputId)).toHaveValue('');
        await expect(page.getByTestId('glossary-term-agame')).toHaveCount(1);
        await expect(page.getByTestId('glossary-term-agame')).toBeVisible();
        await expect(page.getByTestId('glossary-term-acehigh')).toHaveCount(1);
        await expect(page.getByTestId('glossary-no-results')).toHaveCount(0);
        await expect(count).toHaveText(initialCount);
        for (const letterId of letterIds) {
            const letter = page.getByTestId(letterId);
            await expect(letter).toHaveCount(1);
            await expect(letter).toBeEnabled();
        }
    });
});
