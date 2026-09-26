const { test, expect } = require('@playwright/test');

test('HOME-005: 从 Apple 弹窗进入下载教程并返回', async ({ page }) => {
    await test.step('打开中文首页的 Apple 下载弹窗', async () => {
        await page.goto('/?lang=zh', { waitUntil: 'domcontentloaded' });
        const trigger = page.getByTestId('ios-download-trigger');
        await expect(trigger).toHaveCount(1);
        await trigger.click();
        await expect(page.getByTestId('ios-download-modal')).toHaveCount(1);
        await expect(page.getByTestId('ios-download-modal')).toBeVisible();
    });

    await test.step('点击中国大陆下载教程入口', async () => {
        // 待网站源码补齐此标识；缺失时明确失败，不改用链接文字或 CSS 绕过。
        const tutorial = page.getByTestId('ios-download-modal-tutorial-link');
        await expect(tutorial, 'ISSUE-002：Apple 弹窗教程入口缺少唯一 test ID，需在网站源码补齐').toHaveCount(1);
        await expect(tutorial).toHaveAttribute('href', '/tutorial');
        await tutorial.click();
        await expect(page).toHaveURL((url) => url.pathname === '/tutorial' && url.searchParams.get('lang') === 'zh');
        const firstStep = page.getByTestId('tutorial-step-one');
        await expect(firstStep).toHaveCount(1);
        await expect(firstStep).toBeVisible();
        await expect(firstStep).toContainText('AppleID');
    });

    await test.step('浏览器返回首页后仍能重新打开弹窗', async () => {
        await page.goBack({ waitUntil: 'domcontentloaded' });
        await expect(page).toHaveURL((url) => url.pathname === '/' && url.searchParams.get('lang') === 'zh');
        const title = page.getByTestId('home-title');
        await expect(title).toHaveCount(1);
        await expect(title).toBeVisible();
        const trigger = page.getByTestId('ios-download-trigger');
        await expect(trigger).toHaveCount(1);
        await trigger.click();
        await expect(page.getByTestId('ios-download-modal')).toBeVisible();
    });
});
