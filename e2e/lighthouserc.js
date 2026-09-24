/**
 * Lighthouse CI 配置：非 master 分支的移动端冷启动 Performance 门禁。
 * @see https://googlechrome.github.io/lighthouse-ci/docs/configuration.html
 *
 * CI 审计已部署的 staging 站点。
 */

const path = require('path');
const { ENV, URLS } = require('./env');
const { MULTIPLIER_ENV_VAR, parseMultiplierOverride } = require('./lighthouse-cpu-throttling');

const AUDIT_URL_ENV_VAR = 'LIGHTHOUSE_AUDIT_URL';

/**
 * 移动端冷启动 Performance 中位数下限（回归门禁）。
 *
 * 保留校准前已经使用的 0.45。此前提议的 0.55 来自有效 benchmarkIndex 大幅
 * 漂移的报告，不能作为已验证的新基线；只有逐次校准在多条独立流水线稳定后，
 * 才能另行调整阈值。
 */
const MIN_PERFORMANCE_SCORE = 0.45;

/**
 * CPU 降速倍数由 lighthouse-ci.js 在每次审计前校准后经环境变量传入。
 * 缺少或写错变量时必须停止；固定 4 倍在高速宿主机上会放宽门禁，不是安全回退。
 */
const cpuSlowdownMultiplier = parseMultiplierOverride(process.env[MULTIPLIER_ENV_VAR]);
if (cpuSlowdownMultiplier === null) {
    throw new Error(`lighthouserc: 请通过 lighthouse-ci.js 提供有效的 ${MULTIPLIER_ENV_VAR}`);
}

const baseUrl = URLS[ENV];
if (!baseUrl) {
    throw new Error(`lighthouserc: 未知环境 ${ENV}`);
}

const origin = baseUrl.replace(/\/$/, '');
const auditUrl = process.env[AUDIT_URL_ENV_VAR];

module.exports = {
    AUDIT_URL_ENV_VAR,
    MIN_PERFORMANCE_SCORE,
    cpuSlowdownMultiplier,
    ci: {
        collect: {
            url: auditUrl ? [auditUrl] : [`${origin}/learning`, `${origin}/glossary`],
            numberOfRuns: auditUrl ? 1 : 3,
            chromePath: process.env.CHROME_PATH,
            settings: {
                // 显式锁定 Lighthouse 标准移动端（Slow 4G）模型，避免版本默认值漂移。
                formFactor: 'mobile',
                throttlingMethod: 'simulate',
                throttling: {
                    rttMs: 150,
                    throughputKbps: 1638.4,
                    cpuSlowdownMultiplier,
                },
                screenEmulation: {
                    mobile: true,
                    width: 412,
                    height: 823,
                    deviceScaleFactor: 1.75,
                    disabled: false,
                },
                emulatedUserAgent:
                    'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36',
                onlyCategories: ['performance'],
                chromeFlags: '--no-sandbox --disable-dev-shm-usage --disable-gpu',
            },
        },
        assert: {
            assertions: {
                // 中位数 Performance ≥ MIN_PERFORMANCE_SCORE（LHCI 对多次运行取中位数后断言）
                // LCP/TBT 的绝对毫秒值会计入共享 CI worker 上 Chrome 与本地静态服务器的
                // 调度抖动；Performance 总分已按同一移动端模型聚合这些指标，因此以它作为
                // 稳定的回归门禁。
                'categories:performance': ['error', { minScore: MIN_PERFORMANCE_SCORE, aggregationMethod: 'median' }],
                'categories:accessibility': 'off',
                'categories:best-practices': 'off',
                'categories:seo': 'off',
                'categories:pwa': 'off',
            },
        },
        upload: {
            target: 'filesystem',
            outputDir: path.join(__dirname, 'ci-artifacts', 'lighthouse'),
            reportFilenamePattern: '%%PATHNAME%%-%%DATETIME%%.%%EXTENSION%%',
        },
    },
};
