# GLOSSARY-005：相关主题入口

## 目的

验证从 A-Game 详情进入 Z-game 相关主题。

## 前置条件

- 优先级：P2
- 入口：`/glossary/en/agame?lang=en`
- 视口：桌面、手机
- 语言：英文
- 账号与数据：公开页面；A-Game 与 Z-game 为固定样本。

## 步骤与预期

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 打开 A-Game | 显示相关主题区域 |
| 2 | 点击 Z-game | 进入 Z-game 详情并显示术语名称 |

## 定位契约

| 业务目标 | data-testid | 状态 |
| --- | --- | --- |
| 相关主题区域 | `related-topics` | 已确认 |
| Z-game 链接 | `definition-related-topic-zgame` | 缺失；建议 ID 待落实 |
| 详情名称 | `definition-term-name` | 已确认 |

## 关联问题

ISSUE-003：相关主题链接缺少测试定位契约。
