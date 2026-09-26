# GLOSSARY-001：搜索术语命中

## 目的

验证搜索确实过滤列表、显示准确匹配数，并禁用没有结果的字母索引。

## 前置条件

- 优先级：P1
- 入口：`/glossary?lang=en`
- 视口：桌面、手机
- 语言：英文
- 账号与数据：公开页面，无账号；使用案例中写明的固定术语或资源。

## 步骤与预期

| 步骤 | 操作 | 预期结果 |
| --- | --- | --- |
| 1 | 打开英文术语表，记录总词条数及字母索引 | A-Game 和无关词条 Ace-High 已挂载；总数大于 1 |
| 2 | 输入 A-Game | 只有一个词条名称；A-Game 可见，Ace-High 被移除；计数为「1 of 初始总数 matched」 |
| 3 | 检查字母索引 | A 可操作，其他字母均禁用 |

## 定位契约

| 业务目标 | data-testid | 状态 |
| --- | --- | --- |
| 页面与搜索框 | `glossary-header`、`glossary-search-input`、`glossary-mobile-search-input` | 已确认 |
| 命中及无关词条 | `glossary-term-agame`、`glossary-term-acehigh` | 已确认 |
| 词条名称集合 | `glossary-term-name-<slug>` | 已确认；按此前缀统计，不混入链接容器 |
| 搜索计数 | `glossary-count` | 已确认；总数运行时读取，不固定为当前词条数 |
| 字母索引 | `glossary-letter-<字母>` | 已确认；记录初始集合后逐个检查 |

## 关联问题

无。
