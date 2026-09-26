import { test, expect } from '@playwright/test';

test('GLOSSARY-007: 字母索引跳转后返回顶部', async ({ page }) => {
    await test.step('准备中文术语表', async () => {
        await page.goto('/glossary?lang=zh', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('glossary-header')).toHaveCount(1);
        await expect(page.getByTestId('glossary-header')).toBeVisible();
    });
    await test.step('点击 H 并确认对应词条进入视口', async () => {
        const letter = page.getByTestId('glossary-letter-H');
        await expect(letter).toHaveCount(1);
        await expect(letter).toBeEnabled();
        await letter.click();
        await expect(letter).toHaveAttribute('aria-current', 'true');
        await expect(page.getByTestId('glossary-page')).toHaveAttribute('data-index-navigation-ready', 'true');
        const term = page.getByTestId('glossary-term-hanleigenzhu');
        await expect(term).toHaveCount(1);
        await expect(term).toBeInViewport();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
    });
    await test.step('返回顶部后标题恢复可见', async () => {
        const top = page.getByTestId('glossary-to-top-button');
        await expect(top).toHaveCount(1);
        await top.click();
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
        await expect(page.getByTestId('glossary-header')).toBeInViewport();
        await expect(top).toHaveCount(0);
    });
});
