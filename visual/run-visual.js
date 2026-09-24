#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { buildScenarios } = require('./scenarios');

const actions = ['test', 'reference', 'approve'];
const action = process.argv[2] || 'test';

if (!actions.includes(action)) {
    console.error(`用法: node run-visual.js [${actions.join('|')}]`);
    process.exit(1);
}

if (action !== 'test' && process.platform !== 'linux') {
    console.error('基准截图必须在 Linux 环境中更新，以保持与 CI 的渲染环境一致。');
    process.exit(1);
}

function targetUrl() {
    const raw = process.env.VISUAL_BASE_URL;
    if (!raw) {
        throw new Error('缺少 VISUAL_BASE_URL；请提供已部署站点的 HTTPS 根地址。');
    }

    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
        throw new Error('VISUAL_BASE_URL 必须是无用户名、密码、路径、查询参数的 HTTPS 站点根地址。');
    }
    return url.origin;
}

try {
    const baseUrl = targetUrl();
    process.env.VISUAL_BASE_URL = baseUrl;
    process.env.VISUAL_LOCALES ||= 'zh';

    const scenarios = buildScenarios(baseUrl);
    if (scenarios.length === 0) {
        throw new Error('视觉场景过滤后为空，拒绝运行。');
    }
    console.log(`视觉回归：${scenarios.length} 个场景`);

    const args = ['exec', 'playwright', 'test'];
    if (action === 'reference') args.push('--update-snapshots=all');
    if (action === 'approve') args.push('--update-snapshots=changed');
    if (process.env.VISUAL_FILTER) args.push(`--grep=${process.env.VISUAL_FILTER}`);

    const result = spawnSync('pnpm', args, { stdio: 'inherit', env: process.env, cwd: __dirname });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
