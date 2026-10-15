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

## 首页入场动画

`home-entrance.spec.ts` 检查首页公告、标题、副标题、下载入口、版本文字和桌面手机图的分批入场。覆盖简中、繁中、英文的 `desktop` 和 `mobile` 视口，共 6 个场景、36 张基准图；使用现有 `VISUAL_LOCALES`、`VISUAL_VIEWPORTS` 过滤，其他两档视口继续由静态截图覆盖。现有三语言 CI 会自动运行各自的动画场景。

动画测试使用独立准备流程：启用正常动效，在页面创建动画时暂停并归零，等待真实字体和图片加载后，只完成图片加载过渡，其他循环装饰停在固定进度。测试保留生产 CSS 的关键帧、时长和延迟，不调用静态测试中的禁用动画、隐藏视频或移除毛玻璃逻辑。

首先断言页面确实创建了处于运行状态的入场动画、每段持续 800ms、分组延迟为 0/200/400/600ms，并通过已有业务标识确认标题、下载区域、版本文字和手机图的对应关系。然后在统一时间轴的 0、200、400、600、1000、1400ms 比较首屏截图，截图选项明确使用 `animations: 'allow'`，避免浏览器测试工具把暂停的动画快进到结束。使用固定视口截图，并在每次截图后断言全部入场动画仍停在指定时间，防止整页截图引发的布局变化重建动画、误把隐藏的手机图接受为基准。手机布局不展示宣传手机图，因此少一个入场动画。

只运行首页入场检查：

```sh
VISUAL_BASE_URL=https://example.com VISUAL_LOCALES=all VISUAL_VIEWPORTS=desktop,mobile VISUAL_FILTER=home_entrance pnpm run test:ci
pnpm run typecheck:animation
```

首次建基准或审查设计变更时，在上述固定 Linux Playwright 镜像中用相同过滤条件运行 `pnpm run reference:ci`。逐张审查中间画面后再提交，不能仅因测试失败就更新基准。报告中的步骤名和图片名都包含毫秒时间，便于定位顺序、透明度、位移或缓动变化。

该检查针对入场画面和时间契约，不测真实机器的掉帧率。持续动画和交互过渡由下面的动画矩阵补充；浏览器测试仍归属 `cliw`，只访问已部署 HTTPS 站点，不构建官网源码。

2026-10-15 在 GitHub Actions 的固定 Linux 镜像中验证：2 个 worker 生成全部 36 张基准，6 个场景用时 16.8 秒（含命令启动 18.0 秒），100ms 间隔采样的容器内存峰值约 1742 MiB；随后不更新基准重复比较，6 个场景全部通过，用时 17.4 秒。另在已部署页面临时移除标题动画、修改延迟、将时长翻倍，均被时间契约拦截；仅将标题起始位移从 20px 改成 80px 时，时间契约仍通过，画面对比检测到超出容差的差异。


## 动画覆盖矩阵

`animations.spec.ts` 补充 84 个部署站点场景、480 张基准图：简中、繁中、英文分别覆盖桌面与手机，桌面每种语言 13 个场景、手机 15 个场景。沿用语言、视口和名称过滤，现有三语言 CI 自动收集。其余两档视口由静态矩阵覆盖；手机视口使用鼠标执行悬停场景，验证响应式 CSS，不代表触屏设备具备悬停能力。

| 源码与动画 | 取帧及断言 |
| --- | --- |
| `HomeScreen.module.css`：三个背景光晕、手机悬浮与投影、三层扩散光环、标题和副标题光效 | 验证 18/22/26 秒背景循环、5/5.5/6 秒光效以及 0/1/3 秒光环延迟；统一取 0、2750、5225、5500、13000ms，覆盖光环消失和循环边界 |
| `useParallaxTilt.ts`：背景位移、手机视差与反光 | 鼠标移到左上、右下及离开窗口，比较 250/499ms 和复位中间帧，并断言背景归零 |
| `HomeScreen.module.css` / `BlurUpImage.module.css`：高清图和模糊占位图交叉渐显 | 从部署 DOM 读取真实资源 URL 后阻塞高清图；比较占位状态及 0/225/549ms，分别验证 550/450ms 过渡 |
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
