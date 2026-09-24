# GLOSSARY-004：无效术语显示返回入口

## 目的

验证无效术语深链给出可理解的反馈，并可返回列表。

## 前置条件

- 优先级：P2
- 入口：`/glossary/en/does-not-exist-999?lang=en`
- 视口：桌面、手机
- 语言：英文
- 账号与数据：公开页面；使用明确不存在的 slug `does-not-exist-999`。

## 步骤与预期

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 直达无效术语 | 出现 `Term not found` 和返回入口 |
| 2 | 点击返回 | 到达英文术语列表 |

## 定位契约

| 业务目标 | data-testid | 状态 |
| --- | --- | --- |
| 错误反馈 | `definition-not-found` | 已确认 |
| 返回入口 | `definition-go-back` | 已确认 |
| 列表标题 | `glossary-header` | 已确认 |

## 关联问题

无。
