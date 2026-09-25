#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProjectDir } from "./ts-file-length-checker.mjs";
import { scan } from "./ts-function-statements-checker.mjs";

const REPOSITORY_ROOT = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const GATE_PREFIX = "node .woodpecker/ts-function-statements-checker.mjs";
const GATE_PATTERN =
  /^\t(?<command>node \.woodpecker\/ts-function-statements-checker\.mjs(?: --s\d+ \d+)*)[ \t]*$/gm;

const fail = (message) => {
  throw new Error(message);
};

export const parseArguments = (arguments_) => {
  const values = new Map();
  let install = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const option = arguments_[index];
    if (option === "--install") {
      if (install) fail("参数重复: --install");
      install = true;
      continue;
    }
    if (option !== "--project-dir" || values.has(option))
      fail(`不支持或重复的参数: ${option}`);
    const raw = arguments_[++index];
    if (raw === undefined || raw.startsWith("--"))
      fail("缺少 --project-dir 的目录值");
    values.set(option, raw);
  }
  return { install, projectDir: parseProjectDir(values) };
};

export const gateCommand = (counts) => {
  const levels = Object.keys(counts)
    .map(Number)
    .sort((left, right) => left - right);
  const options = levels
    .filter((level) => level === 30 || counts[level] > 0)
    .flatMap((level) => [`--s${level}`, String(counts[level])]);
  return [GATE_PREFIX, ...options].join(" ");
};

export const tightenMakefile = (source, counts, install = false) => {
  const targets = [...source.matchAll(/^lint:[^\n]*$/gm)];
  if (targets.length !== 1) fail("Makefile 必须恰好包含一个 lint 任务");
  const lintStart = targets[0].index + targets[0][0].length + 1;
  const nextTarget = /^[^\t #][^:\n]*:/gm;
  nextTarget.lastIndex = lintStart;
  const lintEnd = nextTarget.exec(source)?.index ?? source.length;
  const matches = [...source.matchAll(GATE_PATTERN)];
  if (
    matches.length > 1 ||
    (matches.length === 1 &&
      (matches[0].index < lintStart || matches[0].index >= lintEnd))
  )
    fail("语句数门禁必须只出现在 lint 任务中");
  if (matches.length === 0) {
    if (!install || source.includes(GATE_PREFIX))
      fail("lint 任务缺少函数语句数门禁");
    return (
      source.slice(0, lintStart) +
      `\t${gateCommand(counts)}\n` +
      source.slice(lintStart)
    );
  }
  const match = matches[0];
  const limits = new Map();
  for (const [, thresholdText, limitText] of match.groups.command.matchAll(
    /--s(\d+) (\d+)/g,
  )) {
    const threshold = Number(thresholdText);
    if (limits.has(threshold) || threshold < 30 || (threshold - 30) % 10)
      fail("门禁档位无效或重复");
    limits.set(threshold, Number(limitText));
  }
  if (!limits.has(30)) fail("语句数门禁必须包含 --s30 档位");
  const exceeded = Object.entries(counts).filter(
    ([level, count]) => count > (limits.get(Number(level)) ?? 0),
  );
  if (exceeded.length)
    fail(`现有函数语句数超过既有预算，拒绝放宽: ${JSON.stringify(exceeded)}`);
  return (
    source.slice(0, match.index) +
    `\t${gateCommand(counts)}` +
    source.slice(match.index + match[0].length)
  );
};

export const main = (
  arguments_ = process.argv.slice(2),
  repositoryRoot = REPOSITORY_ROOT,
) => {
  if (arguments_.length === 1 && ["--help", "-h"].includes(arguments_[0])) {
    console.log(
      "用法: tighten-ts-function-statements-gate.mjs [--install] [--project-dir DIR]",
    );
    return 0;
  }
  const { install, projectDir } = parseArguments(arguments_);
  const makefile = path.join(repositoryRoot, "Makefile");
  const source = fs.readFileSync(makefile, "utf8");
  const updated = tightenMakefile(
    source,
    scan(projectDir, repositoryRoot).counts,
    install,
  );
  if (updated === source) {
    console.log("TypeScript 函数语句数门禁已是当前实测值，无需更新。");
    return 0;
  }
  const temporary = `${makefile}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, updated, { mode: fs.statSync(makefile).mode });
    fs.renameSync(temporary, makefile);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  console.log("已收紧 Makefile 中的 TypeScript 函数语句数门禁。");
  return 0;
};

export const run = (arguments_ = process.argv.slice(2)) => {
  try {
    process.exitCode = main(arguments_);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
};

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  run();
