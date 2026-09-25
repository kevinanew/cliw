# HOME-001：首页导航进入术语表

## 目的

验证公开页面的首页导航进入术语表。

## 前置条件

- 优先级：P1
- 入口：`/?lang=en`
- 视口：桌面、手机
- 语言：英文
- 账号与数据：公开页面，无账号；使用案例中写明的固定术语或资源。

## 步骤与预期

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 打开入口并检查页面已呈现 | 页面业务容器或目标控件唯一存在 |
| 2 | 点击导航术语入口 | 进入 /glossary?lang=en，并显示英文术语标题 |

## 定位契约

| 业务目标 | data-testid | 状态 |
| --- | --- | --- |
| 本案例涉及的目标 | `navbar-link-navbar_terminology_list；navbar-mobile-menu-button；navbar-mobile-menu-item-navbar_terminology_list；glossary-header` | 已确认 |

## 关联问题

无。
