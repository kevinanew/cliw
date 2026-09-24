# Staging site checks

这个仓库运行已部署网站的页面和公开接口测试。目标地址由 `E2E_BASE_URL` 环境变量提供；仓库中不保存实际域名、用户名或密码。`e2e/` 是独立的 Node.js 24 / pnpm 11 项目，不依赖网站源码或本地构建产物。

## 本地运行

```sh
cd e2e
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
E2E_BASE_URL="$TARGET_URL" pnpm run e2e:staging
E2E_BASE_URL="$TARGET_URL" pnpm run e2e:lhci
```

`E2E_BASE_URL` 必须是 HTTPS 站点根地址。`pnpm test` 运行检查器的单元测试；`e2e:staging` 等待目标站点可访问，然后运行页面、链接、语言、SEO、安全响应头、资源与速度检查；`e2e:lhci` 审计 `/learning` 和 `/glossary` 的移动端性能。术语 slug 对照表保存在 `e2e/fixtures/`，站点内容变更时需同步更新。

## GitHub Actions

在仓库的 **Settings → Secrets and variables → Actions** 中添加仓库 Secret `E2E_BASE_URL`。工作流在推送到 `main` 或 `master`、同仓库 Pull Request、每天定时及手动触发时运行。它安装固定版本依赖和 Chromium，分别执行 E2E 与 Lighthouse，并上传 Lighthouse 报告。

当前用例访问公开页面，没有登录步骤，也不读取用户名或密码，因此不需要账号 Secret。将来增加登录用例时，应先在 GitHub Actions Secrets 中保存账号凭据，再通过工作流的 `secrets` 上下文传入测试进程。

## 全语言、全视口视觉回归

`.github/workflows/visual-regression.yml` 在 `visual/` 或工作流变更的 push、同仓库 Pull Request、每天 20:30 UTC 定时及手动触发时运行。`visual/` 保存从 `laiwan_io_web` 迁入的 Playwright 测试、辅助代码与截图基准；工作流只检出本仓库，用 `E2E_BASE_URL` 访问已部署的 staging 站点，覆盖全部三种语言和四种视口。无需网站业务源码或本地构建。

使用现有 Actions Secret `E2E_BASE_URL` 指定 HTTPS 站点根地址。测试失败时，Actions artifact 保存 HTML 报告、差异图和 trace；每次运行均保存重试指标。网站 UI 更新后，需将新的测试代码与对应截图基准同步到本仓库；基准与部署版本不一致时，视觉对比会失败。

本地运行时，先在 `visual/` 执行 `pnpm install --frozen-lockfile`，再设置 `E2E_BASE_URL`、`VISUAL_LOCALES=all`、`VISUAL_VIEWPORTS=desktop,small-desktop,mobile,pixel-9` 并运行 `pnpm run test:ci`。截图基准应在与 CI 相同的 Playwright Linux 镜像中更新；更新后的 `visual/snapshots/` 需随测试代码一并提交。
