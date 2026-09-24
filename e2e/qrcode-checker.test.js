const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    MIN_DARK,
    MIN_SCREENSHOT_BYTES,
    analyzeDarkPixelCount,
    isScreenshotLargeEnough,
    analyzeQrScreenshot,
    run,
} = require('./qrcode-checker');

function createLogger() {
    const logs = [];
    const errors = [];
    return { logs, errors, log: (message) => logs.push(message), error: (message) => errors.push(message) };
}

function createBrowser({
    analysis = { darkPixels: MIN_DARK },
    screenshotBytes = MIN_SCREENSHOT_BYTES,
    indexResponse = {},
    waitForResponse,
    goto,
    failure,
} = {}) {
    let closeCalls = 0;
    const locator = {
        waitFor: async () => {},
        evaluate: async (fn) => {
            assert.equal(typeof fn, 'function');
            if (failure === 'evaluate') throw new Error('像素读取失败');
            return analysis;
        },
        screenshot: async () => Buffer.alloc(screenshotBytes),
    };
    const page = {
        waitForResponse: waitForResponse || (() => Promise.resolve(indexResponse)),
        goto: goto || (async () => {}),
        waitForSelector: async () => {},
        locator: (selector) => {
            assert.equal(selector, '[data-testid="home-qrcode"]');
            return { first: () => locator };
        },
    };
    return {
        browserType: {
            launch: async () => ({
                newPage: async () => page,
                close: async () => {
                    closeCalls += 1;
                },
            }),
        },
        closeCalls: () => closeCalls,
    };
}

const fakeFs = { mkdirSync: () => {} };

describe('qrcode-checker thresholds', () => {
    it('深色像素恰好达到 MIN_DARK 时通过', () => {
        assert.deepEqual(analyzeDarkPixelCount(MIN_DARK), { ok: true, darkPixels: MIN_DARK, reason: null });
    });

    it('深色像素少于 MIN_DARK 时失败', () => {
        assert.deepEqual(analyzeDarkPixelCount(MIN_DARK - 1), {
            ok: false,
            darkPixels: MIN_DARK - 1,
            reason: `二维码截图中的深色像素过少 (${MIN_DARK - 1})`,
        });
    });

    it('截图字节数恰好达到下限时通过，少一个字节时失败', () => {
        assert.equal(isScreenshotLargeEnough(MIN_SCREENSHOT_BYTES), true);
        assert.equal(isScreenshotLargeEnough(MIN_SCREENSHOT_BYTES - 1), false);
    });

    it('SVG 缺失时返回明确失败原因', async () => {
        const element = { matches: () => false, querySelector: () => null };
        assert.deepEqual(await analyzeQrScreenshot(element), { ok: false, reason: '未找到二维码 SVG 元素' });
    });

    it('SVG data 图片加载失败时返回明确失败原因', async () => {
        const originals = {
            document: global.document,
            XMLSerializer: global.XMLSerializer,
            Image: global.Image,
        };
        global.document = { createElement: () => ({ getContext: () => ({}) }) };
        global.XMLSerializer = class {
            serializeToString() {
                return '<svg />';
            }
        };
        global.Image = class {
            set src(value) {
                assert.match(value, /^data:image\/svg\+xml;base64,/);
                this.onerror();
            }
        };
        try {
            const svg = { matches: () => true };
            assert.deepEqual(await analyzeQrScreenshot(svg), {
                ok: false,
                reason: '无法将二维码 SVG 渲染到画布上',
            });
        } finally {
            Object.assign(global, originals);
        }
    });
});

describe('qrcode-checker orchestration', () => {
    it('apk/index.json 未在超时内成功返回时失败并关闭 browser', async () => {
        const browser = createBrowser({ indexResponse: null });
        const logger = createLogger();
        const status = await run({ ...browser, fs: fakeFs, logger, startUrl: 'https://test/' });
        assert.equal(status, 1);
        assert.equal(browser.closeCalls(), 1);
        assert.deepEqual(logger.errors, ['❌ [错误] https://test/: apk/index.json 请求未在超时内成功完成。']);
    });

    it('响应等待先拒绝、导航稍后完成时仍记录错误并关闭 browser', async () => {
        let finishNavigation;
        const navigation = new Promise((resolve) => {
            finishNavigation = resolve;
        });
        const browser = createBrowser({
            waitForResponse: () => Promise.reject(new Error('响应等待超时')),
            goto: () => navigation,
        });
        const logger = createLogger();
        const runPromise = run({ ...browser, fs: fakeFs, logger, startUrl: 'https://test/' });

        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(browser.closeCalls(), 0);
        finishNavigation();

        const status = await runPromise;
        assert.equal(status, 1);
        assert.equal(browser.closeCalls(), 1);
        assert.deepEqual(logger.errors, ['❌ [错误] https://test/: apk/index.json 请求未在超时内成功完成。']);
    });

    it('像素分析通过但截图过小时整体失败', async () => {
        const browser = createBrowser({ screenshotBytes: MIN_SCREENSHOT_BYTES - 1 });
        const logger = createLogger();
        const status = await run({ ...browser, fs: fakeFs, logger, startUrl: 'https://test/' });
        assert.equal(status, 1);
        assert.equal(browser.closeCalls(), 1);
        assert.match(logger.errors[0], /二维码截图文件过小 \(799 字节\)/);
    });

    it('实际编排使用深色像素阈值，少于 MIN_DARK 时整体失败', async () => {
        const browser = createBrowser({ analysis: { darkPixels: MIN_DARK - 1 } });
        const logger = createLogger();
        const status = await run({ ...browser, fs: fakeFs, logger, startUrl: 'https://test/' });
        assert.equal(status, 1);
        assert.equal(browser.closeCalls(), 1);
        assert.equal(logger.errors[0], `❌ [失败] 二维码截图中的深色像素过少 (${MIN_DARK - 1})`);
    });

    it('两个条件均通过时返回成功退出码，边界大小也被接受', async () => {
        const browser = createBrowser();
        const status = await run({ ...browser, fs: fakeFs, logger: createLogger(), startUrl: 'https://test/' });
        assert.equal(status, 0);
        assert.equal(browser.closeCalls(), 1);
    });

    it('执行中异常时仍关闭 browser 并返回失败退出码', async () => {
        const browser = createBrowser({ failure: 'evaluate' });
        const logger = createLogger();
        const status = await run({ ...browser, fs: fakeFs, logger, startUrl: 'https://test/' });
        assert.equal(status, 1);
        assert.equal(browser.closeCalls(), 1);
        assert.match(logger.errors[0], /像素读取失败/);
    });

    it('页面创建异常时也关闭 browser 并返回失败退出码', async () => {
        let closeCalls = 0;
        const logger = createLogger();
        const browserType = {
            launch: async () => ({
                newPage: async () => {
                    throw new Error('页面创建失败');
                },
                close: async () => {
                    closeCalls += 1;
                },
            }),
        };
        const status = await run({ browserType, fs: fakeFs, logger, startUrl: 'https://test/' });
        assert.equal(status, 1);
        assert.equal(closeCalls, 1);
        assert.match(logger.errors[0], /页面创建失败/);
    });
});
