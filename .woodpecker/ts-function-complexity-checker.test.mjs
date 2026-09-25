import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { discoverProjectDir, loadTypeScript } from './ts-function-complexity-checker.mjs';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checker = path.join(repositoryRoot, '.woodpecker/ts-function-complexity-checker.mjs');
const fixtureDirectories = [];

const createFixtureProject = () => {
    const directory = fs.mkdtempSync(path.join(repositoryRoot, '.ts-function-complexity-checker-test-'));
    fixtureDirectories.push(directory);
    fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}');
    return directory;
};

const projectArgument = (directory) => path.relative(repositoryRoot, directory).replaceAll(path.sep, '/');

const runChecker = (...arguments_) =>
    spawnSync(process.execPath, [checker, ...arguments_], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });

after(() => {
    for (const directory of fixtureDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

describe('TypeScript 函数复杂度门禁', () => {
    it('报告生产函数的复杂度、位置和债务', () => {
        const directory = createFixtureProject();
        const projectDir = projectArgument(directory);
        fs.writeFileSync(
            path.join(directory, 'example.ts'),
            [
                'export function choose(left: boolean, right: boolean) {',
                '    if (left && right) return 1;',
                '    return 0;',
                '}',
            ].join('\n'),
        );

        const result = runChecker('--json', '--project-dir', projectDir, '--max-complexity', '2');

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout), {
            max_complexity: 2,
            diagnostics: [{ path: `${projectDir}/example.ts`, row: 1, function: 'choose', complexity: 3 }],
            counts: { 3: 1 },
            debt: 1,
        });
    });

    it('嵌套函数单独计数并排除测试辅助目录', () => {
        const directory = createFixtureProject();
        const projectDir = projectArgument(directory);
        fs.mkdirSync(path.join(directory, 'src/testing'), { recursive: true });
        fs.writeFileSync(
            path.join(directory, 'nested.ts'),
            'export function outer() { return function inner(value: boolean) { if (value) return 1; return 0; }; }',
        );
        fs.writeFileSync(
            path.join(directory, 'src/testing/helper.ts'),
            'export function ignored(value: boolean) { if (value) return 1; return 0; }',
        );

        const result = runChecker('--json', '--project-dir', projectDir, '--max-complexity', '1');

        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout).diagnostics, [
            { path: `${projectDir}/nested.ts`, row: 1, function: 'inner', complexity: 2 },
        ]);
    });

    it('超出数量或债务预算时门禁失败', () => {
        const directory = createFixtureProject();
        fs.writeFileSync(
            path.join(directory, 'example.ts'),
            'export function choose(value: boolean) { if (value) return 1; return 0; }',
        );

        const result = runChecker(
            '--project-dir',
            projectArgument(directory),
            '--max-complexity',
            '1',
            '--c2',
            '0',
            '--max-debt',
            '0',
        );

        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.match(result.stdout, /TypeScript 函数复杂度门禁失败/);
    });

    it('缺少 TypeScript 项目配置时失败关闭', () => {
        const directory = fs.mkdtempSync(path.join(repositoryRoot, '.ts-function-complexity-checker-test-'));
        fixtureDirectories.push(directory);

        const result = runChecker('--project-dir', projectArgument(directory));

        assert.equal(result.status, 2, result.stderr || result.stdout);
        assert.match(result.stderr, /项目目录缺少 package.json/);
    });

    it('未安装依赖时仍定位源码所属项目，不改选已安装的较小项目', () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-project-discovery-'));
        fixtureDirectories.push(directory);
        for (const project of ['app', 'small']) {
            fs.mkdirSync(path.join(directory, project));
            fs.writeFileSync(path.join(directory, project, 'package.json'), '{}');
        }
        fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), path.join(directory, 'small/node_modules'));
        const selected = discoverProjectDir(['app/a.ts', 'app/b.ts', 'small/a.ts'], directory);
        assert.equal(selected, 'app');
        assert.throws(() => loadTypeScript(selected, directory), /项目未安装 typescript.*app/);
        assert.throws(() => discoverProjectDir(['orphan/a.ts'], directory), /未找到生产 TypeScript 文件所属的 package.json/);
        assert.throws(() => discoverProjectDir(['app/a.test.ts'], directory), /无法自动发现/);
    });

    it('每个 TypeScript 检查器都有同名行为测试', () => {
        const checkerNames = fs
            .readdirSync(path.join(repositoryRoot, '.woodpecker'))
            .filter((name) => /^ts-.*-checker\.mjs$/.test(name));

        for (const name of checkerNames) {
            const testName = name.replace(/\.mjs$/, '.test.mjs');
            assert.ok(fs.existsSync(path.join(repositoryRoot, '.woodpecker', testName)), `${name} 缺少 ${testName}`);
        }
    });
});
