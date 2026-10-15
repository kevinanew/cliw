import { defineConfig } from '@playwright/test';

// 对应原 Backstop misMatchThreshold 0.3（允许 0.3% 像素差异）
const MAX_DIFF_PIXEL_RATIO = 0.003;

// Playwright 的截图比较会读取此 timeout；独立配置对象保留原有截图超时，
// 避免将普通断言也延长到 60 秒（当前配置类型未列出截图专属 timeout）。
const screenshotExpectations = {
    maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    timeout: 60000,
} as const;

export default defineConfig({
    testDir: '.',
    testMatch: ['visual.spec.ts', 'home-entrance.spec.ts', 'animations.spec.ts', 'helpers/motion.test.ts'],
    fullyParallel: true,
    // CI 服务器内存足够时，通过 VISUAL_WORKERS 并行运行截图场景。
    // 本地默认只启用一个 worker，避免占用过多内存。
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
    // 固定路径：始终在 Linux Docker / CI 中跑，无需带 platform / project 后缀
    snapshotPathTemplate: 'snapshots/{arg}{ext}',
    expect: {
        toHaveScreenshot: screenshotExpectations,
        toMatchSnapshot: {
            maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
        },
    },
    use: {
        baseURL: process.env.VISUAL_BASE_URL || 'http://127.0.0.1:8080',
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
        trace: process.env.CI ? 'off' : 'retain-on-failure',
        video: 'off',
    },
});
