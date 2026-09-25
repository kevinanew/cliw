#!/usr/bin/env node

/**
 * E2E：验证 robots.txt 与部署环境一致
 * - staging：全站 Disallow（屏蔽搜索引擎）
 * - production：Allow（允许收录）
 */

const ENV = process.env.NODE_ENV || 'staging';

const URLS = {
    production: 'https://www.goplay.appcookies.com/robots.txt',
    staging: new URL('/robots.txt', require('./staging-url').stagingUrl()).href,
};

const robotsUrl = URLS[ENV];
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_ATTEMPTS = 3;

if (!robotsUrl) {
    console.error(`❌ 未知环境: ${ENV}`);
    process.exit(1);
}

function blocksAllCrawlers(body) {
    return /^Disallow:\s*\/\s*$/m.test(body);
}

function allowsIndexing(body) {
    return /^Allow:\s*\/\s*$/m.test(body) && !blocksAllCrawlers(body);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, { redirect: 'follow', signal: controller.signal });
        const body = await response.text();
        return { response, body };
    } finally {
        clearTimeout(timer);
    }
}

async function fetchRobotsWithRetry(fetchImpl, url, options = {}) {
    const attempts = options.attempts ?? MAX_FETCH_ATTEMPTS;
    const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
    const sleep = options.sleep ?? wait;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const result = await fetchWithTimeout(fetchImpl, url, timeoutMs);
            const { response } = result;
            if (response.status >= 500) {
                throw new Error(`HTTP ${response.status}`);
            }
            return result;
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                console.log(`   ↻ robots.txt 第 ${attempt}/${attempts} 次请求失败: ${error.message}`);
                await sleep(250 * attempt);
            }
        }
    }

    throw lastError;
}

async function run() {
    let body;

    try {
        const result = await fetchRobotsWithRetry(fetch, robotsUrl);
        const { response } = result;

        if (!response.ok) {
            console.error(`❌ [失败] HTTP ${response.status} ${robotsUrl}`);
            process.exit(1);
        }

        body = result.body;
    } catch (e) {
        console.error(`❌ [错误] ${robotsUrl}: ${e.message}`);
        process.exit(1);
    }

    console.log('--- robots.txt 内容 ---');
    console.log(body.trim());
    console.log('-----------------------');

    if (ENV === 'staging') {
        if (blocksAllCrawlers(body)) {
            console.log('✅ [成功] staging 已屏蔽全站爬虫 (Disallow: /)');
            process.exit(0);
        }

        console.error('❌ [失败] staging 应包含 "Disallow: /" 以屏蔽搜索引擎收录');
        process.exit(1);
    }

    if (ENV === 'production') {
        if (allowsIndexing(body)) {
            console.log('✅ [成功] production 已允许搜索引擎收录 (Allow: /)');
            process.exit(0);
        }

        if (blocksAllCrawlers(body)) {
            console.error('❌ [失败] production 不应包含 "Disallow: /"，否则会阻止官网被搜索引擎收录');
        } else {
            console.error('❌ [失败] production 应包含 "Allow: /" 以明确允许搜索引擎收录');
        }
        process.exit(1);
    }
}

if (require.main === module) {
    console.log(`🚀 [E2E] 正在验证 [${ENV}] 环境的 robots.txt...`);
    console.log(`🔗 目标 URL: ${robotsUrl}`);
    run().catch((err) => {
        console.error('致命错误:', err);
        process.exit(1);
    });
}

module.exports = {
    blocksAllCrawlers,
    allowsIndexing,
    fetchWithTimeout,
    fetchRobotsWithRetry,
};
