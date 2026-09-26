# GLOSSARY-002：无结果后清空搜索

## 目的

验证无结果时列表为空、索引禁用，清空后恢复原计数、词条和索引可用状态。

## 前置条件

- 优先级：P1
- 入口：`/glossary?lang=en`
- 视口：桌面、手机
- 语言：英文
- 账号与数据：公开页面，无账号；使用案例中写明的固定术语或资源。

## 步骤与预期

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 打开英文术语表，记录原计数及字母索引 | A-Game、Ace-High 已挂载，所有索引可用 |
| 2 | 搜索 zzznevermatch999 | 空结果提示可见，词条名称数量为 0，计数为「0 of 初始总数 matched」，所有索引禁用 |
| 3 | 点击空结果区域的清空按钮 | 输入为空，A-Game 可见、Ace-High 恢复；空结果提示消失；计数与索引可用状态恢复 |

## 定位契约

| 业务目标 | data-testid | 状态 |
| --- | --- | --- |
| 搜索框 | `glossary-search-input`、`glossary-mobile-search-input` | 已确认 |
| 空结果反馈与清空按钮 | `glossary-no-results`、`glossary-empty-clear` | 已确认 |
| 搜索计数 | `glossary-count` | 已确认；总数与原计数运行时读取 |
| 恢复后的词条 | `glossary-term-agame`、`glossary-term-acehigh` | 已确认 |
| 词条名称集合与字母索引 | `glossary-term-name-<slug>`、`glossary-letter-<字母>` | 已确认 |

## 关联问题

ISSUE-001；探索时清空后列表未恢复，需运行自动测试复核。
