const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { describe, it } = require('node:test');
const glossarySlugMap = require('./fixtures/glossarySlugMap.generated.json');
const {
    MISSING_EN_ALTERNATE_TERM,
    buildMissingEnglishAlternateSourcePath,
    main,
    run,
    __test,
} = require('./language-checker');

function landingFixture(overrides = {}) {
    let closeCount = 0;
    const context = { close: async () => closeCount++ };
    const active = {
        enPressed: true,
        zhPressed: false,
        zhTWPressed: false,
        docLang: 'en',
        homeLinkText: 'Home',
        ...overrides.active,
    };
    const browser = { newContext: async () => context };
    const deps = {
        openLangQueryLanding: async () => ({}),
        getActiveLocale: async () => active,
        getLanguageCookie: async () => ({ value: 'en', secure: true, ...overrides.cookie }),
        ...overrides.deps,
    };
    return { browser, deps, getCloseCount: () => closeCount };
}

describe('language-checker 无英文对照测试夹具', () => {
    it('使用当前 slug map 中真实存在且没有英文映射的中文词条', () => {
        assert.equal(MISSING_EN_ALTERNATE_TERM, 'bodongpianli');
        assert.equal(
            buildMissingEnglishAlternateSourcePath(MISSING_EN_ALTERNATE_TERM, glossarySlugMap),
            '/glossary/zh/bodongpianli',
        );
    });

    it('拒绝把已有英文映射的词条当作降级场景', () => {
        assert.throws(
            () => buildMissingEnglishAlternateSourcePath('aqiangjian', glossarySlugMap),
            /已映射到英文 slug ace/,
        );
    });
});

describe('language-checker exit status', () => {
    it('模拟语言断言失败时以非零状态退出', () => {
        const checkerPath = path.join(__dirname, 'language-checker.js');
        const script = `const { main } = require(${JSON.stringify(checkerPath)}); void main(async () => 1);`;
        const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });

        assert.equal(result.status, 1, result.stderr || result.stdout);
    });
});

describe('language-checker ?lang= 深链场景', () => {
    it('成功时返回零且 context 只关闭一次', async () => {
        const fixture = landingFixture();
        assert.equal(await __test.assertLangQueryLanding(fixture.browser, 'en', {}, fixture.deps), 0);
        assert.equal(fixture.getCloseCount(), 1);
    });

    it('独立累计按钮、document.lang、cookie、Secure 与可选文案问题', () => {
        const active = { enPressed: false, zhPressed: true, zhTWPressed: false, docLang: 'zh', homeLinkText: '首页' };
        assert.equal(
            __test.assertLandingState(active, { value: 'zh', secure: false }, 'en', { homeLinkText: 'Home' }),
            5,
        );
    });

    it('undefined 或 null 首页文案不触发断言', () => {
        const active = { enPressed: true, zhPressed: false, zhTWPressed: false, docLang: 'en', homeLinkText: '错误' };
        assert.equal(__test.assertLandingState(active, { value: 'en', secure: true }, 'en', {}), 0);
        assert.equal(__test.assertLandingState(active, { value: 'en', secure: true }, 'en', { homeLinkText: null }), 0);
    });

    it('导航或等待抛错时计入问题并关闭 context', async () => {
        const fixture = landingFixture({
            deps: {
                openLangQueryLanding: async () => {
                    throw new Error('timeout');
                },
            },
        });
        assert.equal(await __test.assertLangQueryLanding(fixture.browser, 'en', {}, fixture.deps), 1);
        assert.equal(fixture.getCloseCount(), 1);
    });
});

describe('language-checker 阶段编排与资源清理', () => {
    const stageNames = [
        'checkInitialHomeState',
        'clickEnglishAndCheck',
        'reloadEnglishAndCheck',
        'clickTraditionalChineseAndCheck',
        'reloadTraditionalAndSwitchToChinese',
        'runCrossPageLanguageCheck',
        'runTutorialLanguageChecks',
        'runGlossarySlugLanguageChecks',
        'runGlossaryMissingAlternateCheck',
    ];

    function runFixture(failingStage, throws = false) {
        const calls = [];
        const context = {
            newPage: async () => ({}),
            close: async () => calls.push('context.close'),
        };
        const browser = {
            newContext: async () => context,
            close: async () => calls.push('browser.close'),
        };
        const deps = {
            launchBrowser: async () => browser,
            runLangQueryLandingChecks: async () => {
                calls.push('landing');
                return 0;
            },
        };
        for (const name of stageNames) {
            deps[name] = async () => {
                calls.push(name);
                if (name === failingStage && throws) throw new Error('stage error');
                return name === failingStage ? 1 : 0;
            };
        }
        return { calls, deps };
    }

    it('严格顺序执行并在普通问题后停止', async () => {
        const fixture = runFixture('reloadEnglishAndCheck');
        assert.equal(await run(fixture.deps), 1);
        assert.deepEqual(fixture.calls, [
            'landing',
            'checkInitialHomeState',
            'clickEnglishAndCheck',
            'reloadEnglishAndCheck',
            'context.close',
            'browser.close',
        ]);
    });

    it('阶段抛错仍先关闭主 context，再关闭 browser，且各一次', async () => {
        const fixture = runFixture('clickTraditionalChineseAndCheck', true);
        assert.equal(await run(fixture.deps), 1);
        assert.deepEqual(fixture.calls.slice(-2), ['context.close', 'browser.close']);
        assert.equal(fixture.calls.filter((item) => item === 'context.close').length, 1);
        assert.equal(fixture.calls.filter((item) => item === 'browser.close').length, 1);
    });

    it('main 将浏览器启动异常转换为非零退出状态', async () => {
        const previous = process.exitCode;
        await main(() => run({ launchBrowser: async () => Promise.reject(new Error('launch failed')) }));
        assert.equal(process.exitCode, 1);
        process.exitCode = previous;
    });
});
