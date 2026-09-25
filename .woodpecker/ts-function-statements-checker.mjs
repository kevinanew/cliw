#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverProjectDir,
  loadTypeScript,
} from "./ts-function-complexity-checker.mjs";
import {
  nonnegativeInteger,
  parseProjectDir,
  scanFiles,
} from "./ts-file-length-checker.mjs";

const REPOSITORY_ROOT = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const MIN_STATEMENTS = 30;
const STEP = 10;

const fail = (message) => {
  throw new Error(message);
};

export const parseArguments = (arguments_) => {
  const values = new Map();
  let json = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (option === "--json") {
      if (json) fail("参数重复: --json");
      json = true;
      continue;
    }
    if (option !== "--project-dir" && !/^--s\d+$/.test(option))
      fail(`不支持的参数: ${option}`);
    if (values.has(option)) fail(`参数重复: ${option}`);
    const raw = arguments_[++index];
    if (raw === undefined || raw.startsWith("--"))
      fail(`缺少参数值: ${option}`);
    values.set(option, raw);
  }
  const projectDir = parseProjectDir(values);
  const limits = new Map();
  for (const [option, raw] of values) {
    if (!option.startsWith("--s")) continue;
    const threshold = nonnegativeInteger(option.slice(3), option);
    if (threshold < MIN_STATEMENTS || (threshold - MIN_STATEMENTS) % STEP)
      fail("档位须从 30 条语句起每 10 条递增");
    limits.set(threshold, nonnegativeInteger(raw, option));
  }
  if (json && limits.size) fail("--json 不能与门禁预算同时使用");
  return { json, projectDir, limits };
};

export const scanSource = (ts, filename, text) => {
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (source.parseDiagnostics.length)
    fail(
      `无法解析 TypeScript 文件 ${filename}: ${source.parseDiagnostics[0].messageText}`,
    );
  const functions = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const start =
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      let statements = 0;
      const count = (child) => {
        if (child !== node.body && ts.isFunctionLike(child)) return;
        if (ts.isStatement(child) && !ts.isBlock(child)) statements += 1;
        ts.forEachChild(child, count);
      };
      count(node.body);
      if (!ts.isBlock(node.body)) statements += 1;
      functions.push({
        path: filename,
        row: start,
        function: node.name?.getText(source) ?? "<anonymous>",
        statements,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return functions;
};

export const scan = (projectDir = ".", repositoryRoot = REPOSITORY_ROOT) => {
  const files = scanFiles(projectDir, repositoryRoot);
  const sourceProject =
    projectDir === "."
      ? discoverProjectDir(Object.keys(files), repositoryRoot)
      : projectDir;
  const ts = loadTypeScript(sourceProject, repositoryRoot);
  const prefix = sourceProject === "." ? "" : `${sourceProject}/`;
  const functions = Object.keys(files)
    .filter((filename) => filename.startsWith(prefix))
    .flatMap((filename) =>
      scanSource(
        ts,
        filename,
        fs.readFileSync(path.join(repositoryRoot, filename), "utf8"),
      ),
    );
  functions.sort(
    (left, right) =>
      right.statements - left.statements ||
      left.path.localeCompare(right.path) ||
      left.row - right.row,
  );
  const longest = functions[0]?.statements ?? 0;
  const thresholds = [];
  const counts = {};
  for (
    let threshold = MIN_STATEMENTS;
    threshold < Math.max(60, longest);
    threshold += STEP
  ) {
    thresholds.push(threshold);
    counts[threshold] = functions.filter(
      (item) => item.statements > threshold,
    ).length;
  }
  return {
    thresholds,
    counts,
    debt: functions.reduce(
      (total, item) => total + Math.max(0, item.statements - MIN_STATEMENTS),
      0,
    ),
    over_limit_functions: functions.filter(
      (item) => item.statements > MIN_STATEMENTS,
    ),
  };
};

export const printGate = (payload, limits) => {
  let failed = false;
  console.log("函数语句数门禁（生产 TypeScript 函数；累计统计）");
  const thresholds = [
    ...new Set([...payload.thresholds, ...limits.keys()]),
  ].sort((left, right) => left - right);
  for (const threshold of thresholds) {
    const actual = payload.counts[threshold] ?? 0;
    const limit = limits.get(threshold) ?? 0;
    const exceeded = actual > limit;
    failed ||= exceeded;
    const suffix = limits.has(threshold) ? "" : "（未配置，默认 0）";
    console.log(
      `超过 ${threshold} 条语句: 最多 ${limit} 个${suffix}，现有 ${actual} 个（${exceeded ? "超标" : "通过"}）`,
    );
  }
  console.log(
    failed
      ? "TypeScript 函数语句数门禁失败。"
      : "TypeScript 函数语句数门禁通过。",
  );
  return Number(failed);
};

export const main = (
  arguments_ = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
) => {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0])) {
    console.log(
      "用法: ts-function-statements-checker.mjs [--json] [--project-dir DIR] [--s30 N --s40 N --s50 N --s60 N ...]",
    );
    return 0;
  }
  const options = parseArguments(arguments_);
  const payload = scan(options.projectDir, repositoryRoot);
  if (options.json) {
    console.log(JSON.stringify(payload));
    return 0;
  }
  return printGate(payload, options.limits);
};

export const run = (arguments_ = process.argv.slice(2), main_ = main) => {
  try {
    process.exitCode = main_(arguments_);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  run();
