# GLOSSARY-006：搜索输入边界

## 目的

记录完整列表；查询 bluff；改为带首尾空格的 BLUFF 后结果和计数相同；纯空格查询恢复全部词条。

## 前置条件

- 优先级：P1
- 入口：`/glossary?lang=en`
- 视口：桌面 1440×900、手机 390×844
- 语言：英文
- 账号：公开页面，无账号；每个测试使用独立上下文

## 步骤与预期

1. 记录完整列表
2. 查询 bluff
3. 改为带首尾空格的 BLUFF 后结果和计数相同
4. 纯空格查询恢复全部词条。

## 定位契约

- `glossary-search-input`
- `glossary-mobile-search-input`
- `glossary-count`
- `glossary-page`
- `glossary-term-bluff`
- `glossary-term-acehigh`
- `glossary-term-agame`
- `glossary-term-name-*`
- `glossary-no-results`

## 关联问题与边界

ISSUE-005：staging 纯空格查询显示空结果，已在业务源码修复，待部署复测。data-searching 表示是否有有效搜索内容，不代表后台加载状态。
