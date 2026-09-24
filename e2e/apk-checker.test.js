const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_BUDGET_MS,
    WARMUP_RUNS,
    SAMPLE_RUNS,
    parseBudgetMs,
    resolveApkReadyBudgetMs,
    median,
    isWithinBudget,
    waitForApkIndexResponse,
    isTransientMeasurementError,
    measureApkReadyWithRetry,
    parseAndAssertApkFilename,
    parseApkSize,
    assertMinimumApkSize,
    readFirstFourBytes,
    assertZipMagic,
    assertApkBinaryHealthy,
} = require('./apk-checker');

const MIN_APK_SIZE_BYTES = 50 * 1024 * 1024;

function createReader(value, events = []) {
    return {
        read: async () => {
            events.push('read');
            return { value };
        },
        cancel: async () => events.push('cancel'),
    };
}

function createResponse({ value = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), headers, ...rest } = {}) {
    return {
        ok: true,
        status: 206,
        statusText: 'Partial Content',
        headers: new Headers(headers || { 'content-range': `bytes 0-3/${MIN_APK_SIZE_BYTES}` }),
        body: { getReader: () => createReader(value) },
        ...rest,
    };
}

describe('apk-checker helpers', () => {
    it('DEFAULT_BUDGET_MS 为 3000', () => {
        assert.equal(DEFAULT_BUDGET_MS, 3000);
    });

    it('采样次数与 speed-checker 对齐：1 warmup + 3 samples', () => {
        assert.equal(WARMUP_RUNS, 1);
        assert.equal(SAMPLE_RUNS, 3);
    });

    it('parseBudgetMs 空值回退默认预算', () => {
        assert.equal(parseBudgetMs(undefined), 3000);
        assert.equal(parseBudgetMs(''), 3000);
        assert.equal(parseBudgetMs(undefined, 5000), 5000);
    });

    it('parseBudgetMs 解析正整数并拒绝非法值', () => {
        assert.equal(parseBudgetMs('3000'), 3000);
        assert.throws(() => parseBudgetMs('0'), /正整数/);
        assert.throws(() => parseBudgetMs('-1'), /正整数/);
        assert.throws(() => parseBudgetMs('abc'), /正整数/);
    });

    it('resolveApkReadyBudgetMs 优先 APK_READY_BUDGET_MS，其次 SPEED_BUDGET_MS', () => {
        assert.equal(resolveApkReadyBudgetMs({}), 3000);
        assert.equal(resolveApkReadyBudgetMs({ SPEED_BUDGET_MS: '4000' }), 4000);
        assert.equal(resolveApkReadyBudgetMs({ APK_READY_BUDGET_MS: '2500', SPEED_BUDGET_MS: '4000' }), 2500);
    });

    it('median / isWithinBudget 边界行为', () => {
        assert.equal(median([3, 1, 2]), 2);
        assert.equal(median([10, 20, 30, 40]), 25);
        assert.equal(isWithinBudget(3000, 3000), true);
        assert.equal(isWithinBudget(3001, 3000), false);
    });

    it('APK 清单等待在调用时处理 rejection，即使稍后才读取结果也不会产生未处理异常', async () => {
        let rejectResponse;
        const response = new Promise((resolve, reject) => {
            rejectResponse = reject;
        });
        let predicate;
        let options;
        const page = {
            waitForResponse: (nextPredicate, nextOptions) => {
                predicate = nextPredicate;
                options = nextOptions;
                return response;
            },
        };

        const handledResponse = waitForApkIndexResponse(page);
        rejectResponse(new Error('Timeout 30000ms exceeded'));
        await new Promise((resolve) => setImmediate(resolve));

        assert.equal(await handledResponse, null);
        assert.deepEqual(options, { timeout: 30000 });
        assert.equal(predicate({ url: () => 'https://example.test/apk/index.json', ok: () => true }), true);
        assert.equal(predicate({ url: () => 'https://example.test/apk/index.json', ok: () => false }), false);
    });

    it('清单网络等待失败时用干净页面重试一次', async () => {
        const expected = {
            readyMs: 120,
            apkUrl: 'https://example.test/apk/app.apk',
            indexCacheStatus: 'HIT',
            indexContentEncoding: '',
        };
        let calls = 0;
        const measure = async () => {
            calls += 1;
            if (calls === 1) {
                throw new Error('apk/index.json 请求未在超时内成功完成。');
            }
            return expected;
        };

        assert.deepEqual(await measureApkReadyWithRetry({}, 'https://example.test/', measure), expected);
        assert.equal(calls, 2);
    });

    it('连续瞬时失败仍硬失败，确定性断言失败不重试', async () => {
        let transientCalls = 0;
        const alwaysTimesOut = async () => {
            transientCalls += 1;
            throw new Error('apk/index.json 请求未在超时内成功完成。');
        };
        await assert.rejects(measureApkReadyWithRetry({}, 'https://example.test/', alwaysTimesOut), /未在超时内/);
        assert.equal(transientCalls, 2);

        let assertionCalls = 0;
        const invalidCacheHeader = async () => {
            assertionCalls += 1;
            throw new Error('apk/index.json 的 Cache-Control 不应为 immutable');
        };
        await assert.rejects(
            measureApkReadyWithRetry({}, 'https://example.test/', invalidCacheHeader),
            /不应为 immutable/,
        );
        assert.equal(assertionCalls, 1);
    });

    it('只把已知传输层故障识别为可重试', () => {
        const timeout = new Error('Timeout 30000ms exceeded');
        timeout.name = 'TimeoutError';
        assert.equal(isTransientMeasurementError(timeout), false);
        assert.equal(isTransientMeasurementError(new Error('page.goto: net::ERR_CONNECTION_RESET')), false);
        assert.equal(isTransientMeasurementError(new Error('apk/index.json 请求未在超时内成功完成。')), true);
        assert.equal(isTransientMeasurementError(new Error('invalid APK href')), false);
        assert.equal(isTransientMeasurementError('TimeoutError'), false);
    });

    it('首页挂载超时只测量一次并直接失败', async () => {
        let calls = 0;
        const mountTimeout = async () => {
            calls += 1;
            const error = new Error('page.waitForSelector: Timeout 30000ms exceeded');
            error.name = 'TimeoutError';
            throw error;
        };

        await assert.rejects(measureApkReadyWithRetry({}, 'https://example.test/', mountTimeout), /waitForSelector/);
        assert.equal(calls, 1);
    });

    it('APK 按钮等待超时只测量一次并直接失败', async () => {
        let calls = 0;
        const locatorTimeout = async () => {
            calls += 1;
            const error = new Error('locator.waitFor: Timeout 30000ms exceeded');
            error.name = 'TimeoutError';
            throw error;
        };

        await assert.rejects(measureApkReadyWithRetry({}, 'https://example.test/', locatorTimeout), /locator\.waitFor/);
        assert.equal(calls, 1);
    });

    it('解析并校验 APK 文件名，包括 URL 编码名称', () => {
        assert.equal(parseAndAssertApkFilename('https://example.test/apk/laiwan-1.2_3.apk'), 'laiwan-1.2_3.apk');
        assert.equal(parseAndAssertApkFilename('https://example.test/apk/%E6%9D%A5%E7%8E%A9.apk'), '来玩.apk');
        assert.throws(
            () => parseAndAssertApkFilename('https://example.test/apk/app.zip'),
            /APK 文件名未通过白名单校验.*app\.zip/,
        );
        assert.throws(
            () => parseAndAssertApkFilename('https://example.test/apk/app%20bad.apk'),
            /非法字符.*app bad\.apk/,
        );
        assert.throws(() => parseAndAssertApkFilename('https://example.test/apk/'), {
            message: 'APK 文件名未通过白名单校验（拒绝非 .apk / 非法字符）: ',
        });
    });

    it('优先解析 Content-Range，总大小不可用时回退 Content-Length', () => {
        assert.equal(
            parseApkSize(new Headers({ 'content-range': 'bytes 0-3/60000000', 'content-length': '4' })),
            60000000,
        );
        assert.equal(parseApkSize(new Headers({ 'content-length': '52428800' })), 52428800);
        assert.equal(parseApkSize(new Headers({ 'content-range': 'invalid', 'content-length': '52428801' })), 52428801);
        assert.equal(
            parseApkSize(new Headers({ 'content-range': 'bytes 0-3/*', 'content-length': '52428802' })),
            52428802,
        );
        assert.equal(
            parseApkSize(new Headers({ 'content-range': 'garbage/60000000', 'content-length': '52428803' })),
            52428803,
        );
        assert.equal(
            parseApkSize(new Headers({ 'content-range': 'items 0-3/60000000', 'content-length': '52428804' })),
            52428804,
        );
    });

    it('Content-Range 必须是本次请求的有效 0-3 区间，否则回退 Content-Length', () => {
        for (const contentRange of [
            'bytes 4-3/52428800',
            'bytes 0-52428800/52428800',
            'bytes 1-3/52428800',
            'bytes 0-2/52428800',
            'bytes 0-3/3',
            `bytes ${Number.MAX_SAFE_INTEGER}0-3/52428800`,
            `bytes 0-${Number.MAX_SAFE_INTEGER}0/52428800`,
            `bytes 0-3/${Number.MAX_SAFE_INTEGER}0`,
        ]) {
            assert.equal(parseApkSize(new Headers({ 'content-range': contentRange, 'content-length': '4' })), 4);
        }
    });

    it('尺寸头缺失、格式无效或非数字时无法解析', () => {
        assert.equal(parseApkSize(new Headers()), null);
        assert.equal(parseApkSize(new Headers({ 'content-range': 'invalid', 'content-length': 'invalid' })), null);
        assert.equal(parseApkSize(new Headers({ 'content-length': '123abc' })), null);
        assert.equal(parseApkSize(new Headers({ 'content-length': '9'.repeat(400) })), null);
        assert.throws(() => assertMinimumApkSize(null), /无法从响应头/);
    });

    it('50 MiB 边界通过，小于阈值失败且展示两位小数', () => {
        assert.doesNotThrow(() => assertMinimumApkSize(MIN_APK_SIZE_BYTES));
        assert.throws(
            () => assertMinimumApkSize(MIN_APK_SIZE_BYTES - 1),
            /APK 文件过小。预期至少为: 50 MB, 实际大小为: 50\.00 MB/,
        );
    });

    it('读取首次数据后取消 reader，且不足四字节失败', async () => {
        for (const value of [undefined, new Uint8Array(), Uint8Array.from([0x50, 0x4b, 0x03])]) {
            const events = [];
            await assert.rejects(readFirstFourBytes({ getReader: () => createReader(value, events) }), /至少 4 个字节/);
            assert.deepEqual(events, ['read', 'cancel']);
        }
        await assert.rejects(readFirstFourBytes(null), /至少 4 个字节/);
    });

    it('ZIP 魔法字节校验返回实际值或报告期望值与实际值', () => {
        assert.equal(assertZipMagic(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), '504b0304');
        assert.throws(
            () => assertZipMagic(Uint8Array.from([0x50, 0x4b, 0x05, 0x06])),
            /APK 魔法字节预期值: 504b0304, 实际值: 504b0506/,
        );
    });

    it('HTTP 非成功响应立即报告状态码与状态文本', async () => {
        const fetchImpl = async () => createResponse({ ok: false, status: 404, statusText: 'Not Found' });
        await assert.rejects(
            assertApkBinaryHealthy('https://example.test/app.apk', fetchImpl),
            /HTTP 请求错误: 404 Not Found/,
        );
    });

    it('完整流程不信任前部格式错误但带数字总大小的 Content-Range', async () => {
        const response = createResponse({
            headers: { 'content-range': `garbage/${MIN_APK_SIZE_BYTES}`, 'content-length': '4' },
        });

        await assert.rejects(
            assertApkBinaryHealthy('https://example.test/app.apk', async () => response),
            /APK 文件过小。预期至少为: 50 MB, 实际大小为: 0\.00 MB/,
        );
    });

    it('完整流程不信任数值关系无效的 Content-Range', async () => {
        for (const contentRange of ['bytes 4-3/52428800', 'bytes 0-52428800/52428800']) {
            const events = [];
            const response = createResponse({
                headers: { 'content-range': contentRange, 'content-length': '4' },
            });
            response.body = {
                getReader: () => createReader(Uint8Array.from([0x50, 0x4b, 0x03, 0x04]), events),
            };

            await assert.rejects(
                assertApkBinaryHealthy('https://example.test/app.apk', async () => response),
                /APK 文件过小。预期至少为: 50 MB, 实际大小为: 0\.00 MB/,
            );
            assert.deepEqual(events, []);
        }
    });

    it('完整成功路径只请求前四字节，并保持关键日志与操作顺序', async () => {
        const events = [];
        const response = createResponse();
        response.body = { getReader: () => createReader(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0xff]), events) };
        const fetchImpl = async (url, options) => {
            events.push(`fetch:${url}:${options.headers.Range}`);
            return response;
        };
        const originalLog = console.log;
        console.log = (message) => events.push(`log:${message}`);
        try {
            await assertApkBinaryHealthy('https://example.test/apk/app.apk', fetchImpl);
        } finally {
            console.log = originalLog;
        }

        assert.deepEqual(events, [
            'log:✅ [成功] APK 文件名白名单校验通过: app.apk',
            'log:正在获取 APK 文件头部以进行校验...',
            'fetch:https://example.test/apk/app.apk:bytes=0-3',
            `log:APK 文件大小为: 50.00 MB (${MIN_APK_SIZE_BYTES} 字节)`,
            'log:✅ [成功] APK 文件大小校验通过，已超过 50 MB。',
            'read',
            'cancel',
            'log:✅ [成功] APK 文件校验全部通过。魔法字节为: 504b0304 (PK\\x03\\x04) 且文件大小超过 50MB。',
        ]);
    });
});
