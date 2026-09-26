import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { coverageSnapshot } from './ts-coverage-checker.mjs';

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checker = path.join(repositoryRoot, '.woodpecker/ts-coverage-checker.mjs');
const metric = (covered: number, total = 10) => ({ covered, total });
const encoded = (covered: number, total = 10): string => Buffer.from(JSON.stringify({
    project: 'project', files: ['/project/example.ts'],
    metrics: Object.fromEntries(['branches', 'functions', 'lines', 'statements'].map((name) => [name, metric(covered, total)])),
})).toString('base64url');

describe('TypeScript 覆盖率检查器', () => {
    it('从 Jest 报告生成未覆盖候选', () => {
        const summary = { total: Object.fromEntries(['branches', 'functions', 'lines', 'statements'].map((name) => [name, metric(9)])) };
        const detail = { '/project/example.ts': {
            s: { 0: 0 }, statementMap: { 0: { start: { line: 3 } } },
            f: { 0: 0 }, fnMap: { 0: { name: 'work', loc: { start: { line: 2 } } } },
            b: { 0: [1, 0] }, branchMap: { 0: { loc: { start: { line: 4 } } } },
        } };
        assert.deepEqual(coverageSnapshot(summary, detail, '/project', '/').candidates, [{
            file: 'project/example.ts', lines: [3], functions: [{ name: 'work', line: 2 }], branches: [{ line: 4, arm: 1 }],
        }]);
    });

    it('接受不回退且达到最小增幅的结果', () => {
        const result = spawnSync(process.execPath, [checker, 'compare', encoded(5, 10000), encoded(7, 10000)], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
    });

    it('拒绝覆盖率回退', () => {
        const result = spawnSync(process.execPath, [checker, 'compare', encoded(6), encoded(5)], { encoding: 'utf8' });
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /覆盖率回退/);
    });
});
