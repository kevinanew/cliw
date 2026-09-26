#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const METRICS = ['branches', 'functions', 'lines', 'statements'] as const;
type MetricName = typeof METRICS[number];
type Metric = { covered: number; total: number; percent: number };
type Metrics = Record<MetricName, Metric>;
type StoredMetric = { covered: number; total: number; percent?: number };
type Candidate = {
    file: string;
    lines: number[];
    functions: { name: string; line: number }[];
    branches: { line: number; arm: number }[];
};
type Snapshot = { project: string; metrics: Metrics; files: string[]; candidates: Candidate[] };
type StoredSnapshot = { project: string; metrics: Record<MetricName, StoredMetric>; files: string[] };
type CommandRunner = (command: string, arguments_: string[], cwd: string) => void;

const fail = (message: string): never => { throw new Error(message); };
const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> => {
    if (!isRecord(value)) throw new Error('覆盖率明细结构无效。');
    return value;
};
const lineAt = (value: unknown): number => {
    const line = record(value).line;
    if (!Number.isSafeInteger(line)) fail('覆盖率行号无效。');
    return line as number;
};
const locationLine = (value: unknown): number => lineAt(record(value).start);
const hits = (value: unknown): Record<string, unknown> => record(value);

export const discoverProjects = (directory: string): string[] => {
    const projects: string[] = [];
    const visit = (current: string): void => {
        const manifest = path.join(current, 'package.json');
        if (fs.existsSync(manifest)) {
            const pkg: unknown = JSON.parse(fs.readFileSync(manifest, 'utf8'));
            if (isRecord(pkg) && isRecord(pkg.scripts) && typeof pkg.scripts['test:coverage'] === 'string' && fs.existsSync(path.join(current, 'jest.config.json')))
                projects.push(current);
        }
        for (const entry of fs.readdirSync(current, { withFileTypes: true }))
            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
                visit(path.join(current, entry.name));
    };
    visit(directory);
    return projects;
};

export const coverageSnapshot = (summary: unknown, detail: unknown, project: string, repositoryRoot: string): Snapshot => {
    const details = record(detail);
    if (!Object.keys(details).length)
        fail('覆盖率明细为空或无效，不能视为全部覆盖。');
    const total = record(record(summary).total);
    const metrics = {} as Metrics;
    for (const name of METRICS) {
        const item = record(total[name]);
        const totalCount = item.total;
        const covered = item.covered;
        if (!Number.isSafeInteger(totalCount) || !Number.isSafeInteger(covered) ||
            (totalCount as number) < 0 || (covered as number) < 0 || (covered as number) > (totalCount as number))
            fail(`覆盖率统计无效: ${name}`);
        const validTotal = totalCount as number;
        const validCovered = covered as number;
        metrics[name] = { covered: validCovered, total: validTotal, percent: validTotal === 0 ? 100 : 100 * validCovered / validTotal };
    }
    const files = Object.keys(details).sort();
    const candidates = files.map((file): Candidate => {
        const entry = record(details[file]);
        const statements = hits(entry.s);
        const statementMap = record(entry.statementMap);
        const functions = hits(entry.f);
        const functionMap = record(entry.fnMap);
        const branches = hits(entry.b);
        const branchMap = record(entry.branchMap);
        return {
            file: path.relative(repositoryRoot, path.resolve(project, file)),
            lines: Object.entries(statements).filter(([, count]) => count === 0).map(([id]) => locationLine(statementMap[id])),
            functions: Object.entries(functions).filter(([, count]) => count === 0).map(([id]) => {
                const functionEntry = record(functionMap[id]);
                const name = functionEntry.name;
                if (typeof name !== 'string') throw new Error('覆盖率函数名无效。');
                return { name, line: locationLine(functionEntry.loc) };
            }),
            branches: Object.entries(branches).flatMap(([id, counts]) => {
                if (!Array.isArray(counts)) throw new Error('覆盖率分支统计无效。');
                return counts.flatMap((count: unknown, arm: number) => count === 0
                    ? [{ line: locationLine(record(branchMap[id]).loc), arm }] : []);
            }),
        };
    }).filter((item) => item.lines.length + item.functions.length + item.branches.length > 0).slice(0, 20);
    return { project: path.relative(repositoryRoot, project) || '.', metrics, files, candidates };
};

export const runCommand: CommandRunner = (command, arguments_, cwd) => {
    console.error(`覆盖率阶段：执行 ${command} ${arguments_.join(' ')}；等待完成，静默心跳由工作流显示；Ctrl+C 退出。`);
    const result = spawnSync(command, arguments_, { cwd, env: { ...process.env, CI: 'true' }, stdio: ['ignore', 2, 2] });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
};

export const measure = (repositoryRoot = process.cwd(), execute: CommandRunner = runCommand) => {
    const projects = discoverProjects(repositoryRoot);
    if (projects.length !== 1) fail('需要唯一的 pnpm/Jest 项目，包含 test:coverage 和 jest.config.json。');
    const project = projects[0];
    const report = fs.mkdtempSync(path.join(os.tmpdir(), 'ttyctl-refactor-coverage-'));
    console.error(`覆盖率报告保留于 ${report}`);
    execute('make', ['lint'], repositoryRoot);
    execute('pnpm', ['run', 'test:coverage', '--runInBand', `--coverageDirectory=${report}`, '--coverageReporters=text', '--coverageReporters=json', '--coverageReporters=json-summary'], project);
    const summary: unknown = JSON.parse(fs.readFileSync(path.join(report, 'coverage-summary.json'), 'utf8'));
    const detail: unknown = JSON.parse(fs.readFileSync(path.join(report, 'coverage-final.json'), 'utf8'));
    const snapshot = coverageSnapshot(summary, detail, project, repositoryRoot);
    const encoded = Buffer.from(JSON.stringify({ project: snapshot.project, metrics: snapshot.metrics, files: snapshot.files })).toString('base64url');
    return {
        snapshot: encoded,
        complete: METRICS.every((name) => snapshot.metrics[name].covered === snapshot.metrics[name].total),
        summary: JSON.stringify(snapshot.metrics),
        candidates: snapshot.candidates,
    };
};

export const decodeSnapshot = (value: string): StoredSnapshot => {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!isRecord(parsed)) throw new Error('覆盖率快照无效。');
    const { project, files, metrics: rawMetrics } = parsed;
    if (typeof project !== 'string' || !Array.isArray(files) ||
        !files.every((file) => typeof file === 'string') || !isRecord(rawMetrics))
        fail('覆盖率快照无效。');
    const metrics = {} as Record<MetricName, StoredMetric>;
    for (const name of METRICS) {
        const item = record(record(rawMetrics)[name]);
        if (!Number.isSafeInteger(item.total) || !Number.isSafeInteger(item.covered)) fail(`覆盖率快照无效: ${name}`);
        metrics[name] = {
            total: item.total as number,
            covered: item.covered as number,
            ...(typeof item.percent === 'number' ? { percent: item.percent } : {}),
        };
    }
    return { project: project as string, files: files as string[], metrics };
};

export const compare = (beforeEncoded: string, afterEncoded: string): void => {
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

export const main = (arguments_: string[] = process.argv.slice(2), measure_ = measure, compare_ = compare): void => {
    const [command, ...values] = arguments_;
    if (command === 'measure' && values.length === 0) console.log(JSON.stringify(measure_()));
    else if (command === 'compare' && values.length === 2) compare_(values[0], values[1]);
    else fail('用法: ts-coverage-checker.mjs measure | compare BEFORE AFTER');
};

export const isDirectExecution = (script = process.argv[1]): boolean => path.resolve(script ?? '') === fileURLToPath(import.meta.url);
export const reportError = (error: unknown): void => console.error(error instanceof Error ? error.message : String(error));

export const runEntryPoint = (direct = isDirectExecution, command = main, errorHandler = reportError): void => {
    try {
        if (direct()) command();
    } catch (error) {
        errorHandler(error);
        process.exitCode = 2;
    }
};

runEntryPoint();
