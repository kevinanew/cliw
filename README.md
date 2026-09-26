# Staging site checks

这个仓库运行已部署网站的页面和公开接口测试。实际代码在 **`master`** 分支；GitHub 当前默认的 `main` 分支不是测试代码分支，查看、修改或提交测试时请明确选择 `master`。目标地址由 `E2E_BASE_URL` 环境变量提供；仓库中不保存实际域名、用户名或密码。`e2e/` 是独立的 Node.js 24 / pnpm 11 项目，不依赖网站源码或本地构建产物。

`e2e/pnpm-workspace.yaml` 用于明确 E2E 的独立安装边界，使目录内的 pnpm 命令使用自己的依赖和锁文件，避免被仓库根目录的 workspace 接管。

开发规范见 [AGENTS.md](AGENTS.md)。

## 本地运行

```sh
cd e2e
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
E2E_BASE_URL="$TARGET_URL" pnpm run e2e:staging
E2E_BASE_URL="$TARGET_URL" pnpm run e2e:lhci
```

`E2E_BASE_URL` 必须是 HTTPS 站点根地址。`pnpm test` 运行检查器的单元测试；`e2e:staging` 等待目标站点可访问，然后运行页面、链接、语言、标题与描述、安全响应头、资源与速度检查；`e2e:lhci` 审计 `/learning` 和 `/glossary` 的移动端性能。术语 slug 对照表保存在 `e2e/fixtures/`，站点内容变更时需同步更新。

站点通过反向代理由多个域名提供服务，因此测试不要求页面输出固定域名的 canonical、`og:url`、hreflang、分享图片或 sitemap。语言检查继续验证地址栏、cookie 和页面语言；HTTPS 检查验证尾随斜杠跳转保留当前访问域名。

## 探索与功能案例

使用 [staging 探索提示词](e2e/prompts/staging-explore-to-playwright.md) 开展 agent-browser 巡检并生成 Playwright 用例。案例采用一个 case 一个文件夹的结构，说明和测试代码放在一起；详见 [案例维护规范](e2e/cases/README.md)。运行功能案例：`cd e2e && E2E_BASE_URL="$TARGET_URL" pnpm run e2e:functional`。报告保存在 `e2e/reports/`；已知定位契约问题会导致对应案例失败。

## GitHub Actions

在仓库的 **Settings → Secrets and variables → Actions** 中添加仓库 Secret `E2E_BASE_URL`。工作流在推送到 `master`、同仓库 Pull Request、每天定时及手动触发时运行。GitHub Actions 的定时与手动工作流从默认分支读取；当前默认分支仍是 `main`，因此需要在仓库设置中将默认分支改为 `master`，才能让 `master` 上的定时与手动工作流生效。它安装固定版本依赖和 Chromium，分别执行 E2E 与 Lighthouse，并上传 Lighthouse 报告。

当前用例访问公开页面，没有登录步骤，也不读取用户名或密码，因此不需要账号 Secret。将来增加登录用例时，应先在 GitHub Actions Secrets 中保存账号凭据，再通过工作流的 `secrets` 上下文传入测试进程。

## 视觉回归

`visual/` 保存已部署网站的 Playwright 视觉测试与基准截图。GitHub Actions 使用 `E2E_BASE_URL` Secret 访问站点，直接比较截图，不检出或构建业务私有仓库；运行方式和基准维护见 [visual/README.md](visual/README.md)。`visual/` 与失败报告会在公开仓库中可见，CI 不上传 trace 或业务构建产物。

**视觉检查规则：只测试已部署、可通过 HTTPS 访问的网站。**业务仓库不使用 Git tag 作为视觉检查或发布触发条件；不要为视觉检查增加版本 tag、发布前本地构建、`dist` 或镜像检查步骤。业务代码部署完成后，视觉检查才可用于验证该次变更；部署前运行时，结果只代表当时线上的版本。
