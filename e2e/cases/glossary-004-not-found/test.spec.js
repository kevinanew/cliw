const { test, expect } = require('@playwright/test');

test('GLOSSARY-004: 无效术语显示返回入口', async ({ page }) => {
    await test.step('打开不存在的英文术语', async () => {
        await page.goto('/glossary/en/does-not-exist-999?lang=en');
    });
    await test.step('断言错误反馈', async () => {
        const message = page.getByTestId('definition-not-found');
        await expect(message).toHaveCount(1);
        await expect(message).toContainText('Term not found');
        const back = page.getByTestId('definition-go-back');
        await expect(back).toHaveCount(1);
    });
    await test.step('返回术语列表', async () => {
        await page.getByTestId('definition-go-back').click();
        await expect(page).toHaveURL(/\/glossary\?lang=en$/);
        await expect(page.getByTestId('glossary-header')).toHaveCount(1);
    });
});
