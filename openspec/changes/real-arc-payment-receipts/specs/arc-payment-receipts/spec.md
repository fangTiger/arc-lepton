## ADDED Requirements

### Requirement: ARC receipt transactions
系统 SHALL 在 `ARC_RECEIPT_MODE=arc` 时为每次付费数据源调用发送一笔真实 ARC 测试网 receipt 交易。

#### Scenario: 成功写入 ARC receipt
- **WHEN** 已认证用户调用付费数据源且 ARC receipt 配置完整
- **THEN** 系统 SHALL 发送 ARC 测试网交易并等待 receipt
- **AND** tx_log SHALL 保存真实 txHash、chainId、blockNumber、requestId 和 `confirmed` 状态
- **AND** 返回给调用方的 payment SHALL 包含同一 txHash 和 `confirmed` 状态

#### Scenario: 链上配置缺失
- **WHEN** `ARC_RECEIPT_MODE=arc` 但缺少 RPC、chainId 或 `ARC_RECORDER_PRIVATE_KEY`
- **THEN** 系统 SHALL 不生成 confirmed mock 交易
- **AND** 请求 SHALL 返回明确失败
- **AND** 如已创建 tx_log，状态 SHALL 为 `failed`

#### Scenario: 链上广播失败
- **WHEN** ARC RPC 返回错误或交易 receipt 失败
- **THEN** 系统 SHALL 记录失败原因
- **AND** tx_log SHALL 标记为 `failed`
- **AND** 业务响应 SHALL 不把该调用展示为 confirmed

#### Scenario: 相同幂等 key 的请求先原子占用再广播
- **WHEN** 同一 `address + requestId` 首次发起付费调用
- **THEN** 系统 SHALL 先创建一条 `pending` tx_log 记录
- **AND** 只有 claim 成功的请求 SHALL 继续广播 ARC receipt
- **AND** 广播完成后系统 SHALL update 同一条记录为 `confirmed` 或 `mock`

#### Scenario: 幂等 key 作用域冲突
- **WHEN** 同一 `address + requestId` 被用于不同的 `source`、`amount` 或 `researchId`
- **THEN** 系统 SHALL 返回 `PAYMENT_IDEMPOTENCY_CONFLICT`
- **AND** 系统 SHALL 不再次广播 ARC receipt

#### Scenario: 幂等 key 对应的广播仍在 pending
- **WHEN** 同一 `address + requestId` 的已有 tx_log 状态为 `pending`
- **THEN** 系统 SHALL 返回 `PAYMENT_RECEIPT_PENDING`
- **AND** 系统 SHALL 不再次广播 ARC receipt

### Requirement: Development mock receipts
系统 SHALL 在非 arc 模式下保留开发 mock receipt，但 MUST 明确标识为 mock。

#### Scenario: mock 模式记录调用
- **WHEN** `ARC_RECEIPT_MODE` 未设置或设置为 `mock`
- **THEN** 系统 SHALL 记录 tx_log
- **AND** tx_log 的 txStatus SHALL 为 `mock`
- **AND** mock txHash MUST NOT 在 UI 中展示为链上 confirmed

### Requirement: Payment event status
系统 SHALL 在 API、Agent event 和 wallet tx-log 中暴露 payment 的链上状态。

#### Scenario: 研究工具调用产生 payment 事件
- **WHEN** Agent 工具调用完成
- **THEN** `tool_result.payment` SHALL 包含 amount、txHash、txStatus、chainId 和 blockNumber
- **AND** 只有 txStatus 为 `confirmed` 时才表示链上确认成功

#### Scenario: 钱包查询 tx_log
- **WHEN** 已登录用户调用 `/api/wallet/tx-log`
- **THEN** 响应 SHALL 返回每条记录的 txStatus、chainId、blockNumber、requestId 和 errorMessage

### Requirement: TX feed truthfulness
系统 SHALL 根据 txStatus 展示真实状态，避免把 mock 或 failed 记录伪装成 confirmed。

#### Scenario: confirmed receipt 展示 explorer 链接
- **WHEN** payment txStatus 为 `confirmed` 且 explorer URL 已配置
- **THEN** TX feed SHALL 展示可点击 explorer 链接
- **AND** 状态 SHALL 显示 confirmed

#### Scenario: mock receipt 展示 mock 状态
- **WHEN** payment txStatus 为 `mock`
- **THEN** TX feed SHALL 显示 mock receipt
- **AND** 不 SHALL 显示 confirmed

#### Scenario: failed receipt 展示失败状态
- **WHEN** payment txStatus 为 `failed`
- **THEN** TX feed SHALL 显示 failed
- **AND** 不 SHALL 显示 confirmed
