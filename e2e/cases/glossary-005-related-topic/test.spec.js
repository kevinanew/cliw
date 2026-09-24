const { test, expect } = require('@playwright/test');

test('GLOSSARY-005: 相关主题入口', async ({ page }) => {
    await test.step('准备 A-Game 详情', async () => {
        await page.goto('/glossary/en/agame?lang=en');
        await expect(page.getByTestId('definition-term-name')).toHaveText('A-Game');
        await expect(page.getByTestId('related-topics')).toHaveCount(1);
    });
    await test.step('打开 Z-game 相关主题', async () => {
        // ISSUE-003: 相关主题链接缺少 ID；建议 ID 尚未部署。
        const related = page.getByTestId('related-topics').getByTestId('definition-related-topic-zgame');
        await expect(related, 'ISSUE-003：相关主题 Z-game 链接缺少测试定位契约').toHaveCount(1);
        await related.click();
    });
    await test.step('断言相关术语详情', async () => {
        await expect(page).toHaveURL(/\/glossary\/en\/zgame\?lang=en$/);
        await expect(page.getByTestId('definition-term-name')).toHaveText('Z-game');
    });
});
