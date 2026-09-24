# GLOSSARY-001：搜索术语命中

## 目的

验证公开页面的搜索术语命中。

## 前置条件

- 优先级：P1
- 入口：`/glossary?lang=en`
- 视口：桌面、手机
- 语言：英文
- 账号与数据：公开页面，无账号；使用案例中写明的固定术语或资源。

## 步骤与预期

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 打开入口并检查页面已呈现 | 页面业务容器或目标控件唯一存在 |
| 2 | 搜索 A-Game | A-Game 条目出现且计数显示匹配 |

## 定位契约

| 业务目标 | data-testid | 状态 |
| --- | --- | --- |
| 本案例涉及的目标 | `glossary-search-input；glossary-mobile-search-input；glossary-term-agame；glossary-count` | 已确认 |

## 关联问题

无。
