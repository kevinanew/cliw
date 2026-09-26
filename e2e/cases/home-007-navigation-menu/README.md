# HOME-007：主导航与品牌返回

## 目的

打开响应式导航，进入学习页，再点击品牌返回首页；手机菜单随跳转关闭，语言保持。

## 前置条件

- 优先级：P1
- 入口：`/?lang=zh`
- 视口：桌面 1440×900、手机 390×844
- 语言：简体中文
- 账号：公开页面，无账号；每个测试使用独立上下文

## 步骤与预期

1. 打开响应式导航，进入学习页，再点击品牌返回首页
2. 手机菜单随跳转关闭，语言保持。

## 定位契约

- `home-title`
- `navbar-mobile-menu-button`
- `navbar-mobile-menu`
- `navbar-mobile-menu-item-navbar_learning`
- `navbar-link-navbar_learning`
- `learning-page`
- `navbar-home-link`

## 关联问题与边界

navbar-home-link 需部署本次业务源码变更。
