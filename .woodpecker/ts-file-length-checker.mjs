#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DEFAULT_MAX_LINES = 500;
const STEP = 100;
const DEBT_TOLERANCE = 20;
const SOURCE_SUFFIXES = new Set(['.ts', '.tsx', '.mts', '.cts']);
const VALUE_OPTIONS = new Set(['--project-dir', '--max-lines', '--max-debt']);

const output = (message) => process.stdout.write(`${message}\n`);

const fail = (message) => {
    throw new Error(message);
};

export const nonnegativeInteger = (raw, option) => {
    if (!/^\d+$/.test(raw)) fail(`${option} 必须是非负整数`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) fail(`${option} 必须是非负整数`);
    return value;
};

export const collectValues = (arguments_) => {
    const values = new Map();
    let json = false;
    for (let index = 0; index < arguments_.length; index += 1) {
        const option = arguments_[index];
        if (option === '--json') {
            if (json) fail('参数重复: --json');
            json = true;
            continue;
        }
        if (!VALUE_OPTIONS.has(option) && !/^--l\d+$/.test(option)) fail(`不支持的参数: ${option}`);
        if (values.has(option)) fail(`参数重复: ${option}`);
        const raw = arguments_[index + 1];
        if (raw === undefined || raw.startsWith('--')) fail(`缺少参数值: ${option}`);
        values.set(option, raw);
        index += 1;
    }
    return { values, json };
};

export const parseProjectDir = (values) => {
    const projectDir = values.get('--project-dir') ?? '.';
    const normalized = path.posix.normalize(projectDir.replaceAll('\\', '/'));
    if (
        path.isAbsolute(projectDir) ||
        path.posix.isAbsolute(normalized) ||
        normalized === '..' ||
        normalized.startsWith('../')
    )
        fail('--project-dir 必须位于仓库内');
    return normalized === '.' ? normalized : normalized.replace(/\/$/, '');
};

export const parseLimits = (values, maximum) => {
    const limits = new Map();
    for (const [option, raw] of values) {
        if (!option.startsWith('--l')) continue;
        const threshold = Number(option.slice(3));
        if (threshold < maximum || (threshold - maximum) % STEP !== 0) fail('档位须从 --max-lines 起每 100 行递增');
        limits.set(threshold, nonnegativeInteger(raw, option));
    }
    return limits;
};

export const parseArguments = (arguments_) => {
    const { values, json } = collectValues(arguments_);
    const projectDir = parseProjectDir(values);
    const maximum = nonnegativeInteger(values.get('--max-lines') ?? String(DEFAULT_MAX_LINES), '--max-lines');
    if (maximum < STEP) fail('--max-lines 必须至少为 100');
    const maximumDebt = nonnegativeInteger(values.get('--max-debt') ?? '0', '--max-debt');
    const limits = parseLimits(values, maximum);
    if (json && (limits.size || values.has('--max-debt'))) fail('--json 不能与门禁预算同时使用');
    return { json, projectDir, maximum, maximumDebt, limits };
};

export const isProductionTypeScript = (filename) => {
    const basename = path.posix.basename(filename);
    const parts = filename.split('/');
    return (
        SOURCE_SUFFIXES.has(path.posix.extname(filename)) &&
        !parts.some((part) =>
            ['node_modules', 'dist', 'build', 'coverage', '__tests__', 'test', 'tests', 'e2e'].includes(part),
        ) &&
        !parts.some((part, index) => part === 'src' && parts[index + 1] === 'testing') &&
        !/(?:^|\.)(?:test|spec)\.[cm]?tsx?$/.test(basename) &&
        !basename.endsWith('.d.ts')
    );
};

export const scanFiles = (projectDir, repositoryRoot = REPOSITORY_ROOT) => {
    const absoluteProjectDir = path.resolve(repositoryRoot, projectDir);
    if (!fs.existsSync(absoluteProjectDir)) fail(`项目目录不存在: ${projectDir}`);
    const projectStat = fs.lstatSync(absoluteProjectDir);
    if (!projectStat.isDirectory()) fail(`--project-dir 必须指向目录: ${projectDir}`);
    const relativeProjectDir = path.relative(
        fs.realpathSync(repositoryRoot),
        fs.realpathSync(absoluteProjectDir),
    );
    if (
        relativeProjectDir === '..' ||
        relativeProjectDir.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeProjectDir)
    )
        fail('--project-dir 必须位于仓库内');

    const prefix = projectDir === '.' ? '' : `${projectDir}/`;
    const output = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    const files = {};
    for (const filename of [...new Set(output.split('\0'))].sort()) {
        if (!filename || !filename.startsWith(prefix) || !isProductionTypeScript(filename)) continue;
        const absolute = path.join(repositoryRoot, filename);
        if (!fs.existsSync(absolute)) continue;
        const stat = fs.lstatSync(absolute);
        if (stat.isSymbolicLink() || !stat.isFile()) fail(`生产文件不是普通文件: ${filename}`);
        const bytes = fs.readFileSync(absolute);
        files[filename] = bytes.length === 0 ? 0 : bytes.toString().split(/\r?\n/).length - Number(bytes.at(-1) === 10);
    }
    return files;
};

export const snapshot = (files, maximum) => {
    const counts = {};
    let debt = 0;
    for (const lines of Object.values(files)) {
        debt += Math.max(0, lines - maximum);
        for (let threshold = maximum; threshold < lines; threshold += STEP)
            counts[threshold] = (counts[threshold] ?? 0) + 1;
    }
    return { max_lines: maximum, step: STEP, files, counts, debt };
};

export const workflowPayload = (payload) => {
    const overlongFiles = Object.entries(payload.files)
        .filter(([, lines]) => lines > payload.max_lines)
        .sort(([leftPath, leftLines], [rightPath, rightLines]) => rightLines - leftLines || leftPath.localeCompare(rightPath))
        .map(([filePath, lines]) => ({
            path: filePath,
            lines,
            excess: lines - payload.max_lines,
        }));
    return {
        debt: payload.debt,
        overlong_count: overlongFiles.length,
        overlong_files: overlongFiles,
    };
};

export const printGate = (payload, limits, maximumDebt) => {
    let failed = false;
    output(`文件长度门禁（生产 TypeScript 文件，目标 ${payload.max_lines} 行，每 100 行一档）`);
    const thresholds = [...new Set([...Object.keys(payload.counts).map(Number), ...limits.keys()])].sort(
        (left, right) => left - right,
    );
    for (const threshold of thresholds) {
        const actual = payload.counts[threshold] ?? 0;
        const limit = limits.get(threshold) ?? 0;
        const exceeded = actual > limit;
        failed ||= exceeded;
        output(`超过 ${threshold} 行: 最多 ${limit} 个，现有 ${actual} 个（${exceeded ? '超标' : '通过'}）`);
    }
    const effectiveMaximum = maximumDebt + DEBT_TOLERANCE;
    failed ||= payload.debt > effectiveMaximum;
    output(`超限行数总和: 预算 ${maximumDebt}，允许增加 ${DEBT_TOLERANCE} 行，现有 ${payload.debt} 行`);
    output(failed ? '文件长度门禁失败。' : '文件长度门禁通过。');
    return Number(failed);
};

export const main = (arguments_ = process.argv.slice(2), repositoryRoot = REPOSITORY_ROOT) => {
    if (arguments_.some((argument) => ['--help', '-h'].includes(argument))) {
        output(
            '用法: ts-file-length-checker.mjs [--json] [--project-dir DIR] [--max-lines N] [--l500 N ... --max-debt N]',
        );
        return 0;
    }
    const options = parseArguments(arguments_);
    const payload = snapshot(scanFiles(options.projectDir, repositoryRoot), options.maximum);
    if (options.json) {
        output(JSON.stringify(workflowPayload(payload)));
        return 0;
    }
    return printGate(payload, options.limits, options.maximumDebt);
};

export const run = (arguments_ = process.argv.slice(2)) => {
    try {
        process.exitCode = main(arguments_);
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 2;
    }
};

export const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) run();
