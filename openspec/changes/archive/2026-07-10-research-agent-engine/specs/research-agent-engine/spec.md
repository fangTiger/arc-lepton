## ADDED Requirements

### Requirement: DeepSeek 兼容客户端
系统 SHALL 使用 OpenAI SDK 连接 DeepSeek OpenAI 兼容 API，并在开发环境缺少 `DEEPSEEK_API_KEY` 时提供 mock client。

#### Scenario: 开发环境缺少 key
- **GIVEN** `DEEPSEEK_API_KEY` 未设置且不是 production
- **WHEN** 创建 DeepSeek client
- **THEN** 返回可执行 `chat.completions.create` 的 mock client

#### Scenario: 生产环境缺少 key
- **GIVEN** `DEEPSEEK_API_KEY` 未设置且 `NODE_ENV=production`
- **WHEN** 创建 DeepSeek client
- **THEN** 抛出配置错误

### Requirement: Research 记录持久化
系统 SHALL 保存 research 任务的地址、主题、预算、花费、状态、报告、错误和开始/完成时间。

#### Scenario: 创建并完成 research
- **GIVEN** 已认证用户提交 topic 和 budget
- **WHEN** Agent 生成最终报告
- **THEN** research 状态为 `completed`，`reportMd` 被保存，`spentUsdc` 等于工具调用总额

### Requirement: Agent tool calling 与预算控制
系统 SHALL 让 Agent 在预算内调用 5 个 x402 mock 数据源，并为每次调用写入 tx_log。

#### Scenario: 工具调用产生扣费事件
- **GIVEN** DeepSeek 返回 tool call
- **WHEN** 本地执行工具
- **THEN** 事件流包含 `tool_call`、`tool_result` 和 `budget`，并产生对应 tx_log

#### Scenario: 预算不足停止工具循环
- **GIVEN** 剩余预算低于最便宜工具调用价格
- **WHEN** Agent 准备继续请求工具
- **THEN** 停止工具循环并进入报告生成

### Requirement: SSE 研究事件流
系统 SHALL 通过 `/api/research/[id]/stream` 以 SSE 输出 AgentEvent，并支持历史事件 replay。

#### Scenario: 订阅运行中的 research
- **GIVEN** research 正在运行
- **WHEN** 客户端订阅 SSE
- **THEN** 后续 AgentEvent 被序列化为 `event: agent_event` 消息

#### Scenario: 订阅已完成 research
- **GIVEN** research 已完成且 event bus 仍保留历史
- **WHEN** 客户端订阅 SSE
- **THEN** 服务端 replay 历史事件后关闭连接

### Requirement: Research API
系统 SHALL 提供 start、detail、stream、cancel API，并全部通过 `requireAuth` 保护。

#### Scenario: 启动 research
- **GIVEN** 已认证用户提交合法 topic 和 budget
- **WHEN** 调用 `POST /api/research/start`
- **THEN** 立即返回 `{ researchId, status: "running" }`，后台执行 Agent

#### Scenario: 取消 research
- **GIVEN** research 正在运行
- **WHEN** 当前用户调用 cancel API
- **THEN** 对应 AbortController 被触发，research 状态更新为 `cancelled`
