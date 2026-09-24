const { describe, it, mock } = require('node:test');
const assert = require('node:assert/strict');

const {
    A11Y_PATHS,
    AXE_TAGS,
    A11Y_NAVIGATION_OPTIONS,
    A11Y_TRANSIENT_ATTEMPTS,
    formatViolation,
    formatViolations,
    countViolationNodes,
    isTransientA11yNavigationError,
    assertAccessibilityWithRetry,
} = require('./accessibility-checker');

describe('accessibility-checker helpers', () => {
    it('A11Y_PATHS 含首页与关键静态页', () => {
        assert.ok(A11Y_PATHS.includes('/'));
        assert.ok(A11Y_PATHS.includes('/glossary'));
        assert.ok(A11Y_PATHS.includes('/glossary/en/bluff'));
        assert.ok(A11Y_PATHS.includes('/learning'));
        assert.ok(A11Y_PATHS.includes('/tutorial'));
        assert.ok(A11Y_PATHS.includes('/h5-tutorial/laiwan-life'));
        assert.ok(A11Y_PATHS.includes('/h5-tutorial/laiwanpai-com'));
    });

    it('AXE_TAGS 覆盖 WCAG 2 / 2.1 A+AA', () => {
        assert.deepEqual(AXE_TAGS, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
    });

    it('导航等待 CSS 与 deferred 脚本，但不等待无障碍扫描不依赖的图片和视频', () => {
        assert.deepEqual(A11Y_NAVIGATION_OPTIONS, { waitUntil: 'domcontentloaded', timeout: 60000 });
    });

    it('只把 page.goto 的已知传输层错误识别为瞬时导航失败', () => {
        assert.equal(
            isTransientA11yNavigationError(new Error('page.goto: net::ERR_TIMED_OUT at https://example.test/')),
            true,
        );
        assert.equal(
            isTransientA11yNavigationError(new Error('page.goto: net::ERR_CONNECTION_RESET at https://example.test/')),
            true,
        );
        assert.equal(
            isTransientA11yNavigationError(new Error('page.waitForSelector: Timeout 30000ms exceeded')),
            false,
        );
        assert.equal(
            isTransientA11yNavigationError(
                new Error(
                    'page.goto: Navigation is interrupted by another navigation to chrome-error://chromewebdata/',
                ),
            ),
            false,
        );
        assert.equal(isTransientA11yNavigationError('page.goto: net::ERR_TIMED_OUT'), false);
    });

    it('瞬时导航失败时关闭旧 context，并使用干净页面重试一次', async () => {
        const pages = [];
        let contextsCreated = 0;
        let contextsClosed = 0;
        const browser = {
            newContext: async () => {
                contextsCreated += 1;
                const page = { contextId: contextsCreated };
                pages.push(page);
                return {
                    newPage: async () => page,
                    close: async () => {
                        contextsClosed += 1;
                    },
                };
            },
        };
        let scans = 0;
        const scan = async (page) => {
            scans += 1;
            if (scans === 1) {
                throw new Error('page.goto: net::ERR_TIMED_OUT at https://example.test/');
            }
            assert.equal(page.contextId, 2);
            return 0;
        };

        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', scan), 0);
        assert.equal(A11Y_TRANSIENT_ATTEMPTS, 2);
        assert.equal(scans, 2);
        assert.equal(contextsCreated, 2);
        assert.equal(contextsClosed, 2);
        assert.notEqual(pages[0], pages[1]);
    });

    it('连续传输失败硬失败，页面或 axe 的确定性失败不重试', async () => {
        let contextsCreated = 0;
        let contextsClosed = 0;
        const browser = {
            newContext: async () => {
                contextsCreated += 1;
                return {
                    newPage: async () => ({}),
                    close: async () => {
                        contextsClosed += 1;
                    },
                };
            },
        };
        let transientScans = 0;
        const alwaysTimesOut = async () => {
            transientScans += 1;
            throw new Error('page.goto: net::ERR_CONNECTION_CLOSED at https://example.test/');
        };

        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', alwaysTimesOut), 1);
        assert.equal(transientScans, 2);
        assert.equal(contextsCreated, 2);
        assert.equal(contextsClosed, 2);

        let deterministicScans = 0;
        const mountFailure = async () => {
            deterministicScans += 1;
            throw new Error('page.waitForSelector: Timeout 30000ms exceeded');
        };
        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', mountFailure), 1);
        assert.equal(deterministicScans, 1);
        assert.equal(contextsCreated, 3);
        assert.equal(contextsClosed, 3);

        let violationScans = 0;
        const axeViolations = async () => {
            violationScans += 1;
            return 2;
        };
        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', axeViolations), 2);
        assert.equal(violationScans, 1);
        assert.equal(contextsCreated, 4);
        assert.equal(contextsClosed, 4);
    });

    it('context 关闭失败时硬失败当前 URL，不让清理异常中断整批扫描', async () => {
        let contextsCreated = 0;
        const browser = {
            newContext: async () => {
                contextsCreated += 1;
                return {
                    newPage: async () => ({}),
                    close: async () => {
                        throw new Error('browser disconnected while closing context');
                    },
                };
            },
        };

        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', async () => 0), 1);

        let transientScans = 0;
        const transientFailure = async () => {
            transientScans += 1;
            throw new Error('page.goto: net::ERR_TIMED_OUT at https://example.test/');
        };
        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', transientFailure), 1);
        assert.equal(transientScans, 1);
        assert.equal(contextsCreated, 2);
    });

    it('context 创建失败不执行关闭，并按错误类型决定是否重试', async () => {
        let attempts = 0;
        const deterministicBrowser = {
            newContext: async () => {
                attempts += 1;
                throw new Error('browser.newContext: target closed');
            },
        };

        assert.equal(await assertAccessibilityWithRetry(deterministicBrowser, 'https://example.test/'), 1);
        assert.equal(attempts, 1);

        const retryLogs = mock.method(console, 'log', () => {});
        const transientBrowser = {
            newContext: async () => {
                attempts += 1;
                throw new Error('page.goto: net::ERR_CONNECTION_RESET at https://example.test/');
            },
        };
        assert.equal(await assertAccessibilityWithRetry(transientBrowser, 'https://example.test/'), 1);
        assert.equal(attempts, 3);
        assert.equal(retryLogs.mock.callCount(), 1);
        assert.match(retryLogs.mock.calls[0].arguments[0], /重试 1\/1/);
        retryLogs.mock.restore();
    });

    it('page 创建失败会关闭已创建的 context，再按错误类型决定是否重试', async () => {
        let contextsCreated = 0;
        let contextsClosed = 0;
        const browser = {
            newContext: async () => {
                contextsCreated += 1;
                return {
                    newPage: async () => {
                        throw new Error('page.goto: net::ERR_TIMED_OUT at https://example.test/');
                    },
                    close: async () => {
                        contextsClosed += 1;
                    },
                };
            },
        };

        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/'), 1);
        assert.equal(contextsCreated, 2);
        assert.equal(contextsClosed, 2);
    });

    it('scan 的零值和违规数量均原样返回且不重试', async () => {
        for (const expected of [0, 3]) {
            let scans = 0;
            let closes = 0;
            const browser = {
                newContext: async () => ({
                    newPage: async () => ({}),
                    close: async () => {
                        closes += 1;
                    },
                }),
            };
            const scan = async () => {
                scans += 1;
                return expected;
            };

            assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', scan), expected);
            assert.equal(scans, 1);
            assert.equal(closes, 1);
        }
    });

    it('scan 与 context 关闭均失败时按顺序输出两条错误且不重试', async () => {
        let contextsCreated = 0;
        const browser = {
            newContext: async () => {
                contextsCreated += 1;
                return {
                    newPage: async () => ({}),
                    close: async () => {
                        throw new Error('close failed');
                    },
                };
            },
        };
        const errors = mock.method(console, 'error', () => {});
        const logs = mock.method(console, 'log', () => {});
        const scan = async () => {
            throw new Error('page.goto: net::ERR_TIMED_OUT at https://example.test/');
        };

        assert.equal(await assertAccessibilityWithRetry(browser, 'https://example.test/', scan), 1);
        assert.equal(contextsCreated, 1);
        assert.deepEqual(
            errors.mock.calls.map((call) => call.arguments[0]),
            [
                '❌ [A11Y 无障碍检查未完成] 页面或浏览器出错（这不是 WCAG 违规结果）: https://example.test/: page.goto: net::ERR_TIMED_OUT at https://example.test/',
                '❌ [A11Y 浏览器清理失败] 无法关闭该页面的隔离浏览器环境，本页检查已停止: https://example.test/: close failed',
            ],
        );
        assert.equal(logs.mock.callCount(), 0);
        errors.mock.restore();
        logs.mock.restore();
    });

    it('formatViolation 汇总 impact / id / 节点 target', () => {
        const line = formatViolation({
            id: 'button-name',
            impact: 'critical',
            help: 'Buttons must have discernible text',
            helpUrl: 'https://dequeuniversity.com/rules/axe/4.12/button-name',
            nodes: [{ target: ['button.icon-only'] }, { target: ['#nav', 'button'] }],
        });

        assert.match(line, /\[critical\] button-name/);
        assert.match(line, /Buttons must have discernible text/);
        assert.match(line, /2 node\(s\): button\.icon-only; #nav button/);
        assert.match(line, /dequeuniversity\.com/);
    });

    it('formatViolation 在缺少 impact 时回退 unknown', () => {
        const line = formatViolation({
            id: 'color-contrast',
            help: 'Elements must have sufficient color contrast',
            nodes: [{ target: ['.muted'] }],
        });
        assert.match(line, /^\[unknown\] color-contrast:/);
    });

    it('formatViolations 按顺序格式化', () => {
        const lines = formatViolations([
            {
                id: 'a',
                impact: 'serious',
                help: 'help-a',
                nodes: [{ target: ['#a'] }],
            },
            {
                id: 'b',
                impact: 'moderate',
                help: 'help-b',
                nodes: [{ target: ['#b'] }],
            },
        ]);
        assert.equal(lines.length, 2);
        assert.match(lines[0], /\[serious\] a:/);
        assert.match(lines[1], /\[moderate\] b:/);
    });

    it('countViolationNodes 累计受影响节点数', () => {
        assert.equal(countViolationNodes([]), 0);
        assert.equal(countViolationNodes([{ nodes: [{}, {}] }, { nodes: [{}] }]), 3);
    });
});
