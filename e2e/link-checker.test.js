const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { buildInternalOnlySkipPattern, buildLinkinatorCommand, run } = require('./link-checker');

function createLogger() {
    const logs = [];
    const errors = [];
    return { logs, errors, log: (message) => logs.push(message), error: (message) => errors.push(message) };
}

describe('link-checker skip pattern', () => {
    it('转义 origin 中的点，并丢弃路径、查询和 hash', () => {
        assert.equal(
            buildInternalOnlySkipPattern('https://www.example.com/some/path?from=test#section'),
            '^(?!https://www\\.example\\.com)',
        );
    });

    it('生成的正则放行站内 URL，并拦截站外 URL', () => {
        const shouldSkip = new RegExp(buildInternalOnlySkipPattern('https://www.example.com/start'));

        assert.equal(shouldSkip.test('https://www.example.com/'), false);
        assert.equal(shouldSkip.test('https://www.example.com/glossary?lang=zh'), false);
        assert.equal(shouldSkip.test('https://external.example.org/page'), true);
        assert.equal(shouldSkip.test('http://www.example.com/insecure'), true);
    });

    it('正确处理带端口的 development origin', () => {
        const shouldSkip = new RegExp(buildInternalOnlySkipPattern('http://localhost:8080/app?debug=1'));

        assert.equal(shouldSkip.test('http://localhost:8080/'), false);
        assert.equal(shouldSkip.test('http://localhost:8080/tutorial'), false);
        assert.equal(shouldSkip.test('http://localhost:3000/tutorial'), true);
        assert.equal(shouldSkip.test('https://localhost:8080/tutorial'), true);
    });
});

describe('link-checker command and orchestration', () => {
    it('构造 linkinator 命令参数', () => {
        const command = buildLinkinatorCommand('https://www.example.com/', '/tmp/linkinator');

        assert.deepEqual(command, {
            command: '/tmp/linkinator',
            args: [
                'https://www.example.com/',
                '--recurse',
                '--timeout',
                '30000',
                '--concurrency',
                '10',
                '--skip',
                '^(?!https://www\\.example\\.com)',
            ],
            options: { stdio: 'inherit' },
        });
    });

    it('把构造出的参数传给 spawnSync，并返回成功状态', () => {
        const calls = [];
        const logger = createLogger();
        const status = run({
            env: 'test',
            urls: { test: 'https://www.example.com/' },
            linkinatorBin: '/tmp/linkinator',
            logger,
            spawnSync: (...args) => {
                calls.push(args);
                return { status: 0 };
            },
        });

        assert.equal(status, 0);
        assert.deepEqual(calls, [
            [
                '/tmp/linkinator',
                [
                    'https://www.example.com/',
                    '--recurse',
                    '--timeout',
                    '30000',
                    '--concurrency',
                    '10',
                    '--skip',
                    '^(?!https://www\\.example\\.com)',
                ],
                { stdio: 'inherit' },
            ],
        ]);
        assert.equal(logger.logs.at(-1), '\n✅ 所有站内链接均有效！');
    });

    it('未知环境时不启动 linkinator 并返回失败退出码', () => {
        const logger = createLogger();
        let spawnCalls = 0;
        const status = run({
            env: 'unknown',
            urls: {},
            logger,
            spawnSync: () => {
                spawnCalls += 1;
            },
        });

        assert.equal(status, 1);
        assert.equal(spawnCalls, 0);
        assert.deepEqual(logger.errors, ['❌ 未知环境: unknown']);
    });

    it('传递 linkinator 的非零退出码', () => {
        const logger = createLogger();
        const status = run({
            env: 'test',
            urls: { test: 'https://www.example.com/' },
            logger,
            spawnSync: () => ({ status: 7 }),
        });

        assert.equal(status, 7);
        assert.deepEqual(logger.errors, ['\n❌ 链接检查器发现了损坏的链接。']);
    });

    it('linkinator 没有退出码时回退为 1', () => {
        assert.equal(
            run({
                env: 'test',
                urls: { test: 'https://www.example.com/' },
                logger: createLogger(),
                spawnSync: () => ({ status: null }),
            }),
            1,
        );
    });
});
