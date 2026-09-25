import fs from "node:fs";
import path from "node:path";
import {
  gateCommand,
  main,
  parseArguments,
  run,
  tightenMakefile,
} from "../../../.woodpecker/tighten-ts-function-statements-gate.mjs";

const repositoryRoot = process.cwd();
const script = path.join(
  repositoryRoot,
  ".woodpecker/tighten-ts-function-statements-gate.mjs",
);
const fixtures = [];
const fixture = (source = "export function short() { return 1; }") => {
  const root = fs.mkdtempSync(path.join(repositoryRoot, ".ts-statement-gate-"));
  fixtures.push(root);
  fs.writeFileSync(path.join(root, "package.json"), '{"private":true}');
  fs.writeFileSync(path.join(root, "example.ts"), source);
  fs.writeFileSync(path.join(root, "Makefile"), "lint:\n\tpnpm run lint\n");
  return root;
};

afterEach(() => {
  jest.restoreAllMocks();
  process.exitCode = 0;
});

afterAll(() => {
  for (const directory of fixtures)
    fs.rmSync(directory, { recursive: true, force: true });
});

describe("TypeScript 函数语句数门禁收紧", () => {
  test("参数解析与档位排序", () => {
    expect(parseArguments([])).toEqual({ install: false, projectDir: "." });
    expect(parseArguments(["--install", "--project-dir", "src"])).toEqual({
      install: true,
      projectDir: "src",
    });
    for (const args of [
      ["--install", "--install"],
      ["--bad"],
      ["--project-dir", ".", "--project-dir", "."],
      ["--project-dir"],
      ["--project-dir", "--install"],
    ])
      expect(() => parseArguments(args)).toThrow();
    expect(gateCommand({ 50: 0, 40: 1, 30: 3 })).toBe(
      "node .woodpecker/ts-function-statements-checker.mjs --s30 3 --s40 1",
    );
  });

  test("首次安装、复检和缩短函数后安全收紧", () => {
    const long = `export function long() { ${Array.from({ length: 31 }, (_, index) => `const x${index} = ${index};`).join(" ")} }`;
    const root = fixture(long);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(["--install"], root)).toBe(0);
    const makefile = path.join(root, "Makefile");
    expect(fs.readFileSync(makefile, "utf8")).toContain("--s30 1");
    expect(main([], root)).toBe(0);
    expect(log.mock.calls.flat().join("\n")).toContain("无需更新");
    fs.writeFileSync(
      path.join(root, "example.ts"),
      "export function short() { return 1; }",
    );
    expect(main([], root)).toBe(0);
    expect(fs.readFileSync(makefile, "utf8")).toContain("--s30 0");
    expect(fs.readdirSync(root).some((name) => name.endsWith(".tmp"))).toBe(
      false,
    );
  });

  test("拒绝无 lint、重复门禁和无效档位", () => {
    expect(() =>
      tightenMakefile("test:\n\tpnpm test\n", { 30: 1 }, true),
    ).toThrow(/lint/);
    expect(() =>
      tightenMakefile("lint:\n\ntest:\n\nlint:\n", { 30: 1 }, true),
    ).toThrow(/lint/);
    const base =
      "lint:\n\tnode .woodpecker/ts-function-statements-checker.mjs --s30 1\n";
    expect(() => tightenMakefile(base + base.slice(6), { 30: 1 })).toThrow(
      /只出现在 lint/,
    );
    expect(() =>
      tightenMakefile(
        "lint:\n\tnode .woodpecker/ts-function-statements-checker.mjs --bad 1\n",
        { 30: 1 },
        true,
      ),
    ).toThrow(/缺少/);
    for (const options of ["--s25 1", "--s35 1", "--s30 1 --s30 1", "--s40 1"])
      expect(() =>
        tightenMakefile(
          `lint:\n\tnode .woodpecker/ts-function-statements-checker.mjs ${options}\n`,
          { 30: 1 },
        ),
      ).toThrow();
    expect(() => tightenMakefile(base, { 30: 2 })).toThrow(/拒绝放宽/);
  });

  test("门禁出现在 lint 之外时拒绝迁移", () => {
    const gate =
      "\tnode .woodpecker/ts-function-statements-checker.mjs --s30 1\n";
    expect(() =>
      tightenMakefile(
        `lint:\n\tpnpm run lint\n\ntest:\n${gate}`,
        { 30: 1 },
        true,
      ),
    ).toThrow(/lint/);
    expect(() =>
      tightenMakefile(`${gate}lint:\n\tpnpm run lint\n`, { 30: 1 }, true),
    ).toThrow(/lint/);
  });

  test("主入口的帮助及运行错误给出稳定退出码", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const error = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(main(["--help"])).toBe(0);
    expect(main(["-h"])).toBe(0);
    expect(log).toHaveBeenCalled();
    run(["--bad"]);
    expect(process.exitCode).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("不支持"));
    const root = fixture();
    fs.rmSync(path.join(root, "Makefile"));
    expect(() => main(["--install"], root)).toThrow();
    jest.spyOn(fs, "readFileSync").mockImplementationOnce(() => {
      throw "非 Error 异常";
    });
    run([]);
    expect(error).toHaveBeenCalledWith("非 Error 异常");
  });

  test("直接执行入口读取命令行参数", () => {
    const previous = process.argv;
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      process.argv = [process.execPath, script, "--help"];
      jest.isolateModules(() => require(script));
      expect(log).toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
      log.mockClear();
      process.argv = [process.execPath];
      jest.isolateModules(() => require(script));
      expect(log).not.toHaveBeenCalled();
    } finally {
      process.argv = previous;
    }
  });
});
