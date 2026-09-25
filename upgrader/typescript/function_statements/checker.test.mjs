import fs from "node:fs";
import path from "node:path";
import { loadTypeScript } from "../../../.woodpecker/ts-function-complexity-checker.mjs";
import {
  main,
  parseArguments,
  printGate,
  run,
  scan,
  scanSource,
} from "../../../.woodpecker/ts-function-statements-checker.mjs";

const directories = [];
const repositoryRoot = process.cwd();
const checkerPath = path.join(
  repositoryRoot,
  ".woodpecker/ts-function-statements-checker.mjs",
);
const fixture = (source = "") => {
  const root = fs.mkdtempSync(path.join(repositoryRoot, ".ts-statements-"));
  directories.push(root);
  fs.writeFileSync(path.join(root, "package.json"), '{"private":true}');
  fs.writeFileSync(path.join(root, "example.ts"), source);
  return root;
};

afterEach(() => {
  jest.restoreAllMocks();
  process.exitCode = 0;
});

afterAll(() => {
  for (const directory of directories)
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("TypeScript 函数语句数检查器", () => {
  test("参数解析校验重复项、预算档位和 JSON 模式", () => {
    expect(parseArguments([])).toEqual({
      json: false,
      projectDir: ".",
      limits: new Map(),
    });
    expect(parseArguments(["--json", "--project-dir", "."])).toEqual({
      json: true,
      projectDir: ".",
      limits: new Map(),
    });
    expect(parseArguments(["--s30", "1", "--s40", "0"]).limits).toEqual(
      new Map([
        [30, 1],
        [40, 0],
      ]),
    );
    for (const args of [
      ["--json", "--json"],
      ["--bad"],
      ["--s30", "1", "--s30", "2"],
      ["--s30"],
      ["--s30", "--json"],
      ["--s29", "0"],
      ["--s35", "0"],
      ["--s30", "bad"],
      ["--json", "--s30", "1"],
    ])
      expect(() => parseArguments(args)).toThrow();
  });

  test("统计函数、方法、箭头及嵌套函数，拒绝错误源码", () => {
    const ts = loadTypeScript(".");
    const source = [
      "function named() { const inner = () => 1; return inner(); }",
      "class Example { method() { return 1; } }",
      "const arrow = () => { return 2; };",
    ].join("\n");
    expect(scanSource(ts, "example.ts", source)).toEqual([
      { path: "example.ts", row: 1, function: "named", statements: 2 },
      { path: "example.ts", row: 1, function: "<anonymous>", statements: 1 },
      { path: "example.ts", row: 2, function: "method", statements: 1 },
      { path: "example.ts", row: 3, function: "<anonymous>", statements: 1 },
    ]);
    expect(() => scanSource(ts, "broken.tsx", "function broken( {")).toThrow(
      "无法解析 TypeScript 文件",
    );
  });

  test("扫描累计档位", () => {
    const root = fixture("export function short() { return 1; }");
    const projectDir = path.relative(repositoryRoot, root);
    expect(scan(projectDir, repositoryRoot)).toEqual({
      thresholds: [30, 40, 50],
      counts: { 30: 0, 40: 0, 50: 0 },
      debt: 0,
      over_limit_functions: [],
    });
    const body = (count) =>
      Array.from(
        { length: count },
        (_, index) => `const x${index} = ${index};`,
      ).join(" ");
    const long = `export function long() { ${body(61)} }`;
    fs.writeFileSync(
      path.join(root, "example.ts"),
      `${long}\nexport function short() { ${body(31)} }`,
    );
    fs.writeFileSync(
      path.join(root, "other.ts"),
      `export function first() { ${body(31)} }\nexport function second() { ${body(31)} }`,
    );
    const result = scan(projectDir, repositoryRoot);
    expect(result.thresholds).toEqual([30, 40, 50, 60]);
    expect(result.counts).toEqual({ 30: 4, 40: 1, 50: 1, 60: 1 });
    expect(result.over_limit_functions[0].statements).toBe(61);
    expect(
      result.over_limit_functions.map(({ path: filename, row }) => [
        path.basename(filename),
        row,
      ]),
    ).toEqual([
      ["example.ts", 1],
      ["example.ts", 2],
      ["other.ts", 1],
      ["other.ts", 2],
    ]);
    fs.writeFileSync(path.join(root, "example.ts"), "export const value = 1;");
    fs.rmSync(path.join(root, "other.ts"));
    expect(scan(projectDir, repositoryRoot).over_limit_functions).toEqual([]);
  });

  test("默认扫描自动发现源码所属项目", () => {
    const result = scan(".", repositoryRoot);
    expect(result.thresholds).toContain(30);
    expect(result.counts[30]).toBeGreaterThanOrEqual(0);
  });

  test("门禁报告配置和未配置档位，返回实际结果", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const payload = { thresholds: [30, 40], counts: { 30: 1, 40: 0 } };
    expect(
      printGate(
        payload,
        new Map([
          [30, 1],
          [50, 0],
        ]),
      ),
    ).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("未配置，默认 0");
    expect(printGate(payload, new Map([[30, 0]]))).toBe(1);
    expect(log.mock.calls.flat().join("\n")).toContain("门禁失败");
  });

  test("主入口输出帮助、JSON 和门禁状态", () => {
    const root = fixture("export function short() { return 1; }");
    const projectDir = path.relative(repositoryRoot, root);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(["--help"], root)).toBe(0);
    expect(main(["-h"], root)).toBe(0);
    expect(main(["--json", "--project-dir", projectDir], repositoryRoot)).toBe(
      0,
    );
    expect(JSON.parse(log.mock.calls.at(-1)[0]).counts).toEqual({
      30: 0,
      40: 0,
      50: 0,
    });
    expect(main(["--project-dir", projectDir], repositoryRoot)).toBe(0);
  });

  test("运行入口保存退出码并报告参数错误", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    run(["--help"]);
    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalled();
    run(["--bad"]);
    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("不支持的参数"));
    run([], () => {
      throw "非 Error 异常";
    });
    expect(error).toHaveBeenCalledWith("非 Error 异常");
  });

  test("直接执行入口使用命令行参数", () => {
    const previous = process.argv;
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      process.argv = [process.execPath, checkerPath, "--help"];
      jest.isolateModules(() => {
        require(checkerPath);
      });
      expect(log).toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
      process.argv = [process.execPath];
      jest.isolateModules(() => {
        require(checkerPath);
      });
    } finally {
      process.argv = previous;
    }
  });
});
