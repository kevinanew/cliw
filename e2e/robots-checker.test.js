const assert = require('node:assert/strict');
const test = require('node:test');

const { blocksAllCrawlers, allowsIndexing, fetchRobotsWithRetry } = require('./robots-checker');

test('robots 内容断言区分 staging 屏蔽与 production 收录', () => {
    const staging = 'User-agent: *\nDisallow: /\n';
    const production = 'User-agent: *\nAllow: /\n';

    assert.equal(blocksAllCrawlers(staging), true);
    assert.equal(allowsIndexing(staging), false);
    assert.equal(allowsIndexing(production), true);
});

test('robots 请求在短暂网络失败后重试并返回响应', async () => {
    let calls = 0;
    const response = { status: 200, ok: true, text: async () => 'User-agent: *\n' };
    const result = await fetchRobotsWithRetry(
        async () => {
            calls += 1;
            if (calls === 1) {
                throw new TypeError('fetch failed');
            }
            return response;
        },
        'https://example.test/robots.txt',
        { attempts: 3, sleep: async () => {} },
    );

    assert.equal(result.response, response);
    assert.equal(result.body, 'User-agent: *\n');
    assert.equal(calls, 2);
});

test('robots 请求在服务端暂时失败后重试，并在用尽次数后报错', async () => {
    let calls = 0;
    await assert.rejects(
        () =>
            fetchRobotsWithRetry(
                async () => {
                    calls += 1;
                    return { status: 503, ok: false, text: async () => '' };
                },
                'https://example.test/robots.txt',
                { attempts: 2, sleep: async () => {} },
            ),
        /HTTP 503/,
    );
    assert.equal(calls, 2);
});

test('robots 请求在响应头成功但正文不结束时超时并重试', async () => {
    let calls = 0;
    await assert.rejects(
        () =>
            fetchRobotsWithRetry(
                async (_url, { signal }) => {
                    calls += 1;
                    return {
                        status: 200,
                        ok: true,
                        text: () =>
                            new Promise((_resolve, reject) => {
                                signal.addEventListener('abort', () => {
                                    const error = new Error('The operation was aborted');
                                    error.name = 'AbortError';
                                    reject(error);
                                });
                            }),
                    };
                },
                'https://example.test/robots.txt',
                { attempts: 2, timeoutMs: 10, sleep: async () => {} },
            ),
        { name: 'AbortError' },
    );
    assert.equal(calls, 2);
});

test('robots 请求在首次正文读取失败后重试并返回后续正文', async () => {
    let calls = 0;
    const result = await fetchRobotsWithRetry(
        async () => {
            calls += 1;
            return {
                status: 200,
                ok: true,
                text: async () => {
                    if (calls === 1) {
                        throw new TypeError('terminated');
                    }
                    return 'User-agent: *\nDisallow: /\n';
                },
            };
        },
        'https://example.test/robots.txt',
        { attempts: 2, sleep: async () => {} },
    );

    assert.equal(result.body, 'User-agent: *\nDisallow: /\n');
    assert.equal(calls, 2);
});
