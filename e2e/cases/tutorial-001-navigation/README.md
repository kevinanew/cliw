# TUTORIAL-001：教程导航与浏览器返回

## 目的

桌面使用导航链接，手机先打开抽屉；进入术语页后抽屉关闭；浏览器返回教程，语言、内容及导航恢复。

## 前置条件

- 优先级：P1
- 入口：`/tutorial?lang=zh`
- 视口：桌面 1440×900、手机 390×844
- 语言：简体中文
- 账号：公开页面，无账号；每个测试使用独立上下文

## 步骤与预期

1. 桌面使用导航链接，手机先打开抽屉
2. 进入术语页后抽屉关闭
3. 浏览器返回教程，语言、内容及导航恢复。

## 定位契约

- `tutorial-step-one`
- `mobile-nav-menu-button`
- `mobile-drawer-content`
- `mobile-nav-link-glossary`
- `tutorial-nav-link-navbar_terminology_list`
- `glossary-header`

## 关联问题与边界

已有标识；手机和桌面使用同一案例的响应式分支。
