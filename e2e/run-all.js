#!/usr/bin/env node

/**
 * 依次运行 e2e/ 目录下所有检查脚本
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const e2eDir = __dirname;
const skipFiles = new Set([
    'run-all.js',
    'wait-for-url.js',
    'glossary-sample.js',
    'assert-page-mounted.js',
    'tutorial-navigation.js',
    'env.js',
    'site-contract.js',
    'staging-url.js',
    // Lighthouse 由非 master 分支的 e2e dev 步骤在 localhost 单独执行。
    'lighthouse-ci.js',
    'lighthouse-cpu-throttling.js',
    'lighthouserc.js',
]);

function discoverScripts(dir = e2eDir) {
    return fs
        .readdirSync(dir)
        .filter((file) => file.endsWith('.js') && !file.endsWith('.test.js') && !skipFiles.has(file))
        .sort();
}

function runAll(scripts = discoverScripts()) {
    if (scripts.length === 0) {
        console.error('No E2E scripts found.');
        process.exit(1);
    }

    for (const script of scripts) {
        console.log(`\n=== Running E2E: ${script} ===\n`);
        const result = spawnSync('node', [path.join(e2eDir, script)], { stdio: 'inherit' });

        if (result.status !== 0) {
            process.exit(result.status || 1);
        }
    }

    console.log('\n✅ All E2E checks passed.');
}

module.exports = { discoverScripts };

if (require.main === module) {
    runAll();
}
