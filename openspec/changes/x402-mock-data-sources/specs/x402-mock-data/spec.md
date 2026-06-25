## ADDED Requirements

### Requirement: tx_log repository with dev fallback
系统 SHALL 记录每次付费数据源调用，并在本地无 DB 连接串时使用进程内 tx_log repository。

#### Scenario: 本地记录支付调用
- **WHEN** 本地没有 DB 环境变量且用户调用付费数据源
- **THEN** 系统 SHALL 生成 tx_log id、mock txHash、createdAt
- **AND** 后续按 address 查询 SHALL 返回该记录
- **AND** totalSpentByAddress SHALL 返回 decimal string 总花费

#### Scenario: 生产运行时没有 DB 环境变量
- **WHEN** 当前是生产运行时且没有 `DATABASE_URL` 或 `POSTGRES_URL`
- **THEN** 系统 SHALL fail fast，而不是静默使用 memory repo

### Requirement: x402 style payment wrapper
付费 API route SHALL 使用统一 wrapper 执行认证、记账和支付凭证响应头。

#### Scenario: 未登录调用付费 API
- **WHEN** 请求没有有效 session cookie
- **THEN** 响应 SHALL 为 401
- **AND** 不 SHALL 记录 tx_log

#### Scenario: 已登录调用付费 API
- **WHEN** 请求有有效 session cookie
- **THEN** wrapper SHALL 记录 tx_log
- **AND** handler SHALL 收到 address、source、amount、txHash、recordedAt
- **AND** 响应 SHALL 包含 `X-Payment-Tx`、`X-Payment-Amount`、`X-Payment-Source`

### Requirement: Deterministic mock data sources
系统 SHALL 提供 5 个受支付 wrapper 保护的 mock 数据源，并按 token 和当前日期生成可重复数据。

#### Scenario: 调用任一数据源
- **WHEN** 已登录用户调用 `/api/data/{source}?token=PEPE`
- **THEN** 响应 SHALL 包含 source、token、data、payment
- **AND** payment SHALL 包含 amount、txHash、source
- **AND** 同一天同 token 的非支付业务数据 SHALL 保持一致

### Requirement: Wallet accounting APIs
系统 SHALL 提供当前用户的 tx_log 列表和统计接口。

#### Scenario: 查询钱包调用记录
- **WHEN** 已登录用户调用 `/api/wallet/tx-log`
- **THEN** 响应 SHALL 返回最近 50 条 tx_log，按 createdAt 倒序

#### Scenario: 查询钱包统计
- **WHEN** 已登录用户调用 `/api/wallet/stats`
- **THEN** 响应 SHALL 返回 totalSpentUsdc、totalCalls、lastResearchAt
