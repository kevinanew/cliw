const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildStaticPageUrls, STATIC_PATHS } = require('./site-contract');
const {
    fetchSitemap,
    parseSitemap,
    validateStaticUrls,
    prepareGlossaryUrls,
    checkGlossaryPage,
    checkGlossaryPages,
    withBrowser,
    run,
    main,
} = require('./sitemap-checker');

function captureLogger() {
    const logs = [];
    const errors = [];
    const events = [];
    return {
        logs,
        errors,
        events,
        log: (...args) => {
            logs.push(args);
            events.push(['log', ...args]);
        },
        error: (...args) => {
            errors.push(args);
            events.push(['error', ...args]);
        },
    };
}

function sitemapXml(locs) {
    return `<urlset>${locs.map((loc) => `<url><loc>${loc}</loc></url>`).join('')}</urlset>`;
}

function successfulFetch(locs) {
    return async () => ({ ok: true, text: async () => sitemapXml(locs) });
}

function assertLoggerEvents(logger, expectedEvents) {
    assert.deepEqual(logger.events, expectedEvents);
    assert.deepEqual(
        logger.logs,
        expectedEvents.filter(([level]) => level === 'log').map(([, ...args]) => args),
    );
    assert.deepEqual(
        logger.errors,
        expectedEvents.filter(([level]) => level === 'error').map(([, ...args]) => args),
    );
}

async function runFromEntry(options, logger) {
    const statuses = [];
    const exits = [];
    await main(
        async () => {
            const status = await run({ ...options, logger });
            statuses.push(status);
            return status;
        },
        (code) => exits.push(code),
        logger,
    );
    return { statuses, exits };
}

describe('sitemap parsing and fetching', () => {
    it('解析单项、多项、空 loc，并拒绝缺少 urlset 或 loc 的内容', () => {
        assert.deepEqual(parseSitemap(sitemapXml(['https://example.test/a'])).locs, ['https://example.test/a']);
        assert.deepEqual(parseSitemap(sitemapXml(['https://example.test/a', 'https://example.test/b'])).locs, [
            'https://example.test/a',
            'https://example.test/b',
        ]);
        assert.match(parseSitemap('<urlset><loc> </loc></urlset>').error, /未包含任何/);
        assert.match(parseSitemap('<loc>https://example.test</loc>').error, /内容无效/);
        assert.match(parseSitemap('<urlset></urlset>').error, /内容无效/);
    });

    it('请求成功、HTTP 失败和网络异常返回明确结果', async () => {
        assert.deepEqual(
            await fetchSitemap('https://x.test/sitemap.xml', async () => ({ ok: true, text: async () => 'x' })),
            {
                xml: 'x',
            },
        );
        assert.match(
            (await fetchSitemap('https://x.test/sitemap.xml', async () => ({ ok: false, status: 503 }))).error,
            /HTTP 503/,
        );
        assert.match(
            (await fetchSitemap('https://x.test/sitemap.xml', async () => Promise.reject(new Error('offline')))).error,
            /offline/,
        );
    });
});

describe('static URL validation', () => {
    const expected = buildStaticPageUrls(STATIC_PATHS);

    it('接受精确全集', () => {
        const result = validateStaticUrls(expected);
        assert.deepEqual(result.missing, []);
        assert.deepEqual(result.unexpected, []);
        assert.equal(result.countMismatch, false);
    });

    it('识别缺失、额外 query、重复与不同 origin，并排除无效 URL', () => {
        const missing = validateStaticUrls(expected.slice(1));
        assert.deepEqual(missing.missing, [expected[0]]);

        const canonical = new URL(expected[0]);
        const extraQuery = `${canonical.origin}${canonical.pathname}?noncanonical=1`;
        const irregular = validateStaticUrls([...expected, extraQuery]);
        assert.deepEqual(irregular.unexpected, [extraQuery]);
        assert.equal(irregular.countMismatch, true);

        assert.equal(validateStaticUrls([...expected, expected[0]]).countMismatch, true);
        const ignored = validateStaticUrls([...expected, `https://other.test${canonical.pathname}`, 'not a URL']);
        assert.equal(ignored.countMismatch, false);
        assert.deepEqual(ignored.unexpected, []);
    });
});

describe('glossary sample preparation', () => {
    const production = 'https://www.goplay.appcookies.com';
    const staging = 'https://staging.example.test';

    it('处理无词条，并把必测项和随机补充限制在样本上限内且替换 origin', () => {
        assert.deepEqual(prepareGlossaryUrls(['https://example.test/about'], staging).glossaryLocs, []);
        const locs = Array.from({ length: 20 }, (_, index) => `${production}/glossary/en/term-${index}`);
        locs.unshift(`${production}/glossary/zh/dezhoupuke`, `${production}/glossary/en/texasholdem`);
        const { sampled } = prepareGlossaryUrls(locs, staging);
        assert.equal(sampled.length, 10);
        assert.deepEqual(sampled.slice(0, 3), [
            `${staging}/glossary/zh/dezhoupuke`,
            `${staging}/glossary/zh-TW/dezhoupuke`,
            `${staging}/glossary/en/texasholdem`,
        ]);
        assert.ok(sampled.every((url) => url.startsWith(staging)));
    });
});

describe('page checks and browser lifecycle', () => {
    const url = 'https://example.test/glossary/en/test';

    async function check(response, mountedAssertion = async () => ({ mounted: true, label: '#app' })) {
        const logger = captureLogger();
        const page = {
            goto: async (_url, options) => (assert.deepEqual(options, { waitUntil: 'load', timeout: 60000 }), response),
        };
        return { issues: await checkGlossaryPage(page, url, mountedAssertion, logger), logger };
    }

    it('无响应、非 200、未挂载、成功和导航异常各自只返回一个或零个问题', async () => {
        assert.equal((await check(null)).issues, 1);
        assert.equal((await check({ status: () => 404 })).issues, 1);
        assert.equal(
            (
                await check({ status: () => 200 }, async (_page, path) => {
                    assert.equal(path, '/glossary/en/test');
                    return { mounted: false, label: '#app' };
                })
            ).issues,
            1,
        );
        assert.equal((await check({ status: () => 200 })).issues, 0);
        const logger = captureLogger();
        assert.equal(
            await checkGlossaryPage({ goto: async () => Promise.reject(new Error('boom')) }, url, undefined, logger),
            1,
        );
        assert.match(logger.errors[0][0], /boom/);
    });

    it('批量失败后继续，按访问顺序累计问题', async () => {
        const visited = [];
        const issues = await checkGlossaryPages({}, ['a', 'b', 'c'], async (_page, urlToCheck) => {
            visited.push(urlToCheck);
            return urlToCheck === 'b' ? 0 : 1;
        });
        assert.equal(issues, 2);
        assert.deepEqual(visited, ['a', 'b', 'c']);
    });

    it('检查成功和异常时都关闭浏览器', async () => {
        for (const shouldThrow of [false, true]) {
            let closed = 0;
            const browser = {
                newPage: async () => ({}),
                close: async () => {
                    closed += 1;
                },
            };
            const operation = () =>
                withBrowser(
                    async () => browser,
                    async () => {
                        if (shouldThrow) throw new Error('inspect failed');
                        return 42;
                    },
                );
            if (shouldThrow) await assert.rejects(operation, /inspect failed/);
            else assert.equal(await operation(), 42);
            assert.equal(closed, 1);
        }
    });
});

describe('top-level orchestration', () => {
    const expected = buildStaticPageUrls(STATIC_PATHS);
    const glossary = 'https://www.goplay.appcookies.com/glossary/en/term';
    const stagingOrigin = 'https://staging.example.test';
    const sitemapUrl = `${stagingOrigin}/sitemap.xml`;
    const startupEvents = [
        ['log', '🚀 [E2E] 正在验证 [staging] 环境的 sitemap.xml...'],
        ['log', `🔗 目标 URL: ${sitemapUrl}`],
    ];
    const extraQuery = `${new URL(expected[0]).origin}${new URL(expected[0]).pathname}?noncanonical=1`;
    const immediateFailures = [
        {
            name: '未知环境',
            options: { env: 'preview', fetchImpl: async () => assert.fail('不应请求 sitemap') },
            events: [['error', '❌ 未知环境: preview']],
        },
        {
            name: 'HTTP 失败',
            options: { env: 'staging', fetchImpl: async () => ({ ok: false, status: 500 }) },
            events: [...startupEvents, ['error', `❌ [失败] HTTP 500 ${sitemapUrl}`]],
        },
        {
            name: '网络异常',
            options: {
                env: 'staging',
                fetchImpl: async () => {
                    throw new Error('offline');
                },
            },
            events: [...startupEvents, ['error', `❌ [错误] ${sitemapUrl}: offline`]],
        },
        {
            name: 'XML 缺少基本结构',
            options: { env: 'staging', fetchImpl: async () => ({ ok: true, text: async () => '<urlset />' }) },
            events: [...startupEvents, ['error', '❌ [失败] sitemap.xml 内容无效（缺少 urlset/loc）']],
        },
        {
            name: 'XML 的 loc 集合为空',
            options: {
                env: 'staging',
                fetchImpl: async () => ({ ok: true, text: async () => '<urlset><loc> </loc></urlset>' }),
            },
            events: [
                ...startupEvents,
                ['log', '📄 sitemap.xml 共解析出 0 个 URL'],
                ['error', '❌ [失败] sitemap.xml 未包含任何 <loc>'],
            ],
        },
        {
            name: '缺少静态规范 URL',
            options: { env: 'staging', fetchImpl: successfulFetch([...expected.slice(1), glossary]) },
            events: [
                ...startupEvents,
                ['log', `📄 sitemap.xml 共解析出 ${expected.length} 个 URL`],
                ['error', `❌ [失败] sitemap.xml 缺少静态页规范 URL: ${expected[0]}`],
            ],
        },
        {
            name: '包含非规范静态 query',
            options: { env: 'staging', fetchImpl: successfulFetch([...expected, extraQuery, glossary]) },
            events: [
                ...startupEvents,
                ['log', `📄 sitemap.xml 共解析出 ${expected.length + 2} 个 URL`],
                [
                    'error',
                    `❌ [失败] sitemap.xml 静态 URL 集合不规范（期望 ${expected.length}，实际 ${
                        expected.length + 1
                    }）: ${extraQuery}`,
                ],
            ],
        },
        {
            name: '重复静态 URL 导致数量偏差',
            options: { env: 'staging', fetchImpl: successfulFetch([...expected, expected[0], glossary]) },
            events: [
                ...startupEvents,
                ['log', `📄 sitemap.xml 共解析出 ${expected.length + 2} 个 URL`],
                [
                    'error',
                    `❌ [失败] sitemap.xml 静态 URL 集合不规范（期望 ${expected.length}，实际 ${expected.length + 1}）`,
                ],
            ],
        },
        {
            name: '没有词条 URL',
            options: { env: 'staging', fetchImpl: successfulFetch(expected) },
            events: [
                ...startupEvents,
                ['log', `📄 sitemap.xml 共解析出 ${expected.length} 个 URL`],
                ['log', `✅ 静态页 ${expected.length} 条语言规范 URL 均精确出现在 sitemap.xml`],
                ['error', '❌ [失败] sitemap.xml 未包含词条 URL（/glossary/{zh|en}/...）'],
            ],
        },
    ];

    for (const { name, options, events } of immediateFailures) {
        it(`${name}立即失败、仅退出一次且不启动浏览器`, async () => {
            let launched = 0;
            const logger = captureLogger();
            const result = await runFromEntry(
                {
                    ...options,
                    launch: async () => {
                        launched += 1;
                        throw new Error('不应启动浏览器');
                    },
                },
                logger,
            );
            assert.deepEqual(result.statuses, [1]);
            assert.deepEqual(result.exits, [1]);
            assert.equal(launched, 0);
            assertLoggerEvents(logger, events);
        });
    }

    const sampled = [
        `${stagingOrigin}/glossary/zh/dezhoupuke`,
        `${stagingOrigin}/glossary/zh-TW/dezhoupuke`,
        `${stagingOrigin}/glossary/en/texasholdem`,
        `${stagingOrigin}/glossary/en/term`,
    ];
    const preparedEvents = [
        ...startupEvents,
        ['log', `📄 sitemap.xml 共解析出 ${expected.length + 1} 个 URL`],
        ['log', `✅ 静态页 ${expected.length} 条语言规范 URL 均精确出现在 sitemap.xml`],
        ['log', `📚 词条抽查 ${sampled.length} 个（必测 + 随机补充，上限 10；池 1）`],
    ];

    for (const hasIssues of [true, false]) {
        it(`${hasIssues ? '逐页失败累计后' : '零问题时'}输出完整日志并仅退出一次`, async () => {
            let closed = 0;
            const visited = [];
            const logger = captureLogger();
            const page = {
                goto: async (url, options) => {
                    assert.deepEqual(options, { waitUntil: 'load', timeout: 60000 });
                    visited.push(url);
                    if (hasIssues && url === sampled[0]) return null;
                    if (hasIssues && url === sampled[1]) return { status: () => 404 };
                    if (hasIssues && url === sampled[3]) throw new Error('navigation failed');
                    return { status: () => 200 };
                },
            };
            const mountedAssertion = async (_page, pathname) => ({
                mounted: !hasIssues || pathname !== '/glossary/en/texasholdem',
                label: '#app',
            });
            const result = await runFromEntry(
                {
                    env: 'staging',
                    fetchImpl: successfulFetch([...expected, glossary]),
                    launch: async () => ({
                        newPage: async () => page,
                        close: async () => {
                            closed += 1;
                        },
                    }),
                    pageChecker: (pageToCheck, url) => checkGlossaryPage(pageToCheck, url, mountedAssertion, logger),
                },
                logger,
            );
            const pageEvents = hasIssues
                ? [
                      ['log', `🔎 正在检查: ${sampled[0]}`],
                      ['error', `❌ [请求失败] ${sampled[0]} (无响应)`],
                      ['log', `🔎 正在检查: ${sampled[1]}`],
                      ['error', `❌ [HTTP 404] ${sampled[1]}`],
                      ['log', `🔎 正在检查: ${sampled[2]}`],
                      ['error', `❌ [渲染错误] ${sampled[2]} (未找到 #app)`],
                      ['log', `🔎 正在检查: ${sampled[3]}`],
                      ['error', `❌ [错误] ${sampled[3]}: navigation failed`],
                  ]
                : sampled.flatMap((url) => [
                      ['log', `🔎 正在检查: ${url}`],
                      ['log', `✅ [正常] ${url}`],
                  ]);
            const expectedStatus = hasIssues ? 1 : 0;
            const issueCount = hasIssues ? 4 : 0;
            const finalEvents = [
                ['log', '\n🏁 [SITEMAP] 检查完成。'],
                ['log', `⚠️ 发现的问题数: ${issueCount}`],
                ...(!hasIssues ? [['log', '✅ [成功] sitemap.xml 可访问，抽样词条均返回 200 且 SPA 已挂载']] : []),
            ];
            assert.deepEqual(result.statuses, [expectedStatus]);
            assert.deepEqual(result.exits, [expectedStatus]);
            assert.deepEqual(visited, sampled);
            assert.equal(closed, 1);
            assertLoggerEvents(logger, [...preparedEvents, ...pageEvents, ...finalEvents]);
        });
    }

    it('致命异常输出完整兜底日志并仅失败退出一次', async () => {
        const exits = [];
        const logger = captureLogger();
        const fatalError = new Error('fatal');
        await main(
            async () => {
                throw fatalError;
            },
            (code) => exits.push(code),
            logger,
        );
        assert.deepEqual(exits, [1]);
        assertLoggerEvents(logger, [['error', '致命错误:', fatalError]]);
    });
});
