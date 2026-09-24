const { defineConfig } = require('@playwright/test');
const { requireStagingUrl } = require('../e2e/staging-url');

// 对应原 Backstop misMatchThreshold 0.3（允许 0.3% 像素差异）
const MAX_DIFF_PIXEL_RATIO = 0.003;

module.exports = defineConfig({
    testDir: '.',
    testMatch: 'visual.spec.js',
    fullyParallel: true,
    // 桌面长页全页截图会占用大量 Chromium 渲染内存；Docker 中并行两个
    // worker 会随机触发 renderer crash。默认串行，资源充足时仍可显式提高。
    workers: Number(process.env.VISUAL_WORKERS || 1),
    forbidOnly: Boolean(process.env.CI) || Boolean(process.env.WOODPECKER_CI),
    // 截图类偶发失败自动重试一次（可用 VISUAL_RETRIES=0 关闭）
    retries: Number(process.env.VISUAL_RETRIES ?? 1),
    // 整页截图（尤其 desktop）需要更长时间做连续帧稳定比对
    timeout: 120000,
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
        ['./flake-metrics-reporter.js', { outputFile: 'visual-retry-metrics.json' }],
    ],
    outputDir: 'test-results',
    // 基准图在固定 Playwright Linux 镜像中生成，无需带 platform / project 后缀。
    snapshotPathTemplate: 'snapshots/{arg}{ext}',
    expect: {
        toHaveScreenshot: {
            maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
            animations: 'disabled',
            caret: 'hide',
            scale: 'css',
            timeout: 60000,
        },
        toMatchSnapshot: {
            maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        },
    },
    use: {
        baseURL: requireStagingUrl(),
        browserName: 'chromium',
        headless: true,
        deviceScaleFactor: 1,
        locale: 'en-US',
        colorScheme: 'light',
        // 必须设置：Playwright 动作默认不限时，卡住的动作会挂到整个测试超时
        actionTimeout: 15000,
        launchOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                // Docker 默认 /dev/shm 只有 64M，Chromium 渲染大页面会随机崩溃
                '--disable-dev-shm-usage',
                // 避免 Linux Docker 默认 locale 变成 en-US@posix
                '--lang=en-US',
            ],
        },
        screenshot: 'off',
        // 失败时保留 trace，playwright show-report 里可逐步回放排查
        trace: 'retain-on-failure',
        video: 'off',
    },
});
