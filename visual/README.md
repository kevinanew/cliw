# 已部署网站的视觉回归

这里保存 Playwright 场景与 Linux Chromium 基准截图。测试访问 `VISUAL_BASE_URL` 指向的 HTTPS 站点；不会检出、安装或构建 `laiwan_io_web` 私有仓库。测试脚本和基准截图位于公开的 `cliw` 仓库 `master` 分支中。首页下载入口的视觉基准需随站点实际布局更新。

## 检查范围

视觉回归只比较已部署、可通过 HTTPS 访问的网站。业务仓库不使用 Git tag 触发视觉检查或发布；视觉流程不检查发布前的本地构建、`dist` 或镜像。需要验证业务代码变更时，先完成目标站点部署，再运行视觉检查。部署前的检查结果只能反映当时线上的版本。

## GitHub Actions

`.github/workflows/web-visual.yml` 使用固定的 `mcr.microsoft.com/playwright:v1.61.1-jammy` 容器和 pnpm 11.13.0。GitHub 当前默认分支是 `main`，但视觉工作流在 `master`；要使每天的定时任务和手动触发生效，需在仓库设置中将默认分支改为 `master`。它复用仓库 Secret `E2E_BASE_URL`，此值必须是已部署站点的 HTTPS 根地址。`master` 上的视觉测试变更推送、目标为 `master` 的同仓库 PR、每天 20:30 UTC 定时和手动触发时，三种语言分别在并行 job 中检查全部四种视口。每个 job 运行相同的测试命令；不受 `VISUAL_LOCALES` 控制的专项检查会在三个 job 中各运行一次。Fork PR 不运行需读取 Secret 的工作流。

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

## 首页入口可用性

首页采用已确认的黏土小屋和绿毡牌桌设计。测试阻塞插图资源，检查标题、两组 H5 按钮、iOS 下载入口和安卓链接仍以完整不透明度显示。简中、繁中和英文各覆盖桌面及移动视口。

截图隐藏安卓二维码中的地址编码，保留尺寸、位置和说明文字。断点用例检查桌面二维码右置、窄屏隐藏和图形实际生成。简中、繁中和英文各在 801 px 和 820 px 验证 APK 清单加载前后按钮的坐标和尺寸一致。

设计及已部署版本见 [首页改版 #1622](https://github.com/ac-gp/laiwan_io_web/pull/1622)。

运行入口可用性检查使用 `VISUAL_FILTER=home_entrance`，预览图对比使用静态首页场景。

## 动画覆盖矩阵

`animations.spec.ts` 为简中、繁中、英文各覆盖桌面与手机动态场景。沿用语言、视口和名称过滤，现有三语言 CI 自动收集。其余两档视口由静态矩阵覆盖；手机视口使用鼠标执行悬停场景，验证响应式 CSS，不代表触屏设备具备悬停能力。

| 源码与动画 | 取帧及断言 |
| --- | --- |
| `HomeScreen.module.css`：静态小屋与牌桌 | 验证首页装饰不创建无限循环，首屏静态布局继续由视觉矩阵覆盖 |
| `useTableParallax.ts`：桌面前景牌桌横移 | 宽屏精细指针触发，最大 6px。检查小屋和下载区位置不变、触屏布局静止及鼠标离开时复位 |
| `BlurUpImage.module.css`：小屋内应用预览 | 阻塞高清图片，检查占位图和高清图在 450ms 内交叉渐显 |
| `DownloadButton.module.css` / `H5VersionBlock.module.css`：下载按钮、H5 入口和教程入口 | 比较扫光 125/450/899ms 与离开后 125ms；同时覆盖缩放、位移、边框及阴影 |
| `DownloadIOSModal` / `DownloadIOSDialog`：加载圆环、弹层、遮罩及弹层控件 | 阻塞懒加载模块后取旋转 0/175/350ms；弹层 0/160/319ms；关闭按钮旋转、两个下载入口的悬停与按压 100ms，并验证关闭卸载 |
| `index.html` / `LoadingSpinner.module.css`：启动、React 全屏与页内加载提示 | 请求闸门保持加载态，比较 0/1100/2200ms；局部截图放大对标志呼吸、光晕变化的检测能力 |
| `RouteProgress.tsx` / NProgress：路由进度条和圆环 | 阻塞目标路由模块，暂停随机递增计时器，取 0/100/199ms，并验证加载完成后移除 |
| `NavBar.module.css`：汉堡图标 | 开、关分别取 0/43/85ms，验证五个 86ms 过渡及展开状态 |
| `MobileNavigationDrawer.tsx`：教程抽屉和遮罩 | 进入 0/112/224ms、退出 0/97/194ms，分别验证 225/195ms 时长及退出卸载 |
| `Definition.module.css`：术语正文渐入 | 0/125/250ms，验证透明度和位移以及实际术语内容 |
| `Learning.module.css`：书卡、评分来源提示、下载按钮 | 75/179ms；宽屏鼠标悬停，窄屏评分用键盘聚焦 |
| `LanguageSelect.module.css` / `Glossary.module.css`：语言按钮、搜索边框及字母索引 | 悬停、搜索聚焦和桌面语言切换选中态的 75ms 中间颜色；手机不包含隐藏的桌面搜索框与字母索引，切换语言时移动菜单直接卸载 |
| 生产 `prefers-reduced-motion` 媒体查询 | 首页、弹窗、书卡、术语、抽屉、三种加载提示及路由进度；断言无持续动画，书卡不浮起、鼠标不驱动视差，内容可见 |

仅声明了过渡但没有实际样式变化的属性（例如导航链接白色到白色、手机反光层固定的 `opacity`）不会创建浏览器动画，因此没有人为修改样式来制造用例。iOS 弹层关闭直接卸载，没有退出关键帧；测试验证其卸载。帧率、耗电、真实设备流畅度仍属于性能测试范围。

取帧工具 `helpers/motion.ts` 复用首页入场捕获器，保留真实 CSS。CSS Modules 的动画名经过生产哈希，按业务标识、关键帧属性及预期时长定位，同时检查数量、初始运行状态、循环次数和延迟。有限动画最多推进到末尾前 1ms，避免已结束、无填充的过渡退出活动列表；截图明确允许动画，并在截图后校验原动画仍存在、暂停且时间正确。取消的动画不会被测试复活。

请求闸门在 `finally` 中释放，不使用固定网络延时。仅检查被启动兜底遮住的 React 全屏加载组件时移除外层兜底；正常业务场景不隐藏元素。抽屉及路由进度使用浏览器时钟保留退出过程并避开随机进度递增。小面积动画用局部截图，书卡使用固定视口截图保留位移信息。

`helpers/motion.test.ts` 是取帧工具的浏览器单元测试，使用内存中的最小 HTML 验证延迟与循环计算、动画取消保护和截图后时间核验，不访问业务站点、不生成基准。配置已迁为 `playwright.config.ts`，纳入动画类型检查。

```sh
pnpm run typecheck:animation
VISUAL_BASE_URL=https://example.com VISUAL_LOCALES=all VISUAL_VIEWPORTS=desktop,mobile VISUAL_FILTER='animations|home_entrance' pnpm run test:ci
pnpm exec playwright test helpers/motion.test.ts
```

新增动画时，在本表登记源码、触发条件、关键时刻和减少动态效果行为。先在固定 Linux 镜像中生成并审查基准，再不更新基准复跑；不要因为取帧失败就取消动画断言或扩大截图容差。

### 本次验证与资源记录（2026-10-15）

目标站点的 `build-version` 为 `staging - b2d3b64`，与官网工作区源码一致。使用 `mcr.microsoft.com/playwright:v1.61.1-jammy`、Chromium、2 个 worker，显式关闭重试并禁止更新基准：

- 完整运行新增 84 个场景、原有 6 个首页入场场景及 3 个取帧工具测试，共 93 项。92 项通过；原有英文桌面入场在 600ms 截图步骤触发 15 秒截图超时，没有报告像素差异。整批实际用时 568.4 秒，容器内存采样峰值 1743.8 MiB。
- 最后补充按钮按压和语言选中画面后，重新生成受影响场景的基准，再禁止更新基准运行 12 项交互场景及上述超时的 1 项入场场景，13 项全部通过；实际用时 123.7 秒，容器内存采样峰值 1686.7 MiB。没有提高像素容差或修改原有入场基准来处理超时。
- 动画与配置 TypeScript 检查通过；场景及资源准备的 38 项单元测试、重试指标的 1 项测试通过。取帧工具的 3 项浏览器单元测试也通过，验证保留延迟与循环、拒绝复活取消的动画，以及拦截截图意外推进时间。

耗时包含命令启动；内存每 100ms 读取容器的 `/sys/fs/cgroup/memory.current`，包含 Node、Chromium 及容器缓存，不是单个 Node 进程的 RSS。数据来自共享主机上的 Linux 容器，不作为性能门槛。这些检查需要 Playwright、多语言真实页面及大量截图，因此按前端 E2E 规范全部归属 `cliw`；官网仓库仅保留文档入口。

## 页面定位契约

视觉场景的业务控件统一按 `data-testid` 定位。配置使用 `readyTestId`、`clickTestId` / `clickTestIds`、
`hoverTestId`、`focusTestId`、`keyPressTestId`、`scrollIntoViewTestId` 和 `singleLineTestIds`。
存在重复子控件时，用 `{ within: '唯一容器 ID', testId: '子控件 ID' }` 指定范围。
`postInteractionWait` / `postInteractionHide` 也填写 test ID，不接收 CSS 或固定等待毫秒数。
`expectedReadyText` 是定位之后的内容断言值，不参与定位。

学习页评分按书籍业务 ID 选择，术语分组和相关主题按字母或 slug 选择，教程图片按步骤 ID 选择。
缺失标识应在 `laiwan_io_web` 补齐并部署，再运行完整视觉回归；不要通过更新基准、CSS 兜底或忽略失败绕过缺口。
全页截图的资源稳定化、所有链接的巡检、版本 meta 与网络响应检查仍按其资源类型读取，不属于业务控件定位。
