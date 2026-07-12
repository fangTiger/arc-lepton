## MODIFIED Requirements

### Requirement: ARC receipt transactions
系统 SHALL 在 `ARC_RECEIPT_MODE=arc` 时为付费数据源调用产生真实 ARC 测试网 receipt，但 research agent 内的多个付费工具调用 SHALL 聚合为异步 settlement receipt。

#### Scenario: 直接付费 API 成功写入 ARC receipt
- **WHEN** 已认证用户直接调用受 payment wrapper 保护的付费数据源且 ARC receipt 配置完整
- **THEN** 系统 SHALL 发送 ARC 测试网交易并等待 receipt
- **AND** tx_log SHALL 保存真实 txHash、chainId、blockNumber、requestId 和 `confirmed` 状态
- **AND** 返回给调用方的 payment SHALL 包含同一 txHash 和 `confirmed` 状态

#### Scenario: Research 工具调用先创建 pending intent
- **WHEN** research agent 在一次 research 中执行付费工具调用
- **THEN** 系统 SHALL 创建一条本地 tx_log payment intent
- **AND** tx_log 的 txStatus SHALL 为 `pending`
- **AND** 该工具调用不 SHALL 等待 ARC RPC、交易广播或 receipt 确认
- **AND** 返回给 Agent event 的 payment SHALL 包含 requestId、amount、source 和 `pending` 状态

#### Scenario: Research settlement 聚合多个工具调用
- **GIVEN** 同一 `address + researchId` 下存在一条或多条 pending payment intent
- **WHEN** research 报告完成后触发 settlement worker
- **THEN** 系统 SHALL 最多发送一笔 ARC 测试网 settlement transaction
- **AND** settlement payload SHALL 包含 researchId、buyer、totalAmount、itemCount 和每个 item 的 requestId、source、amount
- **AND** 广播成功后所有被结算的 tx_log SHALL 更新为 `confirmed`
- **AND** 这些 tx_log SHALL 共享同一个 txHash、chainId 和 blockNumber

#### Scenario: Research settlement 不阻塞报告完成
- **WHEN** ARC RPC 慢、出块慢或 settlement worker 尚未执行
- **THEN** research 报告仍 SHALL 保存为 completed 并返回给用户
- **AND** TX feed SHALL 展示 pending payment 状态
- **AND** 后续查询 SHALL 在 settlement confirmed 后展示 explorer 链接

#### Scenario: Research settlement 失败
- **WHEN** settlement 广播失败、receipt 失败或配置缺失
- **THEN** 系统 SHALL 把对应 pending tx_log 标记为 `failed`
- **AND** 系统 SHALL 保存失败原因
- **AND** 已完成的 research 报告不 SHALL 被撤回
- **AND** 后续补偿重试 SHALL 可重新尝试 settlement 或创建新的 settlement attempt

#### Scenario: 相同 settlement 批次避免重复广播
- **WHEN** 多个 worker 同时尝试结算同一 `address + researchId`
- **THEN** 系统 SHALL 通过持久化 claim 或唯一约束保证最多一个 worker 广播同一批次
- **AND** 未获得 claim 的 worker 不 SHALL 再次广播 ARC transaction

### Requirement: Payment event status
系统 SHALL 在 API、Agent event 和 wallet tx-log 中暴露 payment 的链上或 settlement 状态。

#### Scenario: 研究工具调用产生 pending payment 事件
- **WHEN** Agent 工具调用完成但 research settlement 尚未 confirmed
- **THEN** `tool_result.payment` SHALL 包含 amount、txStatus、chainId、blockNumber 和 requestId
- **AND** txStatus SHALL 为 `pending`
- **AND** txHash MAY 为 null

#### Scenario: 钱包查询 settlement 后的 tx_log
- **WHEN** 已登录用户调用 `/api/wallet/tx-log`
- **THEN** 响应 SHALL 返回每条记录的 txStatus、chainId、blockNumber、requestId、errorMessage 和 settlement txHash
- **AND** 多条同一 research 的记录 MAY 共享同一个 settlement txHash

### Requirement: TX feed truthfulness
系统 SHALL 根据 txStatus 展示真实状态，避免把 pending、mock 或 failed 记录伪装成 confirmed。

#### Scenario: pending settlement 展示等待状态
- **WHEN** payment txStatus 为 `pending`
- **THEN** TX feed SHALL 显示 pending settlement
- **AND** 不 SHALL 显示 confirmed
- **AND** 不 SHALL 渲染 explorer 链接

#### Scenario: confirmed settlement 展示 explorer 链接
- **WHEN** payment txStatus 为 `confirmed` 且 explorer URL 已配置
- **THEN** TX feed SHALL 展示可点击 explorer 链接
- **AND** 状态 SHALL 显示 confirmed
- **AND** 多条逻辑调用共享同一 txHash 时 SHALL 仍分别展示 source、amount 和 requestId

#### Scenario: 前端同步异步 settlement 终态
- **GIVEN** research SSE 已产生 `tool_result.payment.txStatus=pending`
- **WHEN** `/api/research/[id]` 的 txLog 中同一 requestId 更新为 `confirmed` 或 `failed`
- **THEN** 前端 SHALL 以 txLog 为权威覆盖已有 `tool_result.payment` 的 txHash、txStatus、chainId 和 blockNumber
- **AND** 前端 SHALL 保留原有 amount、source/name、dataPreview 和 callId
- **AND** research 到达终态且仍有 pending payment 时，前端 SHALL 低频轮询详情 API 直到没有 pending payment 或组件卸载

#### Scenario: 冷启动从 tx_log 物化 TX feed rows
- **GIVEN** 用户刷新或重新打开已完成 research，客户端没有 SSE 历史 `tool_result`
- **WHEN** `/api/research/[id]` 返回 txLog
- **THEN** 前端 SHALL 将每条 txLog 物化为 TX feed 可展示的 `tool_result` payment row
- **AND** 已存在相同 requestId 的 live `tool_result` 不 SHALL 被重复追加
- **AND** 物化 row SHALL 展示 source、amount、requestId、txStatus、txHash、chainId 和 blockNumber
