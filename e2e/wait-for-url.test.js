const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildVersionMatches, pollOnce, waitForUrl } = require('./wait-for-url');

function createHarness(responses, overrides = {}) {
    const calls = { fetch: [], delay: [], log: [], error: [], exit: [] };
    let responseIndex = 0;
    const options = {
        env: 'staging',
        targetUrl: 'https://staging.example.test',
        expectedSha: '',
        maxAttempts: responses.length,
        intervalMs: 123,
        fetchBuildVersion: async (url) => {
            calls.fetch.push(url);
            const response = responses[responseIndex];
            responseIndex += 1;
            if (response instanceof Error) throw response;
            return response;
        },
        delay: async (milliseconds) => calls.delay.push(milliseconds),
        log: (message) => calls.log.push(message),
        error: (message) => calls.error.push(message),
        exit: (code) => calls.exit.push(code),
        ...overrides,
    };
    return { calls, options };
}

describe('wait-for-url build-version matching', () => {
    it('在环境字段之后匹配 commit SHA 前缀', () => {
        assert.equal(buildVersionMatches('staging - abc1234 - 8/27/2026', 'abc1234', 'staging'), true);
        assert.equal(buildVersionMatches('production - abc1234 - 8/27/2026', 'abc1234', 'production'), true);
    });

    it('拒绝错误环境、错误 SHA 与旧格式', () => {
        assert.equal(buildVersionMatches('production - abc1234 - now', 'abc1234', 'staging'), false);
        assert.equal(buildVersionMatches('staging - def5678 - now', 'abc1234', 'staging'), false);
        assert.equal(buildVersionMatches('abc1234 - now', 'abc1234', 'staging'), false);
    });
});

describe('wait-for-url polling', () => {
    it('首次成功后立即停止且不等待', async () => {
        const { calls, options } = createHarness([{ ok: true, status: 200, buildVersion: null }]);

        await waitForUrl(options);

        assert.equal(calls.fetch.length, 1);
        assert.deepEqual(calls.delay, []);
        assert.match(calls.log.at(-1), /第 1\/1 次尝试/);
        assert.deepEqual(calls.exit, []);
    });

    it('等待提交时在 build-version 匹配后成功', async () => {
        const version = 'staging - abc1234def - now';
        const { calls, options } = createHarness([{ ok: true, status: 200, buildVersion: version }], {
            expectedSha: 'abc1234',
        });

        await waitForUrl(options);

        assert.match(calls.log.at(-1), /build-version=staging - abc1234def - now/);
        assert.deepEqual(calls.delay, []);
    });

    for (const testCase of [
        {
            name: 'HTTP 非成功',
            first: { ok: false, status: 503, buildVersion: null },
            expected: 'HTTP 503',
            sha: '',
        },
        {
            name: 'build-version 缺失',
            first: { ok: true, status: 200, buildVersion: null },
            expected: 'build-version=(缺失)',
            sha: 'abc1234',
        },
        {
            name: 'build-version 不匹配',
            first: { ok: true, status: 200, buildVersion: 'staging - def5678 - now' },
            expected: '尚未匹配 abc1234',
            sha: 'abc1234',
        },
        { name: '请求异常', first: new Error('network down'), expected: 'network down', sha: '' },
    ]) {
        it(`${testCase.name}后等待一次并在第二次成功`, async () => {
            const success = {
                ok: true,
                status: 200,
                buildVersion: testCase.sha ? 'staging - abc1234 - now' : null,
            };
            const { calls, options } = createHarness([testCase.first, success], {
                expectedSha: testCase.sha,
            });

            await waitForUrl(options);

            assert.equal(calls.fetch.length, 2);
            assert.deepEqual(calls.delay, [123]);
            assert.match(calls.log.at(-2), /第 1\/2 次尝试:/);
            assert.ok(calls.log.at(-2).includes(testCase.expected));
            assert.match(calls.log.at(-1), /第 2\/2 次尝试/);
        });
    }

    it('最后一次失败后不等待，并报告普通超时和失败退出', async () => {
        const failure = { ok: false, status: 500, buildVersion: null };
        const { calls, options } = createHarness([failure, failure, failure]);

        await waitForUrl(options);

        assert.equal(calls.fetch.length, 3);
        assert.deepEqual(calls.delay, [123, 123]);
        assert.match(calls.log.at(-1), /第 3\/3 次尝试: HTTP 500/);
        assert.deepEqual(calls.error, ['❌ URL 在尝试 3 次后仍未就绪: https://staging.example.test']);
        assert.deepEqual(calls.exit, [1]);
    });

    it('等待提交耗尽后报告提交超时和失败退出', async () => {
        const { calls, options } = createHarness([{ ok: true, status: 200, buildVersion: 'staging - def5678 - now' }], {
            expectedSha: 'abc1234',
        });

        await waitForUrl(options);

        assert.deepEqual(calls.delay, []);
        assert.deepEqual(calls.error, ['❌ 在尝试 1 次后，https://staging.example.test 仍未部署到提交 abc1234']);
        assert.deepEqual(calls.exit, [1]);
    });

    it('未知环境立即失败，不请求也不等待', async () => {
        const { calls, options } = createHarness([{ ok: true, status: 200, buildVersion: null }], {
            env: 'unknown',
            targetUrl: null,
        });

        await waitForUrl(options);

        assert.deepEqual(calls.fetch, []);
        assert.deepEqual(calls.delay, []);
        assert.deepEqual(calls.error, ['❌ 未知环境: unknown']);
        assert.deepEqual(calls.exit, [1]);
    });
});

describe('pollOnce', () => {
    it('把请求异常归一化为失败结果', async () => {
        const result = await pollOnce('https://example.test', '', 'staging', async () => {
            throw new Error('boom');
        });

        assert.equal(result.ready, false);
        assert.equal(result.reason, 'request');
        assert.equal(result.error.message, 'boom');
    });
});
