# GLOSSARY-002：无结果后清空搜索

## 目的

验证公开页面的无结果后清空搜索。

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
| 2 | 搜索 zzznevermatch999 后点击清空 | 空结果提示出现；清空后输入为空并恢复 A-Game |

## 定位契约

| 业务目标 | data-testid | 状态 |
| --- | --- | --- |
| 本案例涉及的目标 | `glossary-search-input；glossary-mobile-search-input；glossary-no-results；glossary-count；glossary-empty-clear；glossary-term-agame` | 已确认 |

## 关联问题

ISSUE-001；探索时清空后列表未恢复，需运行自动测试复核。
