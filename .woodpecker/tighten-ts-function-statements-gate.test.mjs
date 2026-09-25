import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tightenMakefile } from "./tighten-ts-function-statements-gate.mjs";

describe("TypeScript 函数语句数门禁收紧", () => {
  it("首次安装后只收紧预算，并保留其余 Makefile 内容", () => {
    const original = "lint:\n\tpnpm run lint\n\ntest: lint\n\tpnpm test\n";
    const installed = tightenMakefile(original, { 30: 3, 40: 1, 50: 0 }, true);
    assert.equal(
      installed,
      original.replace(
        "lint:\n",
        "lint:\n\tnode .woodpecker/ts-function-statements-checker.mjs --s30 3 --s40 1\n",
      ),
    );
    assert.equal(
      tightenMakefile(installed, { 30: 2, 40: 0, 50: 0 }),
      installed.replace("--s30 3 --s40 1", "--s30 2"),
    );
  });

  it("高档函数数量增加时拒绝放宽预算", () => {
    const source =
      "lint:\n\tnode .woodpecker/ts-function-statements-checker.mjs --s30 3 --s40 1\n";
    assert.throws(() => tightenMakefile(source, { 30: 3, 40: 2 }), /拒绝放宽/);
  });

  it("门禁缺失、出现在其他任务或重复时拒绝收紧", () => {
    assert.throws(
      () => tightenMakefile("lint:\n\tpnpm run lint\n", { 30: 0 }),
      /缺少/,
    );
    const wrongTask =
      "lint:\n\tpnpm run lint\n\ntest:\n\tnode .woodpecker/ts-function-statements-checker.mjs --s30 1\n";
    assert.throws(() => tightenMakefile(wrongTask, { 30: 1 }, true), /lint/);
  });
});
