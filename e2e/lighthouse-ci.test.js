const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MULTIPLIER_ENV_VAR } = require('./lighthouse-cpu-throttling');
const {
    buildAuditUrls,
    clearLhrReports,
    collectCalibratedAudit,
    resolveBaseUrl,
    ensureOutputDir,
    OUTPUT_DIR,
} = require('./lighthouse-ci');
const previousMultiplier = process.env[MULTIPLIER_ENV_VAR];
process.env[MULTIPLIER_ENV_VAR] = '4';
const lighthouseConfig = require('./lighthouserc');
if (previousMultiplier === undefined) {
    delete process.env[MULTIPLIER_ENV_VAR];
} else {
    process.env[MULTIPLIER_ENV_VAR] = previousMultiplier;
}
const { MIN_PERFORMANCE_SCORE } = lighthouseConfig;

describe('lighthouse-ci helpers', () => {
    it('buildAuditUrls 生成 /learning 与 /glossary', () => {
        assert.deepEqual(buildAuditUrls('https://staging.example.test/'), [
            'https://staging.example.test/learning',
            'https://staging.example.test/glossary',
        ]);
        assert.deepEqual(buildAuditUrls('https://www.goplay.appcookies.com'), [
            'https://www.goplay.appcookies.com/learning',
            'https://www.goplay.appcookies.com/glossary',
        ]);
    });

    it('resolveBaseUrl 按环境解析，未知环境抛错', () => {
        assert.equal(resolveBaseUrl('staging'), 'https://staging.example.test/');
        assert.equal(resolveBaseUrl('production'), 'https://www.goplay.appcookies.com/');
        assert.throws(() => resolveBaseUrl('nope'), /未知环境/);
    });

    it('development 审计 URL 与 Lighthouse 服务端口一致', () => {
        assert.equal(resolveBaseUrl('development'), `http://127.0.0.1:${process.env.LIGHTHOUSE_PORT || '8080'}/`);
    });

    it('ensureOutputDir 创建制品目录', () => {
        const dir = path.join(os.tmpdir(), `lhci-test-${Date.now()}`);
        const created = ensureOutputDir(dir);
        assert.equal(created, dir);
        assert.ok(fs.statSync(dir).isDirectory());
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('默认 OUTPUT_DIR 落在 e2e/ci-artifacts/lighthouse', () => {
        assert.ok(OUTPUT_DIR.endsWith(path.join('e2e', 'ci-artifacts', 'lighthouse')));
    });

    it('Performance 门禁使用标准移动端网络模型并对三次运行取中位数', () => {
        assert.equal(MIN_PERFORMANCE_SCORE, 0.45);
        assert.equal(lighthouseConfig.ci.collect.numberOfRuns, 3);
        assert.equal(lighthouseConfig.ci.collect.settings.throttlingMethod, 'simulate');
        assert.deepEqual(lighthouseConfig.ci.collect.settings.throttling, {
            rttMs: 150,
            throughputKbps: 1638.4,
            // 网络模型固定，CPU 降速按宿主机速度校准（见 lighthouse-cpu-throttling.js）。
            cpuSlowdownMultiplier: lighthouseConfig.cpuSlowdownMultiplier,
        });
        assert.deepEqual(lighthouseConfig.ci.assert.assertions['categories:performance'], [
            'error',
            { minScore: MIN_PERFORMANCE_SCORE, aggregationMethod: 'median' },
        ]);
        assert.equal(lighthouseConfig.ci.assert.assertions['largest-contentful-paint'], undefined);
        assert.equal(lighthouseConfig.ci.assert.assertions['total-blocking-time'], undefined);
        assert.equal(lighthouseConfig.ci.assert.assertions['cumulative-layout-shift'], undefined);
    });

    it('CPU 降速倍数必须由配对校准提供，不允许固定倍数回退', () => {
        const configPath = require.resolve('./lighthouserc');

        for (const [raw, expected] of [
            [undefined, null],
            ['1.2', 1.2],
            ['not-a-number', null],
        ]) {
            const previous = process.env[MULTIPLIER_ENV_VAR];
            if (raw === undefined) {
                delete process.env[MULTIPLIER_ENV_VAR];
            } else {
                process.env[MULTIPLIER_ENV_VAR] = raw;
            }

            delete require.cache[configPath];
            if (expected === null) {
                assert.throws(() => require('./lighthouserc'), new RegExp(MULTIPLIER_ENV_VAR));
            } else {
                const reloaded = require('./lighthouserc');
                assert.equal(reloaded.ci.collect.settings.throttling.cpuSlowdownMultiplier, expected);
            }

            if (previous === undefined) {
                delete process.env[MULTIPLIER_ENV_VAR];
            } else {
                process.env[MULTIPLIER_ENV_VAR] = previous;
            }
        }

        delete require.cache[configPath];
    });

    it('首次校准只采集一份报告，并保持命令、校验顺序、返回值和成功日志', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-success-test-'));
        const events = [];
        const logs = [];
        const calibration = {
            benchmarkIndex: 700,
            multiplier: 1.3,
            effectiveBenchmarkIndex: 538.5,
            usedStricterEffectiveSpeed: false,
        };

        try {
            fs.writeFileSync(path.join(dir, 'lhr-900.json'), '{}');
            fs.writeFileSync(path.join(dir, 'lhr-900.html'), '<html>old</html>');
            const result = await collectCalibratedAudit({
                url: 'http://127.0.0.1:8080/glossary',
                runNumber: 2,
                chromePath: '/chromium',
                baseEnv: { EXISTING: 'preserved' },
                lhciDir: dir,
                resolveMultiplier: async (options) => {
                    events.push(['resolve', options]);
                    return { multiplier: 1.3, hostBenchmarkIndex: 710, source: 'calibrated' };
                },
                validateCalibration: (lhr, options) => {
                    events.push(['validate', lhr.environment.benchmarkIndex, options]);
                    return calibration;
                },
                spawn: (command, args, options) => {
                    events.push(['collect', command, args, options]);
                    fs.writeFileSync(
                        path.join(dir, 'lhr-1000.json'),
                        JSON.stringify({ environment: { benchmarkIndex: 700 } }),
                    );
                    fs.writeFileSync(path.join(dir, 'lhr-1000.html'), '<html>new</html>');
                    return { status: 0 };
                },
                logger: { log: (message) => logs.push(message), warn: () => assert.fail('不应重试') },
            });

            assert.deepEqual(
                events.map(([event]) => event),
                ['resolve', 'collect', 'validate'],
            );
            assert.deepEqual(events[0][1], { executablePath: '/chromium', env: {} });
            assert.equal(events[1][1], 'pnpm');
            assert.deepEqual(events[1][2], [
                'exec',
                'lhci',
                'collect',
                `--config=${path.join(__dirname, 'lighthouserc.js')}`,
                '--additive',
            ]);
            assert.equal(events[1][3].cwd, __dirname);
            assert.equal(events[1][3].stdio, 'inherit');
            assert.deepEqual(events[1][3].env, {
                EXISTING: 'preserved',
                CHROME_PATH: '/chromium',
                LIGHTHOUSE_AUDIT_URL: 'http://127.0.0.1:8080/glossary',
                [MULTIPLIER_ENV_VAR]: '1.3',
            });
            assert.deepEqual(events[2].slice(1), [700, { allowHostSpeedFloor: true }]);
            assert.deepEqual(result, {
                reportPath: path.join(dir, 'lhr-1000.json'),
                multiplier: 1.3,
                hostBenchmarkIndex: 710,
                calibration,
            });
            assert.deepEqual(logs, [
                '✅ [lhci] http://127.0.0.1:8080/glossary #2：预跑 710.0，报告 700.0 / 1.3x = 538.5',
            ]);
            assert.deepEqual(fs.readdirSync(dir).sort(), [
                'lhr-1000.html',
                'lhr-1000.json',
                'lhr-900.html',
                'lhr-900.json',
            ]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('实际有效指数超差时依据被丢弃报告重新校准下一次审计', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-calibration-test-'));
        const warnings = [];
        const commandEnvs = [];
        const benchmarkIndexes = [900, 700];
        let reportNumber = 0;
        let measurements = 0;

        try {
            clearLhrReports(dir);
            const result = await collectCalibratedAudit({
                url: 'http://127.0.0.1:8080/learning',
                runNumber: 1,
                chromePath: '/chromium',
                lhciDir: dir,
                resolveMultiplier: async () => {
                    measurements += 1;
                    return { multiplier: 1.1, hostBenchmarkIndex: 700, source: 'calibrated' };
                },
                spawn: (_command, _args, options) => {
                    commandEnvs.push(options.env);
                    const timestamp = 1000 + reportNumber;
                    const benchmarkIndex = benchmarkIndexes[reportNumber];
                    reportNumber += 1;
                    const lhr = {
                        environment: { benchmarkIndex },
                        configSettings: {
                            throttling: { cpuSlowdownMultiplier: Number(options.env[MULTIPLIER_ENV_VAR]) },
                        },
                    };
                    fs.writeFileSync(path.join(dir, `lhr-${timestamp}.json`), JSON.stringify(lhr));
                    fs.writeFileSync(path.join(dir, `lhr-${timestamp}.html`), '<html></html>');
                    return { status: 0 };
                },
                logger: { log: () => {}, warn: (message) => warnings.push(message) },
            });

            assert.equal(measurements, 1);
            assert.equal(commandEnvs.length, 2);
            assert.equal(commandEnvs[0].LIGHTHOUSE_AUDIT_URL, 'http://127.0.0.1:8080/learning');
            assert.equal(commandEnvs[0][MULTIPLIER_ENV_VAR], '1.1');
            assert.equal(commandEnvs[1][MULTIPLIER_ENV_VAR], '1.3');
            assert.equal(warnings.length, 1);
            assert.match(warnings[0], /校准验收失败/);
            assert.equal(path.basename(result.reportPath), 'lhr-1001.json');
            assert.deepEqual(fs.readdirSync(dir).sort(), ['lhr-1001.html', 'lhr-1001.json']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('共享 worker 在审计期间变慢时保留更严格的报告', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-retry-window-test-'));
        const warnings = [];
        const benchmarkIndexes = [782, 1000, 555];
        let reportNumber = 0;

        try {
            clearLhrReports(dir);
            const result = await collectCalibratedAudit({
                url: 'http://127.0.0.1:8080/learning',
                runNumber: 1,
                chromePath: '/chromium',
                lhciDir: dir,
                resolveMultiplier: async () => ({ multiplier: 1, hostBenchmarkIndex: 700, source: 'calibrated' }),
                spawn: (_command, _args, options) => {
                    const timestamp = 1000 + reportNumber;
                    const lhr = {
                        environment: { benchmarkIndex: benchmarkIndexes[reportNumber] },
                        configSettings: {
                            // 模拟 CI 中 CPU 配额在重试之间再次变化：报告如实记录本次配置。
                            throttling: { cpuSlowdownMultiplier: Number(options.env[MULTIPLIER_ENV_VAR]) },
                        },
                    };
                    reportNumber += 1;
                    fs.writeFileSync(path.join(dir, `lhr-${timestamp}.json`), JSON.stringify(lhr));
                    return { status: 0 };
                },
                logger: { log: () => {}, warn: (message) => warnings.push(message) },
            });

            assert.equal(reportNumber, 3);
            assert.equal(warnings.length, 2);
            assert.equal(path.basename(result.reportPath), 'lhr-1002.json');
            assert.equal(result.calibration.usedStricterEffectiveSpeed, true);
            assert.deepEqual(fs.readdirSync(dir), ['lhr-1002.json']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('Lighthouse 采集本身失败时立即退出，不把页面错误当作校准漂移重试', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-collect-failure-test-'));
        let measurements = 0;
        let collections = 0;

        try {
            await assert.rejects(
                collectCalibratedAudit({
                    url: 'http://127.0.0.1:8080/learning',
                    runNumber: 1,
                    chromePath: '/chromium',
                    lhciDir: dir,
                    resolveMultiplier: async () => {
                        measurements += 1;
                        return { multiplier: 1, hostBenchmarkIndex: 700, source: 'calibrated' };
                    },
                    spawn: () => {
                        collections += 1;
                        return { status: 1 };
                    },
                    logger: { log: () => {}, warn: () => {} },
                }),
                /采集失败，退出码 1/,
            );
            assert.equal(measurements, 1);
            assert.equal(collections, 1);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('采集启动或退出失败均只尝试一次，并仅清理该次新增报告', async () => {
        for (const failure of [{ error: new Error('spawn broke') }, { status: 7 }]) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-immediate-failure-test-'));
            let collections = 0;
            try {
                fs.writeFileSync(path.join(dir, 'lhr-900.json'), '{}');
                fs.writeFileSync(path.join(dir, 'lhr-900.html'), '<html>old</html>');
                await assert.rejects(
                    collectCalibratedAudit({
                        url: 'http://127.0.0.1:8080/learning',
                        runNumber: 3,
                        chromePath: '/chromium',
                        lhciDir: dir,
                        resolveMultiplier: async () => ({ multiplier: 1, hostBenchmarkIndex: 700 }),
                        spawn: () => {
                            collections += 1;
                            fs.writeFileSync(path.join(dir, 'lhr-1000.json'), '{}');
                            fs.writeFileSync(path.join(dir, 'lhr-1000.html'), '<html>new</html>');
                            return failure;
                        },
                        logger: { log: () => {}, warn: () => assert.fail('不可重试错误不应记录重试') },
                    }),
                    failure.error ? /采集启动失败: spawn broke/ : /采集失败，退出码 7/,
                );
                assert.equal(collections, 1);
                assert.deepEqual(fs.readdirSync(dir).sort(), ['lhr-900.html', 'lhr-900.json']);
            } finally {
                fs.rmSync(dir, { recursive: true, force: true });
            }
        }
    });

    it('未生成或生成多份报告时逐轮清理，最终错误保留上下文和最后原因', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-report-count-test-'));
        const warnings = [];
        let collections = 0;
        try {
            fs.writeFileSync(path.join(dir, 'lhr-900.json'), '{}');
            fs.writeFileSync(path.join(dir, 'lhr-900.html'), '<html>old</html>');
            await assert.rejects(
                collectCalibratedAudit({
                    url: 'http://127.0.0.1:8080/glossary',
                    runNumber: 2,
                    chromePath: '/chromium',
                    lhciDir: dir,
                    maxAttempts: 2,
                    resolveMultiplier: async () => ({ multiplier: 1.2, hostBenchmarkIndex: 700 }),
                    spawn: () => {
                        collections += 1;
                        if (collections === 2) {
                            for (const timestamp of [1000, 1001]) {
                                fs.writeFileSync(path.join(dir, `lhr-${timestamp}.json`), '{}');
                                fs.writeFileSync(path.join(dir, `lhr-${timestamp}.html`), '<html>new</html>');
                            }
                        }
                        return { status: 0 };
                    },
                    logger: { log: () => {}, warn: (message) => warnings.push(message) },
                }),
                /http:\/\/127\.0\.0\.1:8080\/glossary 第 2 次审计无法稳定校准：预期生成 1 份 LHR，实际生成 2 份/,
            );
            assert.equal(collections, 2);
            assert.equal(warnings.length, 2);
            assert.match(warnings[0], /（1\/2）：预期生成 1 份 LHR，实际生成 0 份/);
            assert.match(warnings[1], /（2\/2）：预期生成 1 份 LHR，实际生成 2 份/);
            assert.deepEqual(fs.readdirSync(dir).sort(), ['lhr-900.html', 'lhr-900.json']);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('慢 worker 到达 1 倍物理下限时保留报告，避免无效重试', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lhci-host-floor-test-'));
        let measurements = 0;

        try {
            const result = await collectCalibratedAudit({
                url: 'http://127.0.0.1:8080/learning',
                runNumber: 1,
                chromePath: '/chromium',
                lhciDir: dir,
                resolveMultiplier: async () => {
                    measurements += 1;
                    return { multiplier: 1, hostBenchmarkIndex: 700, source: 'calibrated' };
                },
                spawn: (_command, _args, options) => {
                    const lhr = {
                        environment: { benchmarkIndex: 533 },
                        configSettings: {
                            throttling: { cpuSlowdownMultiplier: Number(options.env[MULTIPLIER_ENV_VAR]) },
                        },
                    };
                    fs.writeFileSync(path.join(dir, 'lhr-1000.json'), JSON.stringify(lhr));
                    return { status: 0 };
                },
                logger: { log: () => {}, warn: () => {} },
            });

            assert.equal(measurements, 1);
            assert.equal(path.basename(result.reportPath), 'lhr-1000.json');
            assert.equal(result.calibration.usedHostSpeedFloor, true);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
