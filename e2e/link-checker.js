#!/usr/bin/env node

/**
 * 使用 linkinator 进行 E2E 站内链接检查（跳过外部链接，避免第三方超时/限流导致 CI 间歇失败）
 *
 * 用法:
 *   NODE_ENV=production node link-checker.js
 *   NODE_ENV=staging node link-checker.js
 *
 * 外部链接（App Store、Google Play 等）不属于本站检查范围。
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { ENV, URLS } = require('./env');

const linkinatorBin = path.join(__dirname, 'node_modules', '.bin', 'linkinator');

function buildInternalOnlySkipPattern(url) {
    const origin = new URL(url).origin;
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^(?!${escaped})`;
}

function buildLinkinatorCommand(targetUrl, executable = linkinatorBin) {
    return {
        command: executable,
        args: [
            targetUrl,
            '--recurse',
            '--timeout',
            '30000',
            '--concurrency',
            '10',
            '--skip',
            buildInternalOnlySkipPattern(targetUrl),
        ],
        options: { stdio: 'inherit' },
    };
}

function run(dependencies = {}) {
    const env = dependencies.env || ENV;
    const urls = dependencies.urls || URLS;
    const targetUrl = urls[env];
    const spawn = dependencies.spawnSync || spawnSync;
    const logger = dependencies.logger || console;
    const executable = dependencies.linkinatorBin || linkinatorBin;

    if (!targetUrl) {
        logger.error(`❌ 未知环境: ${env}`);
        return 1;
    }

    logger.log(`🚀 正在启动 [${env}] 环境的站内链接检查器...`);
    logger.log(`🔗 目标 URL: ${targetUrl}`);
    logger.log('⏭️  跳过外部链接（仅递归站内 URL）');

    const command = buildLinkinatorCommand(targetUrl, executable);
    const result = spawn(command.command, command.args, command.options);

    if (result.status === 0) {
        logger.log('\n✅ 所有站内链接均有效！');
        return 0;
    }

    logger.error('\n❌ 链接检查器发现了损坏的链接。');
    return result.status || 1;
}

module.exports = {
    buildInternalOnlySkipPattern,
    buildLinkinatorCommand,
    run,
};

if (require.main === module) {
    process.exit(run());
}
