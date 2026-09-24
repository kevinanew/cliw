const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { UNKNOWN_PATHS, GLOSSARY_LOCALE_PATHS, DESKTOP_VIEWPORT, assertRedirect, run } = require('./redirect-checker');

function createLogger() {
    const logs = [];
    const errors = [];
    return { logs, errors, log: (message) => logs.push(message), error: (message) => errors.push(message) };
}

function createPage({ response = { status: () => 200 }, finalUrl = 'https://example.test/' } = {}) {
    return {
        goto: async () => response,
        url: () => finalUrl,
    };
}

describe('redirect-checker assertRedirect', () => {
    const options = { mountPathname: '/', successLabel: '首页已渲染' };

    it('无响应时返回一个问题且不检查挂载', async () => {
        const logger = createLogger();
        let mountCalls = 0;
        const issues = await assertRedirect(createPage({ response: null }), '/missing', '/', options, {
            baseUrl: 'https://example.test/',
            logger,
            assertPageMounted: async () => {
                mountCalls += 1;
            },
        });
        assert.equal(issues, 1);
        assert.equal(mountCalls, 0);
        assert.deepEqual(logger.errors, ['❌ [(无响应)] https://example.test/missing']);
    });

    it('4xx 响应时返回一个问题', async () => {
        const logger = createLogger();
        const issues = await assertRedirect(createPage({ response: { status: () => 404 } }), '/missing', '/', options, {
            baseUrl: 'https://example.test/',
            logger,
        });
        assert.equal(issues, 1);
        assert.deepEqual(logger.errors, ['❌ [404] https://example.test/missing']);
    });

    it('地址栏未改写时报告路径问题', async () => {
        const logger = createLogger();
        const issues = await assertRedirect(
            createPage({ finalUrl: 'https://example.test/missing?from=test' }),
            '/missing',
            '/',
            options,
            {
                baseUrl: 'https://example.test/',
                logger,
                assertPageMounted: async () => ({ mounted: true, label: 'home-title' }),
            },
        );
        assert.equal(issues, 1);
        assert.deepEqual(logger.errors, ['❌ [重定向] https://example.test/missing: 地址栏路径为 /missing，期望 /']);
    });

    it('页面未挂载时报告目标页问题', async () => {
        const logger = createLogger();
        const issues = await assertRedirect(createPage(), '/missing', '/', options, {
            baseUrl: 'https://example.test/',
            logger,
            assertPageMounted: async () => ({ mounted: false, label: 'home-title' }),
        });
        assert.equal(issues, 1);
        assert.deepEqual(logger.errors, [
            '❌ [重定向] https://example.test/missing: 目标页未渲染（home-title 不可见）',
        ]);
    });

    it('重定向且页面挂载成功时返回零', async () => {
        const logger = createLogger();
        const page = createPage();
        const issues = await assertRedirect(page, '/missing', '/', options, {
            baseUrl: 'https://example.test/',
            logger,
            assertPageMounted: async (actualPage, pathname, mountOptions) => {
                assert.equal(actualPage, page);
                assert.equal(pathname, '/');
                assert.deepEqual(mountOptions, { timeout: 30000 });
                return { mounted: true, label: 'home-title' };
            },
        });
        assert.equal(issues, 0);
        assert.equal(logger.logs.at(-1), '✅ [正常] /missing -> / (首页已渲染)');
    });
});

describe('redirect-checker orchestration', () => {
    it('按两组路径编排检查并成功退出', async () => {
        const calls = [];
        let closed = 0;
        const page = {};
        const logger = createLogger();
        const status = await run({
            env: 'staging',
            baseUrl: 'https://example.test/',
            logger,
            browserType: {
                launch: async () => ({
                    newPage: async (options) => {
                        assert.deepEqual(options, { viewport: DESKTOP_VIEWPORT });
                        return page;
                    },
                    close: async () => {
                        closed += 1;
                    },
                }),
            },
            assertRedirect: async (...args) => {
                calls.push(args.slice(0, 4));
                return 0;
            },
        });
        assert.equal(status, 0);
        assert.equal(closed, 1);
        assert.deepEqual(
            calls.map((call) => call[1]),
            [...UNKNOWN_PATHS, ...GLOSSARY_LOCALE_PATHS],
        );
        assert.deepEqual(
            calls.map((call) => call[2]),
            ['/', '/', '/', '/glossary', '/glossary', '/glossary'],
        );
        assert.ok(calls.every((call) => call[0] === page));
        assert.equal(logger.logs.at(-1), '✅ [成功] 未知路径 → /，glossary locale 路径 → /glossary，目标页均正常渲染');
    });

    it('检查发现问题时关闭 browser 并返回失败退出码', async () => {
        let closed = 0;
        const status = await run({
            baseUrl: 'https://example.test/',
            logger: createLogger(),
            browserType: {
                launch: async () => ({
                    newPage: async () => ({}),
                    close: async () => {
                        closed += 1;
                    },
                }),
            },
            assertRedirect: async (_page, path) => (path === UNKNOWN_PATHS[0] ? 1 : 0),
        });
        assert.equal(status, 1);
        assert.equal(closed, 1);
    });

    it('页面创建或检查抛出时仍关闭 browser', async () => {
        for (const stage of ['newPage', 'check']) {
            let closed = 0;
            await assert.rejects(
                run({
                    baseUrl: 'https://example.test/',
                    logger: createLogger(),
                    browserType: {
                        launch: async () => ({
                            newPage: async () => {
                                if (stage === 'newPage') throw new Error('page failed');
                                return {};
                            },
                            close: async () => {
                                closed += 1;
                            },
                        }),
                    },
                    assertRedirect: async () => {
                        throw new Error('check failed');
                    },
                }),
            );
            assert.equal(closed, 1);
        }
    });

    it('未知环境无需启动 browser 并返回失败退出码', async () => {
        const logger = createLogger();
        let launches = 0;
        const status = await run({
            env: 'unknown',
            logger,
            browserType: {
                launch: async () => {
                    launches += 1;
                },
            },
        });
        assert.equal(status, 1);
        assert.equal(launches, 0);
        assert.deepEqual(logger.errors, ['❌ 未知环境: unknown']);
    });
});
