#!/usr/bin/env node

/**
 * 轮询等待目标环境 URL 可访问（用于 CI 部署后 E2E）。
 *
 * 用法:
 *   NODE_ENV=staging node wait-for-url.js
 *   NODE_ENV=production node wait-for-url.js
 *
 * 若设置了 CI_COMMIT_SHA，会额外等待 meta build-version 匹配该提交前缀；
 * 超时则 exit 1（不做软跳过）。
 */

const { ENV, URLS } = require('./env');

const targetUrl = URLS[ENV];
const expectedSha = (process.env.CI_COMMIT_SHA || '').substring(0, 7).toLowerCase();
const waitForCommit = Boolean(expectedSha);
const maxAttempts = Number.parseInt(process.env.E2E_WAIT_MAX_ATTEMPTS || (waitForCommit ? '36' : '12'), 10);
const intervalMs = Number.parseInt(process.env.E2E_WAIT_INTERVAL_MS || '5000', 10);

async function fetchBuildVersion(url) {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) {
        return { ok: false, status: response.status, buildVersion: null };
    }

    const html = await response.text();
    const match = html.match(/<meta\s+name="build-version"\s+content="([^"]*)"/i);
    return {
        ok: true,
        status: response.status,
        buildVersion: match ? match[1] : null,
    };
}

function buildVersionMatches(buildVersion, sha, env = ENV) {
    if (!sha) {
        return true;
    }
    if (!buildVersion) {
        return false;
    }
    const parts = buildVersion.toLowerCase().split(/\s+-\s+/);
    return parts.length >= 3 && parts[0] === env && parts[1].startsWith(sha);
}

function classifyResponse(response, sha, env) {
    if (!response.ok) {
        return { ready: false, reason: 'http', status: response.status };
    }
    if (!buildVersionMatches(response.buildVersion, sha, env)) {
        return { ready: false, reason: 'build-version', buildVersion: response.buildVersion };
    }
    return { ready: true, buildVersion: response.buildVersion };
}

async function pollOnce(url, sha, env, fetcher = fetchBuildVersion) {
    try {
        return classifyResponse(await fetcher(url), sha, env);
    } catch (error) {
        return { ready: false, reason: 'request', error };
    }
}

function failureMessage(result, sha) {
    if (result.reason === 'http') return `HTTP ${result.status}`;
    if (result.reason === 'request') return result.error.message;
    return `已可达，但 build-version=${result.buildVersion || '(缺失)'}，尚未匹配 ${sha}`;
}

function delay(milliseconds) {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

function reportStart(log, env, url, sha) {
    log(`⏳ 正在等待 [${env}] 环境就绪: ${url}`);
    if (sha) log(`⏳ 期望已部署构建版本前缀: ${sha}`);
}

function reportSuccess(log, attempt, attempts, buildVersion) {
    const versionNote = buildVersion ? `，build-version=${buildVersion}` : '';
    log(`✅ URL 已就绪 (第 ${attempt}/${attempts} 次尝试)${versionNote}`);
}

function reportTimeout(error, attempts, url, sha) {
    if (sha) {
        error(`❌ 在尝试 ${attempts} 次后，${url} 仍未部署到提交 ${sha}`);
        return;
    }
    error(`❌ URL 在尝试 ${attempts} 次后仍未就绪: ${url}`);
}

function createRuntime(options) {
    const {
        env = ENV,
        targetUrl: url = targetUrl,
        expectedSha: sha = expectedSha,
        maxAttempts: attempts = maxAttempts,
        intervalMs: waitInterval = intervalMs,
        fetchBuildVersion: fetcher = fetchBuildVersion,
        delay: wait = delay,
        // CLI 进度属于正常输出，保持原有 stdout 语义。
        log = console.log,
        error = console.error,
        exit = process.exit,
    } = options;
    return { env, url, sha, attempts, waitInterval, fetcher, wait, log, error, exit };
}

async function waitForUrl(options = {}) {
    const { env, url, sha, attempts, waitInterval, fetcher, wait, log, error, exit } = createRuntime(options);

    if (!url) {
        error(`❌ 未知环境: ${env}`);
        exit(1);
        return;
    }

    reportStart(log, env, url, sha);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const result = await pollOnce(url, sha, env, fetcher);
        if (result.ready) {
            reportSuccess(log, attempt, attempts, result.buildVersion);
            return;
        }

        log(`   第 ${attempt}/${attempts} 次尝试: ${failureMessage(result, sha)}`);
        if (attempt < attempts) await wait(waitInterval);
    }

    reportTimeout(error, attempts, url, sha);
    exit(1);
}

module.exports = { buildVersionMatches, delay, pollOnce, waitForUrl };

if (require.main === module) {
    waitForUrl().catch((error) => {
        console.error('致命错误:', error);
        process.exit(1);
    });
}
