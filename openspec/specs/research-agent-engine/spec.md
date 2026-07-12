# research-agent-engine Specification

## Purpose
定义研究 Agent 的模型接入、工具调用、预算控制、持久化、实时事件、API 与异步结算生命周期。
## Requirements
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
系统 SHALL 让 Agent 在预算内调用 5 个 x402 mock 数据源，为每次调用写入 tx_log payment intent，并在 research 完成后异步结算。

#### Scenario: 工具调用产生 pending 扣费事件
- **GIVEN** DeepSeek 返回 tool call
- **WHEN** 本地执行工具
- **THEN** 事件流包含 `tool_call`、`tool_result` 和 `budget`
- **AND** 系统 SHALL 产生对应 tx_log payment intent
- **AND** `tool_result.payment.txStatus` SHALL 为 `pending`，除非当前运行模式显式使用 mock immediate receipt
- **AND** Agent 不 SHALL 为该工具调用等待链上 receipt

#### Scenario: 预算按 payment intent 扣减
- **GIVEN** 工具调用已创建 pending payment intent
- **WHEN** 系统计算 research 剩余预算
- **THEN** research spentUsdc SHALL 按工具金额扣减
- **AND** 后续工具循环 SHALL 基于扣减后的预算继续判断是否可调用
- **AND** wallet settled totals MAY 只统计 confirmed/mock 状态

#### Scenario: 预算不足停止工具循环
- **GIVEN** 剩余预算低于最便宜工具调用价格
- **WHEN** Agent 准备继续请求工具
- **THEN** 停止工具循环并进入报告生成

#### Scenario: 默认最多执行三个付费数据源调用
- **GIVEN** DeepSeek 在一次 research 中返回超过 3 个可执行付费 tool calls
- **WHEN** Agent 已执行 3 个付费数据源调用
- **THEN** 后续付费 tool calls SHALL 写入 tool message `skipped`，reason 为 `tool_call_limit_reached`
- **AND** 系统不 SHALL 为被跳过的 tool call 创建 payment intent
- **AND** spentUsdc SHALL 只包含已执行的 3 个付费工具金额

### Requirement: SSE 研究事件流
系统 SHALL 通过 `/api/research/[id]/stream` 以 SSE 输出 AgentEvent，并支持历史事件 replay。

#### Scenario: pending payment 不阻塞 final 事件
- **GIVEN** research agent 已完成报告生成
- **WHEN** payment settlement 仍为 pending
- **THEN** SSE SHALL 发送 `final` 事件
- **AND** research 状态 SHALL 保存为 `completed`
- **AND** settlement SHALL 在后台继续处理

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

### Requirement: Research settlement lifecycle
系统 SHALL 在 research 完成后为 pending payment intents 触发异步 settlement，并支持补偿重试。

#### Scenario: Research 完成后启动 settlement
- **GIVEN** research 状态从 running 变为 completed
- **WHEN** 该 research 存在 pending payment intents
- **THEN** 系统 SHALL 调度 settlement worker
- **AND** 调度动作不 SHALL 阻塞用户收到报告

#### Scenario: Research 取消后结算已创建 intent
- **GIVEN** research agent 已为付费工具调用创建 pending payment intent
- **WHEN** 用户取消或 AbortSignal 使 research 进入 `cancelled`
- **THEN** 系统 SHALL 为已创建的 pending payment intents 调度异步 settlement 或终态化处理
- **AND** 不 SHALL 让这些 tx_log 永久停留在 `pending`

#### Scenario: 无 pending payment intents 时跳过 settlement
- **GIVEN** research 没有任何 pending payment intent
- **WHEN** research 完成
- **THEN** 系统不 SHALL 发送 ARC settlement transaction

#### Scenario: 补偿重试处理遗留 pending
- **GIVEN** 进程退出或 worker 失败导致 pending payment intents 未确认
- **WHEN** 后续补偿任务扫描到超时 pending settlement
- **THEN** 系统 SHALL 重新尝试 settlement
- **AND** 不 SHALL 对已 confirmed 的 settlement 再次广播

### Requirement: Follow-up Q&A remains off-chain
系统 SHALL 保持 follow-up Q&A 不产生链上 payment intent。

#### Scenario: Submit a follow-up question
- **GIVEN** an authenticated user owns a completed research report
- **WHEN** the user submits a follow-up question
- **THEN** 系统 SHALL 只基于原始报告和历史 Q&A 生成回答
- **AND** 不 SHALL 创建 tx_log payment intent
- **AND** 不 SHALL 触发 ARC settlement
- **AND** follow-up spentUsdc SHALL 为 `0`
