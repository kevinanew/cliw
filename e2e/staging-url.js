const FALLBACK_URL = 'https://staging.example.test/';

function stagingUrl(env = process.env) {
    const value = env.E2E_BASE_URL || FALLBACK_URL;
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('E2E_BASE_URL 必须是 HTTPS 站点根地址');
    }
    return url.href;
}

function requireStagingUrl(env = process.env) {
    if (!env.E2E_BASE_URL) throw new Error('缺少 E2E_BASE_URL；请通过环境变量提供目标站点地址');
    return stagingUrl(env);
}

module.exports = { stagingUrl, requireStagingUrl };
