import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTypeScript } from "./ts-function-complexity-checker.mjs";
import { scanSource } from "./ts-function-statements-checker.mjs";

const repositoryRoot = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const checker = path.join(
  repositoryRoot,
  ".woodpecker/ts-function-statements-checker.mjs",
);
const fixtureDirectories = [];

const createFixture = () => {
  const directory = fs.mkdtempSync(
    path.join(repositoryRoot, ".ts-function-statements-checker-test-"),
  );
  fixtureDirectories.push(directory);
  fs.writeFileSync(path.join(directory, "package.json"), '{"private":true}');
  return directory;
};

const runChecker = (...arguments_) =>
  spawnSync(process.execPath, [checker, ...arguments_], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

after(() => {
  for (const directory of fixtureDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("TypeScript 函数语句数门禁", () => {
  it("方法和箭头函数分别计数，嵌套函数的语句不计入外层", () => {
    const directory = createFixture();
    const projectDir = path
      .relative(repositoryRoot, directory)
      .replaceAll(path.sep, "/");
    fs.writeFileSync(
      path.join(directory, "example.ts"),
      [
        "function decorator(value: any) { return value; }",
        "class Example {",
        "    @decorator",
        "    method() {",
        "        const inner = () => {",
        "            return 1;",
        "        };",
        "        return inner();",
        "    }",
        "}",
      ].join("\n"),
    );

    const result = runChecker("--json", "--project-dir", projectDir);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).over_limit_functions, []);
    assert.deepEqual(
      scanSource(
        loadTypeScript("."),
        "example.ts",
        fs.readFileSync(path.join(directory, "example.ts"), "utf8"),
      ),
      [
        { path: "example.ts", row: 1, function: "decorator", statements: 1 },
        { path: "example.ts", row: 3, function: "method", statements: 2 },
        { path: "example.ts", row: 5, function: "<anonymous>", statements: 1 },
      ],
    );
  });

  it("在 50 条语句以上继续累计十条档位，并按预算返回失败", () => {
    const directory = createFixture();
    const projectDir = path
      .relative(repositoryRoot, directory)
      .replaceAll(path.sep, "/");
    const body = Array.from(
      { length: 61 },
      (_, index) => `    const value${index} = ${index};`,
    );
    fs.writeFileSync(
      path.join(directory, "long.ts"),
      ["export function long() {", body.join(" "), "}"].join("\n"),
    );

    const snapshot = runChecker("--json", "--project-dir", projectDir);
    assert.equal(snapshot.status, 0, snapshot.stderr);
    assert.deepEqual(JSON.parse(snapshot.stdout).counts, {
      30: 1,
      40: 1,
      50: 1,
      60: 1,
    });

    const passing = runChecker(
      "--project-dir",
      projectDir,
      "--s30",
      "1",
      "--s40",
      "1",
      "--s50",
      "1",
      "--s60",
      "1",
    );
    const failing = runChecker(
      "--project-dir",
      projectDir,
      "--s30",
      "1",
      "--s40",
      "1",
      "--s50",
      "1",
      "--s60",
      "0",
    );
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(failing.status, 1, failing.stderr);
  });

  it("拒绝非十条语句档位及错误源码", () => {
    const directory = createFixture();
    const projectDir = path
      .relative(repositoryRoot, directory)
      .replaceAll(path.sep, "/");
    const invalidTier = runChecker("--project-dir", projectDir, "--s55", "1");
    assert.equal(invalidTier.status, 2);

    fs.writeFileSync(path.join(directory, "broken.ts"), "function broken( {");
    const invalidSource = runChecker("--project-dir", projectDir);
    assert.equal(invalidSource.status, 2);
    assert.match(invalidSource.stderr, /无法解析 TypeScript 文件/);
  });
});
