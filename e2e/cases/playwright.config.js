const { defineConfig, devices } = require('@playwright/test');
const { requireStagingUrl } = require('../staging-url');

const baseURL = requireStagingUrl();
const runId = process.env.E2E_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-');
const reportDir = `../reports/${runId}`;

module.exports = defineConfig({
    testDir: '.',
    testMatch: '**/test.spec.js',
    forbidOnly: Boolean(process.env.CI),
    // 各案例使用独立页面，可在 CI 中同时运行四个案例。
    workers: process.env.CI ? 4 : undefined,
    timeout: 45_000,
    expect: { timeout: 10_000 },
    outputDir: `${reportDir}/results`,
    reporter: [
        ['list'],
        ['html', { outputFolder: `${reportDir}/html`, open: 'never' }],
        ['json', { outputFile: `${reportDir}/results.json` }],
    ],
    use: {
        baseURL,
        actionTimeout: 10_000,
        navigationTimeout: 30_000,
        screenshot: 'only-on-failure',
        trace: 'off',
        locale: 'en-US',
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
        { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
    ],
});
