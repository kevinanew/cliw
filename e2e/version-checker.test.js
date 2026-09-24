const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { isValidBuildVersion, run } = require('./version-checker');

function createHarness({ buildVersion = 'staging - abc1234 - now', failure } = {}) {
    const calls = { goto: [], eval: [], evaluate: 0, close: 0, log: [], error: [], exit: [] };
    const page = {
        goto: async (...args) => {
            calls.goto.push(args);
            if (failure === 'goto') throw new Error('navigation failed');
        },
        $eval: async (...args) => {
            calls.eval.push(args);
            if (failure === 'meta') throw new Error('meta missing');
            return buildVersion;
        },
        evaluate: async () => {
            calls.evaluate += 1;
            return '<meta charset="utf-8">';
        },
    };
    const browser = {
        newPage: async () => page,
        close: async () => {
            calls.close += 1;
        },
    };
    const options = {
        env: 'staging',
        startUrl: 'https://staging.example.test/',
        browserType: { launch: async () => browser },
        log: (message) => calls.log.push(message),
        error: (message) => calls.error.push(message),
        exit: (code) => calls.exit.push(code),
    };
    return { calls, options };
}

describe('isValidBuildVersion', () => {
    it('接受合法构建版本', () => {
        assert.equal(isValidBuildVersion('staging - abc1234 - 2026-09-06', 'staging'), true);
    });

    it('拒绝环境不匹配', () => {
        assert.equal(isValidBuildVersion('production - abc1234 - now', 'staging'), false);
    });

    it('拒绝 unknown SHA', () => {
        assert.equal(isValidBuildVersion('staging - unknown - now', 'staging'), false);
    });

    it('拒绝缺失值和不合法格式', () => {
        assert.equal(isValidBuildVersion(null, 'staging'), false);
        assert.equal(isValidBuildVersion('staging - abc1234', 'staging'), false);
        assert.equal(isValidBuildVersion('abc1234 - now', 'staging'), false);
    });

    it('大小写不敏感', () => {
        assert.equal(isValidBuildVersion('STAGING - ABC1234 - NOW', 'StAgInG'), true);
    });
});

describe('version checker orchestration', () => {
    it('合法 meta 成功退出并关闭 browser', async () => {
        const { calls, options } = createHarness();

        const success = await run(options);

        assert.equal(success, true);
        assert.deepEqual(calls.exit, [0]);
        assert.equal(calls.close, 1);
        assert.match(calls.log.at(-1), /在 meta 标签中找到了构建版本号/);
    });

    it('meta 缺失时将 $eval 异常视为 null，输出调试信息并失败退出', async () => {
        const { calls, options } = createHarness({ failure: 'meta' });

        const success = await run(options);

        assert.equal(success, false);
        assert.deepEqual(calls.exit, [1]);
        assert.equal(calls.close, 1);
        assert.equal(calls.evaluate, 1);
        assert.deepEqual(calls.error, ['❌ [失败] 未在 meta 标签中找到构建版本号，或其格式无效。']);
        assert.equal(calls.log.at(-1), '<meta charset="utf-8">');
    });

    it('页面操作异常时仍关闭 browser 并以失败码退出', async () => {
        const { calls, options } = createHarness({ failure: 'goto' });

        const success = await run(options);

        assert.equal(success, false);
        assert.equal(calls.close, 1);
        assert.deepEqual(calls.exit, [1]);
        assert.deepEqual(calls.error, ['❌ [错误] https://staging.example.test/: navigation failed']);
    });
});
