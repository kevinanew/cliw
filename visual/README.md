# 已部署网站的视觉回归

这里保存 Playwright 场景与 166 张 Linux Chromium 基准截图。测试访问 `VISUAL_BASE_URL` 指向的 HTTPS 站点；不会检出、安装或构建 `laiwan_io_web` 私有仓库。测试脚本和基准截图位于公开的 `cliw` 仓库中。

## GitHub Actions

`.github/workflows/web-visual.yml` 使用固定的 `mcr.microsoft.com/playwright:v1.61.1-jammy` 容器和 pnpm 11.13.0。它复用仓库 Secret `E2E_BASE_URL`，此值必须是已部署站点的 HTTPS 根地址。`cliw` 中的视觉测试变更 push、同仓库 PR、每天 20:30 UTC 定时和手动触发时，三种语言分别在并行 job 中检查全部四种视口。每个 job 运行相同的测试命令；不受 `VISUAL_LOCALES` 控制的专项检查会在三个 job 中各运行一次。Fork PR 不运行需读取 Secret 的工作流。

失败时上传 HTML 报告和截图差异，保留 7 天。公开仓库的 Actions 日志和这些 artifact 可被外部读取，所以 CI 禁用 Playwright trace，工作流也不会上传站点的构建产物。报告和截图仍可能展示页面内容；请勿把登录态、私有数据或生产凭据放进测试场景。

由于这里检查的是**部署版本**，业务仓库的提交只有部署到目标站点后才会反映在结果中。站点内容或构建版本与基准图不一致时，需要在同一个 Linux Playwright 镜像中更新基准，再审查并提交新截图。CI 只比较，不自动接受差异。

## 运行

```sh
cd visual
pnpm install --frozen-lockfile
VISUAL_BASE_URL=https://example.com VISUAL_LOCALES=zh VISUAL_VIEWPORTS=desktop pnpm run test:ci
```

基准图需要在 Linux 容器中更新，例如把仓库挂载到上述 Playwright 镜像、设置 `VISUAL_BASE_URL` 后运行 `pnpm run reference:ci`（重建所有选中截图）或 `pnpm run approve:ci`（只接受超阈值差异）。建议仅更新实际变更的语言与视口。`VISUAL_FILTER` 可进一步按场景名称过滤。`VISUAL_LOCALES=all` 与 `VISUAL_VIEWPORTS=all` 选择完整矩阵。

测试使用固定数据拦截 `/apk/index.json`，并为书籍封面准备稳定资源；快照容差为 0.3%。`pnpm run test:scenarios` 验证场景矩阵，`pnpm run test:flake-metrics` 验证重试指标生成器。
