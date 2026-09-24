#!/usr/bin/env node

/**
 * Lighthouse CI：审计 /learning 与 /glossary 移动端冷启动 Performance。
 *
 * - 每个 URL 运行 3 次，对中位数断言 Performance ≥ MIN_PERFORMANCE_SCORE（见 lighthouserc.js）
 * - 使用 Playwright 提供的 Chromium + 无沙箱参数
 * - HTML/JSON 报告写入 ci-artifacts/lighthouse
 *
 * 用法:
 *   NODE_ENV=staging pnpm run e2e:lhci
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { ENV, URLS } = require('./env');
const {
    MULTIPLIER_ENV_VAR,
    computeCpuSlowdownMultiplier,
    resolveCpuSlowdownMultiplier,
    validateLhrCpuCalibration,
} = require('./lighthouse-cpu-throttling');

const OUTPUT_DIR = path.join(__dirname, 'ci-artifacts', 'lighthouse');
const LHCI_DIR = path.join(__dirname, '.lighthouseci');
const CONFIG_PATH = path.join(__dirname, 'lighthouserc.js');
const AUDIT_URL_ENV_VAR = 'LIGHTHOUSE_AUDIT_URL';
const NUMBER_OF_RUNS = 3;
// 共享 CI worker 的 CFS 配额会在相邻浏览器进程间短暂波动。三次不足以覆盖
// 一个完整配额窗口时，宁可多取少量样本，也不能接纳未校准的性能报告。
const MAX_AUDIT_ATTEMPTS = 5;
const LHR_REPORT_RE = /^lhr-\d+\.(?:json|html)$/;

/**
 * @param {string} baseUrl
 * @returns {string[]}
 */
function buildAuditUrls(baseUrl) {
    const origin = baseUrl.replace(/\/$/, '');
    return [`${origin}/learning`, `${origin}/glossary`];
}

/**
 * @param {string | undefined} envName
 * @param {typeof URLS} urls
 * @returns {string}
 */
function resolveBaseUrl(envName = ENV, urls = URLS) {
    const base = urls[envName];
    if (!base) {
        throw new Error(`未知环境: ${envName}`);
    }
    return base;
}

function ensureOutputDir(dir = OUTPUT_DIR) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function resolveChromePath() {
    if (process.env.CHROME_PATH) {
        return process.env.CHROME_PATH;
    }
    return chromium.executablePath();
}

function listLhrJsonFiles(dir = LHCI_DIR) {
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs
        .readdirSync(dir)
        .filter((file) => /^lhr-\d+\.json$/.test(file))
        .map((file) => path.join(dir, file));
}

function clearLhrReports(dir = LHCI_DIR) {
    fs.mkdirSync(dir, { recursive: true });
    for (const file of fs.readdirSync(dir)) {
        if (LHR_REPORT_RE.test(file)) {
            fs.unlinkSync(path.join(dir, file));
        }
    }
}

function removeLhrReportPair(jsonPath) {
    const basePath = jsonPath.replace(/\.json$/, '');
    for (const extension of ['.json', '.html']) {
        const reportPath = `${basePath}${extension}`;
        if (fs.existsSync(reportPath)) {
            fs.unlinkSync(reportPath);
        }
    }
}

function runLhciCommand(command, args, { env, spawn = spawnSync } = {}) {
    return spawn('pnpm', ['exec', 'lhci', command, `--config=${CONFIG_PATH}`, ...args], {
        cwd: __dirname,
        stdio: 'inherit',
        env,
    });
}

function assertCommandSucceeded(result, label) {
    if (result.error) {
        const error = new Error(`${label}启动失败: ${result.error.message}`);
        error.retryCalibration = false;
        throw error;
    }
    if ((result.status ?? 1) !== 0) {
        const error = new Error(`${label}失败，退出码 ${result.status ?? 1}`);
        error.retryCalibration = false;
        throw error;
    }
}

async function resolveCalibrationInput({ retryMultiplier, resolveMultiplier, chromePath }) {
    if (retryMultiplier !== null) {
        return { multiplier: retryMultiplier, hostBenchmarkIndex: null, source: 'audit-report' };
    }
    return resolveMultiplier({ executablePath: chromePath, env: {} });
}

function buildCollectEnv({ baseEnv, chromePath, url, multiplier }) {
    return {
        ...baseEnv,
        CHROME_PATH: chromePath,
        [AUDIT_URL_ENV_VAR]: url,
        [MULTIPLIER_ENV_VAR]: String(multiplier),
    };
}

function discoverAndReadNewLhr(reportsBefore, lhciDir = LHCI_DIR) {
    const newReports = listLhrJsonFiles(lhciDir).filter((file) => !reportsBefore.has(file));
    if (newReports.length !== 1) {
        throw new Error(`预期生成 1 份 LHR，实际生成 ${newReports.length} 份`);
    }
    const [reportPath] = newReports;
    return { reportPath, lhr: JSON.parse(fs.readFileSync(reportPath, 'utf8')) };
}

function validateReportCalibration(lhr, validateCalibration, updateRetryMultiplier) {
    try {
        return validateCalibration(lhr, { allowHostSpeedFloor: true });
    } catch (error) {
        const benchmarkIndex = lhr?.environment?.benchmarkIndex;
        if (Number.isFinite(benchmarkIndex) && benchmarkIndex > 0) {
            updateRetryMultiplier(computeCpuSlowdownMultiplier(benchmarkIndex));
        }
        throw error;
    }
}

function cleanupNewLhrReports(reportsBefore, lhciDir = LHCI_DIR) {
    for (const reportPath of listLhrJsonFiles(lhciDir)) {
        if (!reportsBefore.has(reportPath)) {
            removeLhrReportPair(reportPath);
        }
    }
}

function formatCalibrationSource(hostBenchmarkIndex) {
    return hostBenchmarkIndex === null ? '报告反校准' : `预跑 ${hostBenchmarkIndex.toFixed(1)}`;
}

function formatSuccessfulAuditLog({ url, runNumber, hostBenchmarkIndex, calibration }) {
    const stricterSpeed = calibration.usedStricterEffectiveSpeed ? '（更严格的有效设备速度）' : '';
    return (
        `✅ [lhci] ${url} #${runNumber}：${formatCalibrationSource(hostBenchmarkIndex)}，` +
        `报告 ${calibration.benchmarkIndex.toFixed(1)} / ${calibration.multiplier}x = ` +
        `${calibration.effectiveBenchmarkIndex.toFixed(1)}${stricterSpeed}`
    );
}

function formatCalibrationRetryLog({ url, runNumber, attempt, maxAttempts, error }) {
    return `⚠️  [lhci] ${url} #${runNumber} 校准验收失败（${attempt}/${maxAttempts}）：${error.message}`;
}

/**
 * 单次审计必须与紧邻它的校准配对，并用该次 LHR 中的实际 benchmarkIndex 验收。
 * 偏差过大的、会放宽门禁的报告不会进入最终中位数；慢于目标设备的报告会
 * 收紧而非放宽门禁，因此可保留。共享 worker 的配额可能在预跑后下降，即使
 * 配置倍率大于 1 也可能出现这种安全的更慢报告。
 */
function normalizeCollectAuditOptions({
    url,
    runNumber,
    chromePath,
    baseEnv = process.env,
    lhciDir = LHCI_DIR,
    maxAttempts = MAX_AUDIT_ATTEMPTS,
    resolveMultiplier = resolveCpuSlowdownMultiplier,
    validateCalibration = validateLhrCpuCalibration,
    spawn = spawnSync,
    logger = console,
} = {}) {
    return {
        url,
        runNumber,
        chromePath,
        baseEnv,
        lhciDir,
        maxAttempts,
        resolveMultiplier,
        validateCalibration,
        spawn,
        logger,
    };
}

async function coordinateCalibratedAudit({
    url,
    runNumber,
    chromePath,
    baseEnv,
    lhciDir,
    maxAttempts,
    resolveMultiplier,
    validateCalibration,
    spawn,
    logger,
}) {
    let lastError;
    // 如果紧邻审计的报告与预跑结果不一致，下一次直接以该报告实测的
    // benchmarkIndex 反解倍数。报告仍会被删除；这仅避免共享 worker 的
    // CPU 配额窗口让重复预跑持续得到过慢的样本。
    let retryMultiplier = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const reportsBefore = new Set(listLhrJsonFiles(lhciDir));
        try {
            // 自动门禁不接受继承的固定覆盖值；首次实测，校准漂移后用刚生成的报告反校准。
            const calibrationInput = await resolveCalibrationInput({ retryMultiplier, resolveMultiplier, chromePath });
            const { multiplier, hostBenchmarkIndex } = calibrationInput;
            const commandEnv = buildCollectEnv({ baseEnv, chromePath, url, multiplier });
            const result = runLhciCommand('collect', ['--additive'], { env: commandEnv, spawn });
            assertCommandSucceeded(result, `Lighthouse ${url} 第 ${runNumber} 次采集`);

            const { reportPath, lhr } = discoverAndReadNewLhr(reportsBefore, lhciDir);
            const calibration = validateReportCalibration(lhr, validateCalibration, (nextMultiplier) => {
                retryMultiplier = nextMultiplier;
            });
            logger.log(formatSuccessfulAuditLog({ url, runNumber, hostBenchmarkIndex, calibration }));
            return { reportPath, multiplier, hostBenchmarkIndex, calibration };
        } catch (error) {
            cleanupNewLhrReports(reportsBefore, lhciDir);
            lastError = error;
            if (error.retryCalibration === false) {
                throw error;
            }
            logger.warn(formatCalibrationRetryLog({ url, runNumber, attempt, maxAttempts, error }));
        }
    }

    throw new Error(`${url} 第 ${runNumber} 次审计无法稳定校准：${lastError?.message || '未知错误'}`);
}

async function collectCalibratedAudit(options = {}) {
    return coordinateCalibratedAudit(normalizeCollectAuditOptions(options));
}

async function run() {
    const baseUrl = resolveBaseUrl();
    const urls = buildAuditUrls(baseUrl);
    const chromePath = resolveChromePath();
    const outputDir = ensureOutputDir();

    console.log(`🚀 [lhci] 正在审计 [${ENV}] 移动端 Performance...`);
    console.log(`🔗 URLs: ${urls.join(', ')}`);
    console.log(`🧭 Chrome: ${chromePath}`);
    console.log(`📁 Reports: ${outputDir}`);
    console.log('🖥️  CPU 校准: 每次审计前实测，并以该次 LHR 的有效 benchmarkIndex 验收');

    const buildEnv = {
        ...process.env,
        CHROME_PATH: chromePath,
        [AUDIT_URL_ENV_VAR]: urls[0],
        [MULTIPLIER_ENV_VAR]: '1',
        LHCI_BUILD_CONTEXT__CURRENT_HASH: process.env.CI_COMMIT_SHA || process.env.LHCI_BUILD_CONTEXT__CURRENT_HASH,
    };
    assertCommandSucceeded(runLhciCommand('healthcheck', ['--fatal'], { env: buildEnv }), 'Lighthouse healthcheck');
    clearLhrReports();

    let lastAudit;
    for (const url of urls) {
        for (let runNumber = 1; runNumber <= NUMBER_OF_RUNS; runNumber += 1) {
            lastAudit = await collectCalibratedAudit({ url, runNumber, chromePath, baseEnv: buildEnv });
        }
    }

    const finalEnv = {
        ...buildEnv,
        [MULTIPLIER_ENV_VAR]: String(lastAudit.multiplier),
    };
    const assertResult = runLhciCommand('assert', [], { env: finalEnv });
    const uploadResult = runLhciCommand('upload', [], { env: finalEnv });
    if (uploadResult.error || (uploadResult.status ?? 1) !== 0) {
        console.warn(`⚠️  [lhci] 报告上传失败，退出码 ${uploadResult.status ?? 1}`);
    }
    assertCommandSucceeded(assertResult, 'Lighthouse 性能断言');
}

module.exports = {
    OUTPUT_DIR,
    LHCI_DIR,
    MAX_AUDIT_ATTEMPTS,
    NUMBER_OF_RUNS,
    assertCommandSucceeded,
    buildAuditUrls,
    clearLhrReports,
    collectCalibratedAudit,
    listLhrJsonFiles,
    removeLhrReportPair,
    resolveBaseUrl,
    ensureOutputDir,
    resolveChromePath,
    runLhciCommand,
};

if (require.main === module) {
    run().catch((err) => {
        console.error(`❌ [lhci] ${err.message}`);
        process.exit(1);
    });
}
