#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = ['branches', 'functions', 'lines', 'statements'];
const fail = (message) => { throw new Error(message); };

export const discoverProjects = (directory) => {
    const projects = [];
    const visit = (current) => {
        const manifest = path.join(current, 'package.json');
        if (fs.existsSync(manifest)) {
            const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
            if (typeof pkg.scripts?.['test:coverage'] === 'string' && fs.existsSync(path.join(current, 'jest.config.json')))
                projects.push(current);
        }
        for (const entry of fs.readdirSync(current, { withFileTypes: true }))
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
                visit(path.join(current, entry.name));
    };
    visit(directory);
    return projects;
};

export const coverageSnapshot = (summary, detail, project, repositoryRoot) => {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail) || !Object.keys(detail).length)
        fail('覆盖率明细为空或无效，不能视为全部覆盖。');
    const metrics = {};
    for (const name of METRICS) {
        const item = summary.total?.[name];
        if (!item || !Number.isSafeInteger(item.total) || !Number.isSafeInteger(item.covered) || item.total < 0 || item.covered < 0 || item.covered > item.total)
            fail(`覆盖率统计无效: ${name}`);
        metrics[name] = { covered: item.covered, total: item.total, percent: item.total === 0 ? 100 : 100 * item.covered / item.total };
    }
    const files = Object.keys(detail).sort();
    const candidates = files.map((file) => {
        const entry = detail[file];
        return {
            file: path.relative(repositoryRoot, path.resolve(project, file)),
            lines: Object.entries(entry.s).filter(([, hits]) => hits === 0).map(([id]) => entry.statementMap[id].start.line),
            functions: Object.entries(entry.f).filter(([, hits]) => hits === 0).map(([id]) => ({ name: entry.fnMap[id].name, line: entry.fnMap[id].loc.start.line })),
            branches: Object.entries(entry.b).flatMap(([id, hits]) => hits.flatMap((count, arm) => count === 0 ? [{ line: entry.branchMap[id].loc.start.line, arm }] : [])),
        };
    }).filter((item) => item.lines.length + item.functions.length + item.branches.length > 0).slice(0, 20);
    return { project: path.relative(repositoryRoot, project) || '.', metrics, files, candidates };
};

export const runCommand = (command, arguments_, cwd) => {
    console.error(`覆盖率阶段：执行 ${command} ${arguments_.join(' ')}；等待完成，静默心跳由工作流显示；Ctrl+C 退出。`);
    const result = spawnSync(command, arguments_, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 2, 2] });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
};

export const measure = (repositoryRoot = process.cwd(), execute = runCommand) => {
    const projects = discoverProjects(repositoryRoot);
    if (projects.length !== 1) fail('需要唯一的 pnpm/Jest 项目，包含 test:coverage 和 jest.config.json。');
    const project = projects[0];
    const report = fs.mkdtempSync(path.join(os.tmpdir(), 'ttyctl-refactor-coverage-'));
    console.error(`覆盖率报告保留于 ${report}`);
    execute('make', ['lint'], repositoryRoot);
    execute('pnpm', ['run', 'test:coverage', '--runInBand', `--coverageDirectory=${report}`, '--coverageReporters=text', '--coverageReporters=json', '--coverageReporters=json-summary'], project);
    const summary = JSON.parse(fs.readFileSync(path.join(report, 'coverage-summary.json'), 'utf8'));
    const detail = JSON.parse(fs.readFileSync(path.join(report, 'coverage-final.json'), 'utf8'));
    const snapshot = coverageSnapshot(summary, detail, project, repositoryRoot);
    const encoded = Buffer.from(JSON.stringify({ project: snapshot.project, metrics: snapshot.metrics, files: snapshot.files })).toString('base64url');
    return {
        snapshot: encoded,
        complete: METRICS.every((name) => snapshot.metrics[name].covered === snapshot.metrics[name].total),
        summary: JSON.stringify(snapshot.metrics),
        candidates: snapshot.candidates,
    };
};

export const decodeSnapshot = (value) => JSON.parse(Buffer.from(value, 'base64url').toString());

export const compare = (beforeEncoded, afterEncoded) => {
    const before = decodeSnapshot(beforeEncoded);
    const after = decodeSnapshot(afterEncoded);
    if (before.project !== after.project || JSON.stringify(before.files) !== JSON.stringify(after.files))
        fail('覆盖率统计项目或文件范围发生变化，停止并保留现场。');
    for (const name of METRICS)
        if (after.metrics[name].total !== before.metrics[name].total || after.metrics[name].covered < before.metrics[name].covered)
            fail(`${name} 覆盖率回退或统计总数变化，停止并保留现场。`);
    const complete = METRICS.every((name) => after.metrics[name].covered === after.metrics[name].total);
    const improved = METRICS.some((name) => {
        const previous = before.metrics[name];
        const current = after.metrics[name];
        return current.covered > previous.covered && (current.covered - previous.covered) * 5000 >= current.total;
    });
    if (!complete && !improved) fail('至少一项覆盖率需要提高 0.02 个百分点，停止并保留现场。');
    console.error(`覆盖率验证通过：${JSON.stringify(before.metrics)} → ${JSON.stringify(after.metrics)}`);
};

export const main = (arguments_ = process.argv.slice(2), measure_ = measure, compare_ = compare) => {
    const [command, ...values] = arguments_;
    if (command === 'measure' && values.length === 0) console.log(JSON.stringify(measure_()));
    else if (command === 'compare' && values.length === 2) compare_(...values);
    else fail('用法: ts-coverage-checker.mjs measure | compare BEFORE AFTER');
};

export const isDirectExecution = (script = process.argv[1]) => path.resolve(script ?? '') === fileURLToPath(import.meta.url);
export const reportError = (error) => console.error(error instanceof Error ? error.message : String(error));

export const runEntryPoint = (direct = isDirectExecution, command = main, errorHandler = reportError) => {
    try {
        if (direct()) command();
    } catch (error) {
        errorHandler(error);
        process.exitCode = 2;
    }
};

runEntryPoint();
