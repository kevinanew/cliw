# HOME-008：网页版入口与教程地址一致

## 目的

分别读取两组网页版入口，实际点击同组教程；教程介绍与步骤中的 HTTPS 地址都与首页入口相同。

## 前置条件

- 优先级：P1
- 入口：`/?lang=zh`
- 视口：桌面 1440×900、手机 390×844
- 语言：简体中文
- 账号：公开页面，无账号；每个测试使用独立上下文

## 步骤与预期

1. 分别读取两组网页版入口，实际点击同组教程
2. 教程介绍与步骤中的 HTTPS 地址都与首页入口相同。

## 定位契约

- `h5-play-link-laiwan-life`
- `h5-play-link-laiwanpai-com`
- `h5-tutorial-link-laiwan-life`
- `h5-tutorial-link-laiwanpai-com`
- `h5-tutorial-url-link-0`
- `h5-tutorial-url-link-1`

## 关联问题与边界

两个 h5-play-link 标识需部署本次业务源码变更；不访问外部游戏、不创建账号。
