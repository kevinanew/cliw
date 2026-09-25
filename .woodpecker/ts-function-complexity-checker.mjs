#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SOURCE_SUFFIXES = new Set(['.ts', '.tsx', '.mts', '.cts']);
const VALUE_OPTIONS = new Set(['--project-dir', '--max-complexity', '--max-debt']);

export const fail = (message) => {
    throw new Error(message);
};

export const integer = (raw, option, minimum = 0) => {
    if (!/^\d+$/.test(raw)) fail(`${option} 必须是不小于 ${minimum} 的整数`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) fail(`${option} 必须是不小于 ${minimum} 的整数`);
    return value;
};

export const parseArguments = (arguments_) => {
    const values = new Map();
    let json = false;
    for (let index = 0; index < arguments_.length; index += 1) {
        const option = arguments_[index];
        if (option === '--json') {
            if (json) fail('参数重复: --json');
            json = true;
            continue;
        }
        if (!VALUE_OPTIONS.has(option) && !/^--c\d+$/.test(option)) fail(`不支持的参数: ${option}`);
        if (values.has(option)) fail(`参数重复: ${option}`);
        const raw = arguments_[++index];
        if (raw === undefined || raw.startsWith('--')) fail(`缺少参数值: ${option}`);
        values.set(option, raw);
    }
    const configuredProjectDir = values.get('--project-dir');
    const projectDir = configuredProjectDir
        ? path.posix.normalize(configuredProjectDir.replaceAll('\\', '/'))
        : undefined;
    if (projectDir && (path.posix.isAbsolute(projectDir) || projectDir === '..' || projectDir.startsWith('../')))
        fail('--project-dir 必须位于仓库内');
    const maximum = integer(values.get('--max-complexity') ?? '6', '--max-complexity', 1);
    const maximumDebt = integer(values.get('--max-debt') ?? '0', '--max-debt');
    const limits = new Map();
    for (const [option, raw] of values) {
        if (!option.startsWith('--c')) continue;
        const level = integer(option.slice(3), option, maximum + 1);
        limits.set(level, integer(raw, option));
    }
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

export const loadTypeScript = (projectDir, repositoryRoot = REPOSITORY_ROOT) => {
    const packageFile = path.join(repositoryRoot, projectDir, 'package.json');
    if (!fs.existsSync(packageFile)) fail(`项目目录缺少 package.json: ${projectDir}`);
    try {
        return createRequire(packageFile)('typescript');
    } catch {
        fail(`项目未安装 typescript 或无法加载: ${projectDir}；请在对应 workspace 根目录按锁文件安装包含开发依赖的项目依赖，再重试。--project-dir 不能替代依赖安装`);
    }
};

export const discoverProjectDir = (tracked, repositoryRoot = REPOSITORY_ROOT) => {
    const counts = new Map();
    for (const filename of tracked) {
        if (!isProductionTypeScript(filename)) continue;
        let directory = path.posix.dirname(filename);
        while (true) {
            if (fs.existsSync(path.join(repositoryRoot, directory, 'package.json'))) {
                counts.set(directory, (counts.get(directory) ?? 0) + 1);
                break;
            }
            if (directory === '.') break;
            directory = path.posix.dirname(directory);
        }
    }
    const discovered = [...counts].sort(
        ([leftDirectory, leftCount], [rightDirectory, rightCount]) =>
            rightCount - leftCount || leftDirectory.localeCompare(rightDirectory),
    )[0]?.[0];
    if (!discovered)
        fail('无法自动发现 TypeScript 项目：未找到生产 TypeScript 文件所属的 package.json；请确认仓库及源码范围，或使用 --project-dir 指定项目目录');
    return discovered;
};

export const decisionCost = (ts, node) => {
    if (
        ts.isIfStatement(node) ||
        ts.isForStatement(node) ||
        ts.isForInStatement(node) ||
        ts.isForOfStatement(node) ||
        ts.isWhileStatement(node) ||
        ts.isDoStatement(node) ||
        ts.isCatchClause(node) ||
        ts.isConditionalExpression(node) ||
        ts.isCaseClause(node)
    )
        return 1;
    return Number(
        ts.isBinaryExpression(node) &&
            [
                ts.SyntaxKind.AmpersandAmpersandToken,
                ts.SyntaxKind.BarBarToken,
                ts.SyntaxKind.QuestionQuestionToken,
            ].includes(node.operatorToken.kind),
    );
};

export const scanSource = (ts, filename, text, maximum) => {
    const source = ts.createSourceFile(
        filename,
        text,
        ts.ScriptTarget.Latest,
        true,
        filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const diagnostics = [];
    const visit = (node) => {
        if (ts.isFunctionLike(node) && node.body) {
            let complexity = 1;
            const count = (child) => {
                if (child !== node && ts.isFunctionLike(child)) return;
                complexity += decisionCost(ts, child);
                ts.forEachChild(child, count);
            };
            count(node.body);
            if (complexity > maximum) {
                const name = node.name?.getText(source) ?? '<anonymous>';
                diagnostics.push({
                    path: filename,
                    row: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                    function: name,
                    complexity,
                });
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return diagnostics;
};

export const scan = (options, repositoryRoot = REPOSITORY_ROOT) => {
    const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
    });
    const filenames = [...new Set(tracked.split('\0'))];
    const projectDir = options.projectDir ?? discoverProjectDir(filenames, repositoryRoot);
    const ts = loadTypeScript(projectDir, repositoryRoot);
    const prefix = projectDir === '.' ? '' : `${projectDir}/`;
    const diagnostics = filenames.flatMap((filename) => {
        if (!filename.startsWith(prefix) || !isProductionTypeScript(filename)) return [];
        const absolute = path.join(repositoryRoot, filename);
        if (!fs.existsSync(absolute)) return [];
        const stat = fs.lstatSync(absolute);
        if (!stat.isFile() || stat.isSymbolicLink()) fail(`生产文件不是普通文件: ${filename}`);
        return scanSource(ts, filename, fs.readFileSync(absolute, 'utf8'), options.maximum);
    });
    diagnostics.sort(
        (left, right) =>
            right.complexity - left.complexity || left.path.localeCompare(right.path) || left.row - right.row,
    );
    const counts = {};
    let debt = 0;
    for (const item of diagnostics) {
        counts[item.complexity] = (counts[item.complexity] ?? 0) + 1;
        debt += item.complexity - options.maximum;
    }
    return { max_complexity: options.maximum, diagnostics, counts, debt };
};

export const printGate = (snapshot, options) => {
    let failed = snapshot.debt > options.maximumDebt;
    const levels = [...new Set([...Object.keys(snapshot.counts).map(Number), ...options.limits.keys()])].sort(
        (left, right) => left - right,
    );
    for (const level of levels) {
        const actual = snapshot.counts[level] ?? 0;
        const limit = options.limits.get(level) ?? 0;
        failed ||= actual > limit;
        console.log(`复杂度 ${level}: 最多 ${limit} 个，现有 ${actual} 个`);
    }
    console.log(`复杂度债务: 预算 ${options.maximumDebt}，现有 ${snapshot.debt}`);
    console.log(failed ? 'TypeScript 函数复杂度门禁失败。' : 'TypeScript 函数复杂度门禁通过。');
    return Number(failed);
};

export const run = (arguments_ = process.argv.slice(2)) => {
    try {
        const options = parseArguments(arguments_);
        const snapshot = scan(options);
        if (options.json) console.log(JSON.stringify(snapshot));
        else process.exitCode = printGate(snapshot, options);
    } catch (error) {
        console.error(errorMessage(error));
        process.exitCode = 2;
    }
};

export const errorMessage = (error) => (error instanceof Error ? error.message : String(error));

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) run();
