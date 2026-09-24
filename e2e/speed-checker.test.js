const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_BUDGET_MS,
    DEFAULT_FEEDBACK_BUDGET_MS,
    NAV_SPEED_PATHS,
    SLOW_3G,
    parseBudgetMs,
    parseFeedbackBudgetMs,
    median,
    isWithinBudget,
} = require('./speed-checker');

describe('speed-checker helpers', () => {
    it('DEFAULT_BUDGET_MS 为 3000', () => {
        assert.equal(DEFAULT_BUDGET_MS, 3000);
    });

    it('DEFAULT_FEEDBACK_BUDGET_MS 为 300', () => {
        assert.equal(DEFAULT_FEEDBACK_BUDGET_MS, 300);
    });

    it('parseBudgetMs 空值回退默认预算', () => {
        assert.equal(parseBudgetMs(undefined), 3000);
        assert.equal(parseBudgetMs(''), 3000);
        assert.equal(parseBudgetMs(undefined, 5000), 5000);
    });

    it('parseBudgetMs 解析正整数', () => {
        assert.equal(parseBudgetMs('3000'), 3000);
        assert.equal(parseBudgetMs('5000'), 5000);
        assert.equal(parseBudgetMs('12000'), 12000);
    });

    it('parseBudgetMs 拒绝非正整数', () => {
        assert.throws(() => parseBudgetMs('0'), /正整数/);
        assert.throws(() => parseBudgetMs('-1'), /正整数/);
        assert.throws(() => parseBudgetMs('abc'), /正整数/);
    });

    it('parseFeedbackBudgetMs 空值回退默认预算', () => {
        assert.equal(parseFeedbackBudgetMs(undefined), 300);
        assert.equal(parseFeedbackBudgetMs(''), 300);
        assert.equal(parseFeedbackBudgetMs('500'), 500);
    });

    it('parseFeedbackBudgetMs 拒绝非正整数', () => {
        assert.throws(() => parseFeedbackBudgetMs('0'), /正整数/);
        assert.throws(() => parseFeedbackBudgetMs('x'), /正整数/);
    });

    it('median 对奇数长度取中间值', () => {
        assert.equal(median([3, 1, 2]), 2);
        assert.equal(median([100, 300, 200]), 200);
    });

    it('median 对偶数长度取中间两值平均并四舍五入', () => {
        assert.equal(median([1, 2]), 2);
        assert.equal(median([10, 20, 30, 40]), 25);
    });

    it('median 拒绝空数组', () => {
        assert.throws(() => median([]), /非空/);
    });

    it('isWithinBudget 边界：等于预算算通过', () => {
        assert.equal(isWithinBudget(3000, 3000), true);
        assert.equal(isWithinBudget(2999, 3000), true);
        assert.equal(isWithinBudget(3001, 3000), false);
    });

    it('SLOW_3G 配置含延迟与吞吐限制', () => {
        assert.equal(SLOW_3G.offline, false);
        assert.ok(SLOW_3G.latency > 0);
        assert.ok(SLOW_3G.downloadThroughput > 0);
        assert.ok(SLOW_3G.uploadThroughput > 0);
    });

    it('NAV_SPEED_PATHS 覆盖学习与术语表桌面导航及命名 chunk', () => {
        assert.equal(NAV_SPEED_PATHS.length, 2);
        const learning = NAV_SPEED_PATHS.find((p) => p.pathname === '/learning');
        const glossary = NAV_SPEED_PATHS.find((p) => p.pathname === '/glossary');
        assert.ok(learning);
        assert.ok(glossary);
        assert.equal(learning.navTestId, 'navbar-link-navbar_learning');
        assert.equal(glossary.navTestId, 'navbar-link-navbar_terminology_list');
        assert.equal(typeof learning.ready, 'function');
        assert.equal(typeof glossary.ready, 'function');
        assert.match(learning.chunkGlob, /learning/);
        assert.match(glossary.chunkGlob, /glossary/);
    });
});
