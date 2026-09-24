const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    NAVIGATION_OPTIONS,
    TRANSIENT_NAVIGATION_ATTEMPTS,
    isTransientNavigationError,
    isTransientHttpStatus,
    openMountedPageWithRetry,
    inspectMountedPage,
    createCrawlState,
    createCspConsoleCollector,
    enqueueGlossarySample,
    enqueueInternalLink,
    inspectQueueItem,
    crawl,
    run,
} = require('./playwright-checker');

function visitResult({ status = 200, mounted = true, label = 'home-title' } = {}) {
    let closed = false;
    return {
        context: {
            close: async () => {
                closed = true;
            },
        },
        page: {},
        response: { status: () => status },
        status,
        mounted,
        label,
        wasClosed: () => closed,
    };
}

describe('playwright-checker navigation recovery', () => {
    it('保持原导航语义，并只允许一次独立复验', () => {
        assert.deepEqual(NAVIGATION_OPTIONS, { waitUntil: 'load', timeout: 60000 });
        assert.equal(TRANSIENT_NAVIGATION_ATTEMPTS, 2);
    });

    it('只把已知 Chromium 传输错误识别为瞬时错误', () => {
        assert.equal(
            isTransientNavigationError(new Error('page.goto: net::ERR_TIMED_OUT at https://example.test/')),
            true,
        );
        assert.equal(
            isTransientNavigationError(new Error('page.goto: net::ERR_CONNECTION_CLOSED at https://example.test/')),
            true,
        );
        assert.equal(isTransientNavigationError(new Error('page.goto: net::ERR_CONNECTION_RESET')), true);
        assert.equal(isTransientNavigationError(new Error('page.waitForSelector: Timeout 30000ms exceeded')), false);
        assert.equal(isTransientNavigationError('page.goto: net::ERR_TIMED_OUT'), false);
    });

    it('只把网关暂时不可用响应识别为可复验状态', () => {
        assert.equal(isTransientHttpStatus(502), true);
        assert.equal(isTransientHttpStatus(503), true);
        assert.equal(isTransientHttpStatus(504), true);
        assert.equal(isTransientHttpStatus(404), false);
        assert.equal(isTransientHttpStatus(500), false);
        assert.equal(isTransientHttpStatus(null), false);
    });

    it('503 后关闭失败 context，并用干净页面复验', async () => {
        const first = visitResult({ status: 503, mounted: null });
        const second = visitResult();
        const results = [first, second];
        let calls = 0;
        const openOnce = async () => results[calls++];

        const result = await openMountedPageWithRetry({}, 'https://example.test/', undefined, openOnce);

        assert.equal(calls, 2);
        assert.equal(first.wasClosed(), true);
        assert.equal(second.wasClosed(), false);
        assert.equal(result, second);
        await result.context.close();
    });

    it('首次未挂载时用干净页面复验，连续未挂载仍返回失败结果', async () => {
        const first = visitResult({ mounted: false });
        const second = visitResult({ mounted: false });
        const results = [first, second];
        let calls = 0;

        const result = await openMountedPageWithRetry(
            {},
            'https://example.test/',
            undefined,
            async () => results[calls++],
        );

        assert.equal(calls, 2);
        assert.equal(first.wasClosed(), true);
        assert.equal(result.mounted, false);
        assert.equal(second.wasClosed(), false);
        await result.context.close();
    });

    it('瞬时传输错误复验一次，连续失败仍硬失败', async () => {
        let calls = 0;
        const openOnce = async () => {
            calls += 1;
            throw new Error('page.goto: net::ERR_CONNECTION_RESET at https://example.test/');
        };

        const result = await openMountedPageWithRetry({}, 'https://example.test/', undefined, openOnce);

        assert.equal(calls, 2);
        assert.match(result.error.message, /ERR_CONNECTION_RESET/);
    });

    it('404 与确定性异常不复验', async () => {
        let statusCalls = 0;
        const notFound = visitResult({ status: 404, mounted: null });
        const statusResult = await openMountedPageWithRetry({}, 'https://example.test/missing', undefined, async () => {
            statusCalls += 1;
            return notFound;
        });
        assert.equal(statusCalls, 1);
        assert.equal(statusResult.status, 404);
        await statusResult.context.close();

        let errorCalls = 0;
        const errorResult = await openMountedPageWithRetry({}, 'https://example.test/', undefined, async () => {
            errorCalls += 1;
            throw new Error('definition-body 为空');
        });
        assert.equal(errorCalls, 1);
        assert.match(errorResult.error.message, /definition-body/);
    });
});

function mountedVisit(overrides = {}) {
    let closeCalls = 0;
    const context = {
        close: async () => {
            closeCalls += 1;
            if (overrides.closeError) throw overrides.closeError;
        },
    };
    return {
        context,
        page: overrides.page || {},
        response: overrides.response === undefined ? {} : overrides.response,
        status: overrides.status === undefined ? 200 : overrides.status,
        mounted: overrides.mounted === undefined ? true : overrides.mounted,
        label: overrides.label || 'home-title',
        error: overrides.error,
        closeCalls: () => closeCalls,
    };
}

async function withMutedConsole(callback) {
    const originalLog = console.log;
    const originalError = console.error;
    const logs = [];
    const errors = [];
    console.log = (message) => logs.push(message);
    console.error = (message) => errors.push(message);
    try {
        return await callback({ logs, errors });
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
}

describe('playwright-checker mounted page inspection', () => {
    it('各类基础导航失败均计一个问题并关闭 context', async () => {
        const cases = [
            mountedVisit({ error: new Error('boom'), response: null }),
            mountedVisit({ response: null }),
            mountedVisit({ status: 404, mounted: null }),
            mountedVisit({ status: 500, mounted: null }),
            mountedVisit({ mounted: false, label: 'route-title' }),
        ];

        await withMutedConsole(async () => {
            for (const visit of cases) {
                const issues = await inspectMountedPage(
                    {},
                    'https://site.test/page',
                    () => {},
                    () => {},
                    () => {},
                    {
                        openMountedPageWithRetry: async () => visit,
                    },
                );
                assert.equal(issues, 1);
                assert.equal(visit.closeCalls(), 1);
            }
        });
    });

    it('术语列表缺失和词条详情失败后不读取链接，并始终关闭 context', async () => {
        const listVisit = mountedVisit({
            page: { waitForSelector: async () => Promise.reject(new Error('missing')) },
        });
        const definitionVisit = mountedVisit();
        let reads = 0;

        await withMutedConsole(async () => {
            const listIssues = await inspectMountedPage(
                {},
                'https://site.test/glossary',
                () => {},
                () => {},
                () => {},
                {
                    startUrl: 'https://site.test/',
                    openMountedPageWithRetry: async () => listVisit,
                    readPageLinks: async () => {
                        reads += 1;
                        return [];
                    },
                },
            );
            const definitionIssues = await inspectMountedPage(
                {},
                'https://site.test/glossary/en/broken',
                () => {},
                () => {},
                () => {},
                {
                    startUrl: 'https://site.test/',
                    openMountedPageWithRetry: async () => definitionVisit,
                    assertGlossaryDefinition: async () => 2,
                    readPageLinks: async () => {
                        reads += 1;
                        return [];
                    },
                },
            );
            assert.equal(listIssues, 1);
            assert.equal(definitionIssues, 2);
        });
        assert.equal(reads, 0);
        assert.equal(listVisit.closeCalls(), 1);
        assert.equal(definitionVisit.closeCalls(), 1);
    });

    it('成功页只入队站内链接，记录外链，且 glossary 只触发一次抽样调用', async () => {
        const visit = mountedVisit({ page: { waitForSelector: async () => {} } });
        const internal = [];
        let samples = 0;
        await withMutedConsole(async ({ logs }) => {
            const issues = await inspectMountedPage(
                {},
                'https://site.test/glossary',
                () => {},
                (link) => internal.push(link),
                () => {
                    samples += 1;
                },
                {
                    startUrl: 'https://site.test/',
                    openMountedPageWithRetry: async () => visit,
                    readPageLinks: async () => ['https://site.test/internal', 'https://external.test/page'],
                },
            );
            assert.equal(issues, 0);
            assert.ok(logs.includes('   -> 外部链接: https://external.test/page'));
        });
        assert.deepEqual(internal, ['https://site.test/internal']);
        assert.equal(samples, 1);
        assert.equal(visit.closeCalls(), 1);
    });

    it('context 关闭失败会保留既有问题并额外计一个', async () => {
        const visit = mountedVisit({ mounted: false, closeError: new Error('close failed') });
        await withMutedConsole(async ({ errors }) => {
            const issues = await inspectMountedPage(
                {},
                'https://site.test/broken',
                () => {},
                () => {},
                () => {},
                {
                    openMountedPageWithRetry: async () => visit,
                },
            );
            assert.equal(issues, 2);
            assert.ok(errors.some((message) => message.includes('无法关闭浏览器 context: close failed')));
        });
    });
});

describe('playwright-checker crawl state', () => {
    it('链接去重、详情池和单次空池计数保持分离', async () => {
        const state = createCrawlState('https://site.test/');
        state.visited.add('https://site.test/seen');
        enqueueInternalLink(state, 'https://site.test/seen');
        enqueueInternalLink(state, 'https://site.test/glossary/en/term');
        assert.equal(state.queue.includes('https://site.test/glossary/en/term'), false);
        assert.equal(state.glossaryLinksPool.size, 1);

        await withMutedConsole(async () => {
            enqueueGlossarySample(state, (links) => links);
            enqueueGlossarySample(state, () => []);
        });
        assert.equal(state.queue.filter((link) => link.endsWith('/term')).length, 1);

        const emptyState = createCrawlState('https://empty.test/');
        await withMutedConsole(async () => {
            enqueueGlossarySample(emptyState, () => []);
            enqueueGlossarySample(emptyState, () => []);
        });
        assert.equal(emptyState.issues, 1);
    });

    it('静态资源与普通页面分派并返回各自问题数', async () => {
        const state = createCrawlState('https://site.test/');
        let binaries = 0;
        let pages = 0;
        const dependencies = {
            checkBinaryUrl: async () => {
                binaries += 1;
                return 2;
            },
            inspectMountedPage: async () => {
                pages += 1;
                return 3;
            },
        };
        assert.equal(await inspectQueueItem(state, {}, 'https://site.test/file.pdf', dependencies), 2);
        assert.equal(await inspectQueueItem(state, {}, 'https://site.test/page', dependencies), 3);
        assert.equal(binaries, 1);
        assert.equal(pages, 1);
    });

    it('CSP 收集器忽略普通消息，并对 enforce 与 Report-Only 去重', () => {
        const state = createCrawlState('https://site.test/');
        const collect = createCspConsoleCollector(state);
        const message = (text, type = 'info') => ({ text: () => text, type: () => type });
        const enforce =
            'Refused to load the script because it violates the following Content Security Policy directive';
        const reportOnly = 'Refused to load image due to Content-Security-Policy: blocked (report-only)';
        collect(message('ordinary console output'));
        collect(message(enforce, 'error'));
        collect(message(enforce, 'error'));
        collect(message(reportOnly));
        assert.deepEqual([...state.cspViolations], [enforce, reportOnly]);
    });

    it('重复队列链接只访问一次，普通队列耗尽后只抽样一次', async () => {
        const state = createCrawlState('https://site.test/');
        state.queue = ['https://site.test/a', 'https://site.test/a'];
        const checked = [];
        await withMutedConsole(() =>
            crawl(
                state,
                {},
                {
                    inspectMountedPage: async (_browser, url) => {
                        checked.push(url);
                        return 0;
                    },
                    pickGlossarySample: () => [],
                },
            ),
        );
        assert.deepEqual(checked, ['https://site.test/a']);
        assert.equal(state.glossarySampleEnqueued, true);
        assert.equal(state.issues, 1);
    });
});

describe('playwright-checker run lifecycle', () => {
    async function executeRun(pageResult) {
        let closes = 0;
        let exitCode;
        const state = createCrawlState('https://site.test/');
        state.queue = ['https://site.test/page'];
        const promise = run({
            state,
            startUrl: state.startUrl,
            launch: async () => ({
                close: async () => {
                    closes += 1;
                },
            }),
            inspectMountedPage: pageResult,
            pickGlossarySample: () => [],
            exit: (code) => {
                exitCode = code;
            },
        });
        const issues = await withMutedConsole(() => promise);
        return { closes, exitCode, issues };
    }

    it('正常和发现问题路径均关闭 browser 并给出正确退出状态', async () => {
        assert.deepEqual(await executeRun(async () => 0), { closes: 1, exitCode: 1, issues: 1 });
        assert.deepEqual(await executeRun(async () => 2), { closes: 1, exitCode: 1, issues: 3 });

        const cleanState = createCrawlState('https://site.test/');
        cleanState.queue = [];
        cleanState.glossarySampleEnqueued = true;
        let closed = 0;
        let exitCode;
        const issues = await withMutedConsole(() =>
            run({
                state: cleanState,
                launch: async () => ({
                    close: async () => {
                        closed += 1;
                    },
                }),
                exit: (code) => {
                    exitCode = code;
                },
            }),
        );
        assert.equal(issues, 0);
        assert.equal(exitCode, 0);
        assert.equal(closed, 1);
    });

    it('CSP 唯一违规逐条计入问题总数并产生失败退出状态', async () => {
        const state = createCrawlState('https://site.test/');
        state.queue = [];
        state.glossarySampleEnqueued = true;
        const collect = createCspConsoleCollector(state);
        const message = (text, type = 'info') => ({ text: () => text, type: () => type });
        const enforce =
            'Refused to load the script because it violates the following Content Security Policy directive';
        const reportOnly = 'Refused to load image due to Content-Security-Policy: blocked (report-only)';
        collect(message('ordinary console output'));
        collect(message(enforce, 'error'));
        collect(message(enforce, 'error'));
        collect(message(reportOnly));

        let exitCode;
        const { errors, issues } = await withMutedConsole(async ({ errors }) => ({
            errors,
            issues: await run({
                state,
                launch: async () => ({ close: async () => {} }),
                exit: (code) => {
                    exitCode = code;
                },
            }),
        }));

        assert.deepEqual(errors, [`❌ [CSP] ${enforce}`, `❌ [CSP] ${reportOnly}`]);
        assert.equal(issues, 2);
        assert.equal(state.issues, 2);
        assert.equal(exitCode, 1);
    });

    it('检查抛错时关闭 browser 并继续传播异常', async () => {
        let closed = 0;
        const state = createCrawlState('https://site.test/');
        state.queue = ['https://site.test/page'];
        await withMutedConsole(async () => {
            await assert.rejects(
                run({
                    state,
                    launch: async () => ({
                        close: async () => {
                            closed += 1;
                        },
                    }),
                    inspectMountedPage: async () => {
                        throw new Error('inspection failed');
                    },
                    pickGlossarySample: () => [],
                    exit: () => assert.fail('异常路径不应退出'),
                }),
                /inspection failed/,
            );
        });
        assert.equal(closed, 1);
    });
});
