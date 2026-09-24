const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
    MAX_EFFECTIVE_BENCHMARK_DEVIATION_RATIO,
    MIN_CPU_SLOWDOWN_MULTIPLIER,
    MULTIPLIER_ENV_VAR,
    TARGET_BENCHMARK_INDEX,
    computeCpuSlowdownMultiplier,
    loadComputeBenchmarkIndex,
    parseMultiplierOverride,
    resolveCpuSlowdownMultiplier,
    validateLhrCpuCalibration,
} = require('./lighthouse-cpu-throttling');

describe('lighthouse CPU 降速校准', () => {
    it('倍数与宿主机速度成正比，使各机器模拟出同一台设备', () => {
        // 目标设备速度处的宿主机不需要额外降速；两倍速的宿主机需要两倍降速。
        assert.equal(computeCpuSlowdownMultiplier(TARGET_BENCHMARK_INDEX), 1);
        assert.equal(computeCpuSlowdownMultiplier(TARGET_BENCHMARK_INDEX * 2), 2);
        assert.equal(computeCpuSlowdownMultiplier(TARGET_BENCHMARK_INDEX * 3), 3);

        assert.equal(computeCpuSlowdownMultiplier(2900), 4.1);
    });

    it('慢 worker 不做负向加速，高速宿主机不封顶并仍落到目标指数', () => {
        // 共享 CI worker：本身已接近目标设备，几乎不需要再降速。
        assert.equal(computeCpuSlowdownMultiplier(800), 1.1);

        assert.equal(computeCpuSlowdownMultiplier(100), MIN_CPU_SLOWDOWN_MULTIPLIER);
        assert.equal(computeCpuSlowdownMultiplier(5600), 8);
        assert.equal(5600 / computeCpuSlowdownMultiplier(5600), TARGET_BENCHMARK_INDEX);
        assert.equal(computeCpuSlowdownMultiplier(100000), 142.9);
    });

    it('用每次 LHR 的实际指数验收有效设备速度', () => {
        const valid = validateLhrCpuCalibration({
            environment: { benchmarkIndex: 5600 },
            configSettings: { throttling: { cpuSlowdownMultiplier: 8 } },
        });
        assert.equal(valid.effectiveBenchmarkIndex, TARGET_BENCHMARK_INDEX);
        assert.equal(valid.deviationRatio, 0);

        assert.throws(
            () =>
                validateLhrCpuCalibration({
                    environment: { benchmarkIndex: 600 },
                    configSettings: { throttling: { cpuSlowdownMultiplier: 1 } },
                }),
            new RegExp(`CPU 校准偏差.*超过 ${MAX_EFFECTIVE_BENCHMARK_DEVIATION_RATIO * 100}\\.0%`),
        );
        assert.throws(() => validateLhrCpuCalibration({}), /缺少有效 benchmarkIndex/);
    });

    it('慢于目标设备的 worker 在 1 倍物理下限时保留更严格的报告', () => {
        const calibration = validateLhrCpuCalibration(
            {
                environment: { benchmarkIndex: 533 },
                configSettings: { throttling: { cpuSlowdownMultiplier: 1 } },
            },
            { allowHostSpeedFloor: true },
        );

        assert.equal(calibration.effectiveBenchmarkIndex, 533);
        assert.equal(calibration.targetBenchmarkIndex, 533);
        assert.equal(calibration.usedHostSpeedFloor, true);
        assert.equal(calibration.usedStricterEffectiveSpeed, true);
        assert.equal(calibration.deviationRatio, 0);
    });

    it('审计期间配额下降而变慢时保留更严格的报告', () => {
        const calibration = validateLhrCpuCalibration(
            {
                environment: { benchmarkIndex: 580 },
                configSettings: { throttling: { cpuSlowdownMultiplier: 1.1 } },
            },
            { allowHostSpeedFloor: true },
        );

        assert.equal(calibration.effectiveBenchmarkIndex, 580 / 1.1);
        assert.equal(calibration.targetBenchmarkIndex, 580 / 1.1);
        assert.equal(calibration.usedHostSpeedFloor, false);
        assert.equal(calibration.usedStricterEffectiveSpeed, true);
    });

    it('拒绝无效 benchmarkIndex，避免静默产生错误倍数', () => {
        assert.throws(() => computeCpuSlowdownMultiplier(0), /无效的 benchmarkIndex/);
        assert.throws(() => computeCpuSlowdownMultiplier(-1), /无效的 benchmarkIndex/);
        assert.throws(() => computeCpuSlowdownMultiplier(Number.NaN), /无效的 benchmarkIndex/);
        assert.throws(() => computeCpuSlowdownMultiplier(undefined), /无效的 benchmarkIndex/);
    });

    it('环境变量覆盖只接受合法数值，拼写错误不会静默改变门禁强度', () => {
        assert.equal(parseMultiplierOverride('2.5'), 2.5);
        assert.equal(parseMultiplierOverride('1'), 1);
        assert.equal(parseMultiplierOverride(undefined), null);
        assert.equal(parseMultiplierOverride(''), null);
        assert.equal(parseMultiplierOverride('  '), null);
        assert.equal(parseMultiplierOverride('fast'), null);
        // 小于 1 等于让时间倒流，Lantern 没有负向加速。
        assert.equal(parseMultiplierOverride('0.5'), null);
    });

    it('显式覆盖时不启动浏览器测量', async () => {
        let measured = false;
        const result = await resolveCpuSlowdownMultiplier({
            env: { [MULTIPLIER_ENV_VAR]: '2' },
            measure: async () => {
                measured = true;
                return 2900;
            },
        });

        assert.deepEqual(result, { multiplier: 2, hostBenchmarkIndex: null, source: 'override' });
        assert.equal(measured, false);
    });

    it('无覆盖时按实测宿主机速度校准', async () => {
        const result = await resolveCpuSlowdownMultiplier({
            env: {},
            measure: async () => 1400,
        });

        assert.deepEqual(result, { multiplier: 2, hostBenchmarkIndex: 1400, source: 'calibrated' });
    });

    it('校准失败时明确失败，不使用会在高速宿主机放宽门禁的固定倍数', async () => {
        await assert.rejects(
            resolveCpuSlowdownMultiplier({
                env: {},
                measure: async () => {
                    throw new Error('Chrome 启动失败');
                },
            }),
            /Chrome 启动失败/,
        );
    });

    it('复用 lhci 自己那份 Lighthouse 的 benchmark 实现，量纲与报告一致', async () => {
        const computeBenchmarkIndex = await loadComputeBenchmarkIndex();

        assert.equal(typeof computeBenchmarkIndex, 'function');
        // 会被序列化进页面执行，因此必须是不依赖闭包的独立函数。
        assert.match(computeBenchmarkIndex.toString(), /^function computeBenchmarkIndex\(\)/);
    });
});
