## ADDED Requirements

### Requirement: Research 创建与 Live 执行页面
系统 SHALL 提供受保护的 `/research` 页面，用于创建研究请求并在同页展示 SSE Live 执行。

#### Scenario: 创建研究请求
- **GIVEN** 已登录用户填写 topic 和 budget
- **WHEN** 点击 start research
- **THEN** 页面调用 `/api/research/start`，URL 更新为 `?id=<researchId>`，并切换到 Live 视图

#### Scenario: 展示 AgentEvent
- **GIVEN** research 正在运行
- **WHEN** `/api/research/[id]/stream` 推送 AgentEvent
- **THEN** 页面展示带 UTC 时间戳的 agent log、tx feed 和 budget meter

### Requirement: Research 报告详情页
系统 SHALL 提供受保护的 `/research/[id]` 页面，展示 research 元数据、markdown 报告和数据源 tx 表。

#### Scenario: 查看完成报告
- **GIVEN** research 已完成
- **WHEN** 用户打开详情页
- **THEN** 页面渲染 report markdown，并列出本次工具调用 tx hash 和 cost

### Requirement: Dashboard 真实历史
系统 SHALL 使用真实 API 数据替换 dashboard 占位内容。

#### Scenario: 查看 dashboard
- **GIVEN** 已登录用户有 research 历史
- **WHEN** 打开 `/dashboard`
- **THEN** 页面展示账户、总研究数、总调用数、总花费和 research history 表

### Requirement: 首页实时全局 stats
系统 SHALL 提供公开全局 stats API，并在首页轮询展示真实数据。

#### Scenario: 首页 stats 更新
- **GIVEN** 有 research 和 tx_log 数据
- **WHEN** 首页每秒轮询 `/api/stats/global`
- **THEN** stats 面板展示真实 totalResearches、totalCallsAcrossAllUsers、totalUsdcSpent 和 activeAgents
