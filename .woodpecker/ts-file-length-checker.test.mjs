import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checker = path.join(repositoryRoot, '.woodpecker/ts-file-length-checker.mjs');
const fixtureDirectories = [];

const createFixtureDirectory = () => {
    const directory = fs.mkdtempSync(path.join(repositoryRoot, '.ts-file-length-checker-test-'));
    fixtureDirectories.push(directory);
    return directory;
};

const projectArgument = (directory) => path.relative(repositoryRoot, directory).replaceAll(path.sep, '/');

const runChecker = (...arguments_) =>
    spawnSync(process.execPath, [checker, ...arguments_], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });

const sourceWithLines = (lineCount) =>
    Array.from({ length: lineCount }, (_, index) => `export const value${index} = ${index};`).join('\n');

after(() => {
    for (const directory of fixtureDirectories) fs.rmSync(directory, { recursive: true, force: true });
});

describe('TypeScript 文件长度门禁', () => {
    it('超出预算的生产文件以非零状态退出', () => {
        const directory = createFixtureDirectory();
        fs.writeFileSync(path.join(directory, 'oversized.ts'), sourceWithLines(121));

        const result = runChecker(
            '--project-dir',
            projectArgument(directory),
            '--max-lines',
            '100',
            '--l100',
            '0',
            '--max-debt',
            '0',
        );

        assert.equal(result.status, 1, result.stderr || result.stdout);
        assert.match(result.stdout, /文件长度门禁失败/);
    });

    it('排除 src/testing 中的测试辅助文件', () => {
        const directory = createFixtureDirectory();
        const testingDirectory = path.join(directory, 'src/testing');
        const productionDirectory = path.join(directory, 'src/runtime');
        fs.mkdirSync(testingDirectory, { recursive: true });
        fs.mkdirSync(productionDirectory, { recursive: true });
        fs.writeFileSync(path.join(testingDirectory, 'helper.ts'), sourceWithLines(121));
        fs.writeFileSync(path.join(productionDirectory, 'production.ts'), sourceWithLines(121));

        const result = runChecker('--json', '--project-dir', projectArgument(directory), '--max-lines', '100');

        assert.equal(result.status, 0, result.stderr);
        const payload = JSON.parse(result.stdout);
        assert.deepEqual(payload.overlong_files, [
            {
                path: `${projectArgument(directory)}/src/runtime/production.ts`,
                lines: 121,
                excess: 21,
            },
        ]);
    });

    it('不存在的项目目录失败关闭', () => {
        const result = runChecker('--project-dir', `.missing-ts-project-${process.pid}`);

        assert.equal(result.status, 2, result.stderr || result.stdout);
        assert.match(result.stderr, /项目目录不存在/);
    });

    it('文件不能用作项目目录', () => {
        const result = runChecker('--project-dir', 'package.json');

        assert.equal(result.status, 2, result.stderr || result.stdout);
        assert.match(result.stderr, /--project-dir 必须指向目录/);
    });

    it('合法空目录可以通过门禁', () => {
        const directory = createFixtureDirectory();
        const result = runChecker('--project-dir', `${projectArgument(directory)}/`);

        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /文件长度门禁通过/);
    });
});
