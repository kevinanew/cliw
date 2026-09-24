const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    buildExpectedCanonicalUrl,
    buildExpectedHreflangAlternates,
    getExpectedLocaleFromSearch,
    parseGlossaryDefinitionPath,
    validateCanonical,
    validateHreflangAlternates,
    validateSeoSnapshot,
    urlsEqual,
} = require('./seo-checker');

const ORIGIN = 'https://www.goplay.appcookies.com';

describe('seo-checker helpers', () => {
    it('parseGlossaryDefinitionPath 识别词条详情 path', () => {
        assert.deepEqual(parseGlossaryDefinitionPath('/glossary/zh/banzhahu'), {
            locale: 'zh',
            term: 'banzhahu',
        });
        assert.deepEqual(parseGlossaryDefinitionPath('/glossary/en/bluff'), {
            locale: 'en',
            term: 'bluff',
        });
        assert.equal(parseGlossaryDefinitionPath('/glossary'), null);
        assert.equal(parseGlossaryDefinitionPath('/'), null);
    });

    it('buildExpectedCanonicalUrl 让普通页包含语言、词条页保留路径 locale', () => {
        assert.equal(buildExpectedCanonicalUrl('/', 'en', ORIGIN), `${ORIGIN}/?lang=en`);
        assert.equal(buildExpectedCanonicalUrl('/tutorial', 'zh-TW', ORIGIN), `${ORIGIN}/tutorial?lang=zh-TW`);
        assert.equal(
            buildExpectedCanonicalUrl('/glossary/zh/banzhahu', 'en', ORIGIN),
            `${ORIGIN}/glossary/zh/banzhahu`,
        );
    });

    it('词条页 hreflang 按 slug 映射指向各 locale（与 buildHreflangAlternates 一致）', () => {
        assert.deepEqual(buildExpectedHreflangAlternates('/glossary/zh/banzhahu', ORIGIN), [
            { hreflang: 'zh', href: `${ORIGIN}/glossary/zh/banzhahu` },
            { hreflang: 'zh-TW', href: `${ORIGIN}/glossary/zh-TW/banzhahu` },
            { hreflang: 'en', href: `${ORIGIN}/glossary/en/semibluff` },
            { hreflang: 'x-default', href: `${ORIGIN}/glossary/zh/banzhahu` },
        ]);

        assert.deepEqual(buildExpectedHreflangAlternates('/glossary/en/button', ORIGIN), [
            { hreflang: 'zh', href: `${ORIGIN}/glossary/zh/anniuanniuwei` },
            { hreflang: 'zh-TW', href: `${ORIGIN}/glossary/zh-TW/anniuanniuwei` },
            { hreflang: 'en', href: `${ORIGIN}/glossary/en/button` },
            { hreflang: 'x-default', href: `${ORIGIN}/glossary/zh/anniuanniuwei` },
        ]);
    });

    it('无 en 映射时省略 en hreflang', () => {
        // aqiangjian 已显式审核为 Ace，不再是“无 en 映射”样例；
        // zizhu 在源映射中显式保持无精确英文对应。
        const alternates = buildExpectedHreflangAlternates('/glossary/zh/zizhu', ORIGIN);
        assert.deepEqual(
            alternates.map((item) => item.hreflang),
            ['zh', 'zh-TW', 'x-default'],
        );
        assert.equal(
            alternates.find((item) => item.hreflang === 'en'),
            undefined,
        );
    });

    it('无跨 locale 映射的词条页仅保留 self + x-default', () => {
        // call 已显式审核为“跟注”，继续用真实词条作 fallback 夹具会在后续审核时反复失效。
        // 使用专用合成 slug 只验证“slug map 无此 key”的分支，不与术语映射完善相冲突。
        const unmappedPath = '/glossary/en/seo-checker-unmapped-fixture';
        assert.deepEqual(buildExpectedHreflangAlternates(unmappedPath, ORIGIN), [
            { hreflang: 'en', href: `${ORIGIN}${unmappedPath}` },
            { hreflang: 'x-default', href: `${ORIGIN}${unmappedPath}` },
        ]);
    });

    it('非词条页回退到 ?lang= alternate', () => {
        assert.deepEqual(buildExpectedHreflangAlternates('/glossary', ORIGIN), [
            { hreflang: 'zh', href: `${ORIGIN}/glossary?lang=zh` },
            { hreflang: 'zh-TW', href: `${ORIGIN}/glossary?lang=zh-TW` },
            { hreflang: 'en', href: `${ORIGIN}/glossary?lang=en` },
            { hreflang: 'x-default', href: `${ORIGIN}/glossary?lang=zh` },
        ]);
    });

    it('urlsEqual 比较 origin/path/search', () => {
        assert.equal(urlsEqual(`${ORIGIN}/glossary/zh/banzhahu`, `${ORIGIN}/glossary/zh/banzhahu`), true);
        assert.equal(urlsEqual(`${ORIGIN}/glossary/zh/banzhahu?lang=zh`, `${ORIGIN}/glossary/zh/banzhahu`), false);
    });

    it('lang 参数名解析与 Nginx $arg_lang 的边界一致', () => {
        assert.equal(getExpectedLocaleFromSearch('?LANG=en'), 'en');
        assert.equal(getExpectedLocaleFromSearch('?lang=%45%4E'), 'en');
        assert.equal(getExpectedLocaleFromSearch('?l%61ng=en'), 'zh');
        assert.equal(getExpectedLocaleFromSearch('?lang=fr'), 'zh');
    });

    describe('validateHreflangAlternates', () => {
        const expected = [
            { hreflang: 'zh', href: `${ORIGIN}/tutorial?lang=zh` },
            { hreflang: 'en', href: `${ORIGIN}/tutorial?lang=en` },
        ];

        it('完整且唯一的集合通过', () => {
            assert.deepEqual(validateHreflangAlternates(expected, expected), []);
        });

        for (const testCase of [
            {
                name: '缺失语言',
                actual: [expected[0]],
                diagnostic: 'hreflang="en" 出现 0 次，期望恰好 1 次',
            },
            {
                name: '重复语言',
                actual: [expected[0], expected[0], expected[1]],
                diagnostic: 'hreflang="zh" 出现 2 次，期望恰好 1 次',
            },
            {
                name: '额外语言',
                actual: [...expected, { hreflang: 'fr', href: `${ORIGIN}/tutorial?lang=fr` }],
                diagnostic: '出现未预期的 hreflang="fr"',
            },
        ]) {
            it(`${testCase.name}产生对应诊断`, () => {
                assert.ok(validateHreflangAlternates(testCase.actual, expected).includes(testCase.diagnostic));
            });
        }

        for (const testCase of [
            { name: 'origin', href: 'https://example.com/tutorial?lang=zh' },
            { name: 'pathname', href: `${ORIGIN}/wrong?lang=zh` },
            { name: 'search', href: `${ORIGIN}/tutorial?lang=en` },
        ]) {
            it(`${testCase.name} 不匹配时失败`, () => {
                const issues = validateHreflangAlternates([{ hreflang: 'zh', href: testCase.href }], [expected[0]]);
                assert.match(issues.join('\n'), /href=.*，期望/);
            });
        }

        it('仅 hash 不同时通过', () => {
            const actual = [{ ...expected[0], href: `${expected[0].href}#section` }];
            assert.deepEqual(validateHreflangAlternates(actual, [expected[0]]), []);
        });

        it('无效 href 产生无效 URL 诊断', () => {
            const issues = validateHreflangAlternates([{ hreflang: 'zh', href: 'not a URL' }], [expected[0]]);
            assert.deepEqual(issues, ['hreflang="zh" href 无效: not a URL']);
        });
    });

    describe('validateCanonical', () => {
        const canonical = `${ORIGIN}/tutorial?lang=zh`;

        for (const testCase of [
            { name: '零个', actual: [], diagnostic: 'canonical 出现 0 次，期望恰好 1 次' },
            { name: '多个', actual: [canonical, canonical], diagnostic: 'canonical 出现 2 次，期望恰好 1 次' },
            {
                name: '域名不匹配',
                actual: ['https://example.com/tutorial?lang=zh'],
                diagnostic: 'canonical 域名为 example.com，期望与环境匹配为 www.goplay.appcookies.com',
            },
            {
                name: '目标不匹配',
                actual: [`${ORIGIN}/wrong?lang=zh`],
                diagnostic: `canonical 为 ${ORIGIN}/wrong?lang=zh，期望 ${canonical}`,
            },
            { name: 'href 无效', actual: ['not a URL'], diagnostic: 'canonical href 无效: not a URL' },
        ]) {
            it(`${testCase.name}时失败`, () => {
                assert.ok(
                    validateCanonical(testCase.actual, canonical, 'www.goplay.appcookies.com').includes(
                        testCase.diagnostic,
                    ),
                );
            });
        }
    });

    it('正常编排结果保留计数和首个 canonical', () => {
        const alternates = [{ hreflang: 'zh', href: `${ORIGIN}/?lang=zh` }];
        const canonical = `${ORIGIN}/?lang=zh`;
        assert.deepEqual(
            validateSeoSnapshot(
                { alternates, canonicals: [canonical] },
                { alternates, canonical, host: 'www.goplay.appcookies.com' },
            ),
            { issues: [], hreflangCount: 1, canonical },
        );
    });
});
