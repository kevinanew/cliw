#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/**
 * 端到端测试：通过元素截图验证首页二维码是否可见（桌面端）
 */

const ENV = process.env.NODE_ENV || 'staging';
const URLS = {
    production: 'https://www.goplay.appcookies.com/',
    staging: require('./staging-url').stagingUrl(),
    development: 'http://localhost:8080/',
};

const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const QR_SELECTOR = '[data-testid="home-qrcode"]';
const MIN_DARK = 100;
const MIN_SCREENSHOT_BYTES = 800;

function analyzeDarkPixelCount(darkPixels, minDark = MIN_DARK) {
    return {
        ok: darkPixels >= minDark,
        darkPixels,
        reason: darkPixels >= minDark ? null : `二维码截图中的深色像素过少 (${darkPixels})`,
    };
}

function isScreenshotLargeEnough(byteLength, minimumBytes = MIN_SCREENSHOT_BYTES) {
    return byteLength >= minimumBytes;
}

async function analyzeQrScreenshot(element) {
    const svg = element.matches('svg') ? element : element.querySelector('svg');
    if (!svg) {
        return { ok: false, reason: '未找到二维码 SVG 元素' };
    }

    const size = 120;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    const svgData = new XMLSerializer().serializeToString(svg);
    // The deployment CSP permits data: images but intentionally disallows blob: images.
    const imageDataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;

    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, size, size);
            const { data } = ctx.getImageData(0, 0, size, size);
            let darkPixels = 0;

            for (let i = 0; i < data.length; i += 4) {
                const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
                if (brightness < 200) {
                    darkPixels += 1;
                }
            }

            resolve({ darkPixels });
        };
        img.onerror = () => {
            resolve({ ok: false, reason: '无法将二维码 SVG 渲染到画布上' });
        };
        img.src = imageDataUrl;
    });
}

async function run(dependencies = {}) {
    const browserType = dependencies.browserType || chromium;
    const logger = dependencies.logger || console;
    const fileSystem = dependencies.fs || fs;
    const env = dependencies.env || ENV;
    const targetUrl = dependencies.startUrl || URLS[env];

    logger.log(`🚀 [E2E] 正在验证 [${env}] 环境下的首页二维码...`);
    logger.log(`🔗 目标 URL: ${targetUrl}`);

    const browser = await browserType.launch();
    let success = false;

    try {
        const page = await browser.newPage({ viewport: DESKTOP_VIEWPORT });
        const indexResponsePromise = page
            .waitForResponse((resp) => /\/apk\/index\.json(?:\?|$)/.test(resp.url()) && resp.ok(), {
                timeout: 30000,
            })
            .catch(() => null);

        await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });

        await page.waitForSelector('[data-testid="home-title"]', { timeout: 30000 });

        const indexResponse = await indexResponsePromise;
        if (!indexResponse) {
            throw new Error('apk/index.json 请求未在超时内成功完成。');
        }

        const qrCode = page.locator(QR_SELECTOR).first();
        await qrCode.waitFor({ state: 'visible', timeout: 30000 });

        const screenshotAnalysis = await qrCode.evaluate(analyzeQrScreenshot);
        const analysis =
            screenshotAnalysis.ok === false ? screenshotAnalysis : analyzeDarkPixelCount(screenshotAnalysis.darkPixels);
        if (!analysis.ok) {
            logger.error(`❌ [失败] ${analysis.reason}`);
        } else {
            logger.log(`✅ [正常] 二维码已成功渲染，包含 ${analysis.darkPixels} 个深色像素`);
        }

        const screenshotsDir = path.join(__dirname, 'screenshots');
        fileSystem.mkdirSync(screenshotsDir, { recursive: true });
        const screenshotPath = path.join(screenshotsDir, `home-qrcode-${env}.png`);
        const screenshotBuffer = await qrCode.screenshot({ path: screenshotPath });

        if (!isScreenshotLargeEnough(screenshotBuffer.length)) {
            logger.error(`❌ [失败] 二维码截图文件过小 (${screenshotBuffer.length} 字节)`);
        } else {
            logger.log(`📸 [截图成功] 截图已保存至 ${screenshotPath} (${screenshotBuffer.length} 字节)`);
        }

        success = analysis.ok && isScreenshotLargeEnough(screenshotBuffer.length);

        if (success) {
            logger.log('✅ [成功] 首页二维码正常存在且可见');
        }
    } catch (e) {
        logger.error(`❌ [错误] ${targetUrl}: ${e.message}`);
    } finally {
        await browser.close();
    }

    return success ? 0 : 1;
}

module.exports = {
    URLS,
    DESKTOP_VIEWPORT,
    QR_SELECTOR,
    MIN_DARK,
    MIN_SCREENSHOT_BYTES,
    analyzeDarkPixelCount,
    isScreenshotLargeEnough,
    analyzeQrScreenshot,
    run,
};

if (require.main === module) {
    run()
        .then((status) => process.exit(status))
        .catch((err) => {
            console.error('致命错误:', err);
            process.exit(1);
        });
}
