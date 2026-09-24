/**
 * E2E 目标环境与 URL。
 * staging 地址由 E2E_BASE_URL 环境变量提供。
 */

const ENV = process.env.NODE_ENV || 'staging';
const { stagingUrl } = require('./staging-url');
const LIGHTHOUSE_PORT = process.env.LIGHTHOUSE_PORT || '8080';

const URLS = {
    production: 'https://www.goplay.appcookies.com/',
    staging: stagingUrl(),
    development: `http://127.0.0.1:${LIGHTHOUSE_PORT}/`,
};

module.exports = {
    ENV,
    URLS,
};
