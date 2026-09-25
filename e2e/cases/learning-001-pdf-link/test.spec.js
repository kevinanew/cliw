const { test, expect } = require('@playwright/test');

test('LEARNING-001: 学习资料 PDF 下载入口', async ({ page, request }) => {
    await test.step('准备英文学习页', async () => {
        await page.goto('/learning?lang=en');
        await expect(page.getByTestId('learning-page')).toHaveCount(1);
    });
    await test.step('检查下载入口', async () => {
        const link = page.getByTestId('learning-download-link');
        await expect(link).toHaveCount(1);
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', /\/book\/no-limit-holdem-advanced-en\.pdf$/);
    });
    await test.step('检查资源响应类型', async () => {
        const response = await request.get('/book/no-limit-holdem-advanced-en.pdf');
        expect(response.status()).toBe(200);
        expect(response.headers()['content-type']).toContain('application/pdf');
    });
});
