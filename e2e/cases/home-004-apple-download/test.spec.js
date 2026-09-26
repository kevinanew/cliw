const { test, expect } = require('@playwright/test');

test('HOME-004: Apple 下载弹窗关闭、重开并发起商店导航', async ({ page }) => {
    const trigger = page.getByTestId('ios-download-trigger');
    const modal = page.getByTestId('ios-download-modal');
    const close = page.getByTestId('ios-download-modal-close');
    const storeLink = page.getByTestId('ios-download-modal-link');

    await test.step('打开首页及 Apple 下载弹窗', async () => {
        await page.goto('/?lang=zh', { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId('home-title')).toHaveCount(1);
        await expect(trigger).toHaveCount(1);
        await expect(trigger).toBeVisible();
        await trigger.click();
        await expect(modal).toHaveCount(1);
        await expect(modal).toBeVisible();
        await expect(modal).toHaveAttribute('role', 'dialog');
        await expect(modal).toHaveAttribute('aria-modal', 'true');
        const message = page.getByTestId('ios-download-modal-content');
        await expect(message).toHaveCount(1);
        await expect(message).toContainText('中国大陆地区暂时无法下载');
    });

    await test.step('关闭按钮及 Escape 均能关闭弹窗', async () => {
        await expect(close).toHaveCount(1);
        await close.click();
        await expect(modal).toBeHidden();
        await expect(trigger).toBeEnabled();

        await trigger.click();
        await expect(modal).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(modal).toBeHidden();
        await expect(trigger).toBeEnabled();
    });

    await test.step('再次打开并点击对应应用的商店入口', async () => {
        await trigger.click();
        await expect(modal).toBeVisible();
        await expect(storeLink).toHaveCount(1);
        await expect(storeLink).toBeVisible();
        const destination = new URL(await storeLink.getAttribute('href'));
        expect(destination.protocol).toBe('https:');
        expect(destination.hostname).toBe('apps.apple.com');
        expect(destination.pathname.endsWith('/id1394482339')).toBe(true);

        // 只替换第三方商店的响应，真实点击与导航请求仍由被测站点发起。
        // 手机商店可能尝试唤起原生应用，不能要求 CI 浏览器完成系统商店流程。
        await page.route(destination.href, (route) => route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html lang="zh"><title>商店导航测试接收页</title></html>',
        }));
        const navigationRequest = page.waitForRequest(
            (request) => request.isNavigationRequest() && request.url() === destination.href,
        );
        await Promise.all([
            page.waitForURL(destination.href, { waitUntil: 'domcontentloaded' }),
            storeLink.click(),
        ]);
        expect((await navigationRequest).frame()).toBe(page.mainFrame());
    });
});
