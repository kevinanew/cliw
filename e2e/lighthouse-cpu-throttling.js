/**
 * 把 CPU 降速倍数校准到宿主机速度，只让确实模拟到目标设备速度的报告进入门禁。
 *
 * throttlingMethod: 'simulate'（Lantern）并不真的放慢 CPU，而是把 trace 里
 * 实测的任务耗时乘以 cpuSlowdownMultiplier。所以固定倍数描述的不是"设备"，
 * 而是"宿主机速度 ÷ 倍数"：同一份 dist 在开发机（benchmarkIndex≈2900）上
 * 模拟出 ≈700 的设备，在共享 CI worker（≈800）上却模拟出 ≈200 的设备——
 * 页面没变，Performance 却从 0.96 掉到 0.37。
 *
 * 这里先用 Lighthouse 自己的 computeBenchmarkIndex 量出宿主机速度，再反解出
 * 落到目标设备所需的倍数；每次审计后还必须用报告实测值验收，不能只相信预跑
 * 时的宿主机速度。若审计时宿主机已慢于目标，保留有效设备速度更慢的报告会让
 * 门禁更严格，而不是像固定倍数那样放宽它；这不仅发生在 1 倍物理下限，也会
 * 发生在共享 worker 在预跑和审计之间被降配额时。
 */

const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const DEFAULT_SAMPLE_COUNT = 3;

/**
 * 目标设备速度（Lighthouse benchmarkIndex 口径，≈高端 Android）。
 * 取值等于既有基线：开发机 ≈2900 ÷ Lighthouse 标准移动端的 4 倍降速 ≈ 700，
 * 因此开发机上的分数与校准前保持一致，只有慢机器被纠正。
 */
const TARGET_BENCHMARK_INDEX = 700;

/** 低于 1 等于让时间倒流；Lantern 不接受负向加速。 */
const MIN_CPU_SLOWDOWN_MULTIPLIER = 1;

/** 审计报告中的有效设备指数允许相对目标上下浮动 10%。 */
const MAX_EFFECTIVE_BENCHMARK_DEVIATION_RATIO = 0.1;

/** 显式覆盖仅供独立复现；自动门禁始终逐次实测并验收报告。 */
const MULTIPLIER_ENV_VAR = 'LIGHTHOUSE_CPU_SLOWDOWN_MULTIPLIER';

/**
 * 由宿主机 benchmarkIndex 反解 CPU 降速倍数。
 * @param {number} hostBenchmarkIndex
 * @returns {number} 保留一位小数的倍数
 */
function computeCpuSlowdownMultiplier(hostBenchmarkIndex) {
    if (!Number.isFinite(hostBenchmarkIndex) || hostBenchmarkIndex <= 0) {
        throw new Error(`无效的 benchmarkIndex: ${hostBenchmarkIndex}`);
    }

    const raw = hostBenchmarkIndex / TARGET_BENCHMARK_INDEX;
    const multiplier = Math.max(MIN_CPU_SLOWDOWN_MULTIPLIER, raw);
    return Math.round(multiplier * 10) / 10;
}

/**
 * 从单次 Lighthouse 报告验证该次审计实际模拟出的设备速度。
 * benchmarkIndex 是该次 Lighthouse 自己测到的宿主机速度，除以该次实际使用的
 * cpuSlowdownMultiplier 后才是门禁对应的有效设备指数。
 *
 * @param {object} lhr
 * @param {{ targetBenchmarkIndex?: number, maxDeviationRatio?: number, allowHostSpeedFloor?: boolean }} [options]
 * @returns {{ benchmarkIndex: number, multiplier: number, effectiveBenchmarkIndex: number, targetBenchmarkIndex: number, deviationRatio: number, usedHostSpeedFloor: boolean, usedStricterEffectiveSpeed: boolean }}
 */
function validateLhrCpuCalibration(
    lhr,
    {
        targetBenchmarkIndex = TARGET_BENCHMARK_INDEX,
        maxDeviationRatio = MAX_EFFECTIVE_BENCHMARK_DEVIATION_RATIO,
        allowHostSpeedFloor = false,
    } = {},
) {
    const benchmarkIndex = lhr?.environment?.benchmarkIndex;
    const multiplier = lhr?.configSettings?.throttling?.cpuSlowdownMultiplier;

    if (!Number.isFinite(benchmarkIndex) || benchmarkIndex <= 0) {
        throw new Error(`Lighthouse 报告缺少有效 benchmarkIndex: ${benchmarkIndex}`);
    }
    if (!Number.isFinite(multiplier) || multiplier < MIN_CPU_SLOWDOWN_MULTIPLIER) {
        throw new Error(`Lighthouse 报告缺少有效 CPU 降速倍数: ${multiplier}`);
    }
    if (!Number.isFinite(targetBenchmarkIndex) || targetBenchmarkIndex <= 0) {
        throw new Error(`无效的目标 benchmarkIndex: ${targetBenchmarkIndex}`);
    }
    if (!Number.isFinite(maxDeviationRatio) || maxDeviationRatio < 0) {
        throw new Error(`无效的 benchmarkIndex 偏差比例: ${maxDeviationRatio}`);
    }

    const effectiveBenchmarkIndex = benchmarkIndex / multiplier;
    // 只要有效设备速度慢于目标，留下报告就只会收紧门禁。除了 Lighthouse
    // 不能低于 1 倍的物理下限，共享 worker 也可能在预跑后缩减 CPU 配额，
    // 使一个大于 1 的已配置倍数产生更慢的有效设备；这种报告同样安全。
    const usedHostSpeedFloor =
        allowHostSpeedFloor && multiplier === MIN_CPU_SLOWDOWN_MULTIPLIER && benchmarkIndex < targetBenchmarkIndex;
    const usedStricterEffectiveSpeed = allowHostSpeedFloor && effectiveBenchmarkIndex < targetBenchmarkIndex;
    const calibratedTargetBenchmarkIndex = usedStricterEffectiveSpeed ? effectiveBenchmarkIndex : targetBenchmarkIndex;
    const deviationRatio =
        Math.abs(effectiveBenchmarkIndex - calibratedTargetBenchmarkIndex) / calibratedTargetBenchmarkIndex;
    if (deviationRatio > maxDeviationRatio) {
        throw new Error(
            `CPU 校准偏差 ${(deviationRatio * 100).toFixed(1)}% 超过 ${(maxDeviationRatio * 100).toFixed(1)}%：` +
                `实际有效 benchmarkIndex=${effectiveBenchmarkIndex.toFixed(1)}，目标=${calibratedTargetBenchmarkIndex}`,
        );
    }

    return {
        benchmarkIndex,
        multiplier,
        effectiveBenchmarkIndex,
        targetBenchmarkIndex: calibratedTargetBenchmarkIndex,
        deviationRatio,
        usedHostSpeedFloor,
        usedStricterEffectiveSpeed,
    };
}

/**
 * 解析环境变量覆盖值；非法值视为未设置，避免拼写错误静默改变门禁强度。
 * @param {string | undefined} raw
 * @returns {number | null}
 */
function parseMultiplierOverride(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= MIN_CPU_SLOWDOWN_MULTIPLIER ? parsed : null;
}

/**
 * 取出 Lighthouse 自己的 benchmark 实现。
 *
 * lighthouse 是 @lhci/cli 的传递依赖，pnpm 的严格布局下不能从 e2e 直接解析；
 * 绕过 @lhci/cli 定位还有个额外好处：拿到的一定是 lhci 稍后真正运行的那个
 * 版本，基准量纲不会和报告里的 benchmarkIndex 对不上。
 * @returns {Promise<Function>}
 */
async function loadComputeBenchmarkIndex() {
    const lhciRequire = createRequire(require.resolve('@lhci/cli/package.json'));
    const modulePath = lhciRequire.resolve('lighthouse/core/lib/page-functions.js');
    // page-functions 是 ESM，从 CJS 侧只能动态导入。
    const { pageFunctions } = await import(pathToFileURL(modulePath).href);
    return pageFunctions.computeBenchmarkIndex;
}

/**
 * 在 Chrome 里跑 Lighthouse 自己的 computeBenchmarkIndex。
 *
 * 必须用浏览器而不是 Node 测：两者 V8 配置不同，Node 侧的数值不随容器 CPU
 * 配额变化，做不了宿主机速度的代理。
 *
 * 多个样本取最小值而不是中位数：CI 容器普遍用 CFS 配额限流，空闲探测容易
 * 撞上配额刚补满、JIT 又已预热的乐观时刻，而真正的审计（浏览器多进程 +
 * 静态服务器同时抢配额）拿不到这种速度。按最慢样本估算，才是审计实际能
 * 分到的 CPU 预算。
 *
 * @param {{ executablePath?: string, sampleCount?: number }} [options]
 * @returns {Promise<number>}
 */
async function measureHostBenchmarkIndex({ executablePath, sampleCount = DEFAULT_SAMPLE_COUNT } = {}) {
    const { chromium } = require('playwright');
    const computeBenchmarkIndex = await loadComputeBenchmarkIndex();

    const browser = await chromium.launch({
        executablePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    try {
        const page = await browser.newPage();
        const samples = [];
        for (let i = 0; i < sampleCount; i += 1) {
            samples.push(await page.evaluate(`(${computeBenchmarkIndex})()`));
        }
        return Math.min(...samples);
    } finally {
        await browser.close();
    }
}

/**
 * 决定本次审计使用的 CPU 降速倍数。
 *
 * 校准失败必须让调用方失败；固定 4 倍在指数高于 2800 的机器上反而会放宽
 * 门禁，不能作为安全回退。
 *
 * @param {{ executablePath?: string, env?: NodeJS.ProcessEnv, measure?: typeof measureHostBenchmarkIndex }} [options]
 * @returns {Promise<{ multiplier: number, hostBenchmarkIndex: number | null, source: 'override' | 'calibrated' }>}
 */
async function resolveCpuSlowdownMultiplier({
    executablePath,
    env = process.env,
    measure = measureHostBenchmarkIndex,
} = {}) {
    const override = parseMultiplierOverride(env[MULTIPLIER_ENV_VAR]);
    if (override !== null) {
        return { multiplier: override, hostBenchmarkIndex: null, source: 'override' };
    }

    const hostBenchmarkIndex = await measure({ executablePath });
    return {
        multiplier: computeCpuSlowdownMultiplier(hostBenchmarkIndex),
        hostBenchmarkIndex,
        source: 'calibrated',
    };
}

module.exports = {
    MAX_EFFECTIVE_BENCHMARK_DEVIATION_RATIO,
    MIN_CPU_SLOWDOWN_MULTIPLIER,
    MULTIPLIER_ENV_VAR,
    TARGET_BENCHMARK_INDEX,
    computeCpuSlowdownMultiplier,
    loadComputeBenchmarkIndex,
    measureHostBenchmarkIndex,
    parseMultiplierOverride,
    resolveCpuSlowdownMultiplier,
    validateLhrCpuCalibration,
};
