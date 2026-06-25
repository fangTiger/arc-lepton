## ADDED Requirements

### Requirement: Daily research history purge
系统 SHALL 每天自动清理超过 10 天保留期的研究历史。

#### Scenario: Purge records older than retention window
- **WHEN** 定时清理任务在时间 `T` 执行
- **THEN** 系统删除 `startedAt < T - 10 days` 的 research 记录
- **AND** 系统删除 `createdAt < T - 10 days` 的 tx_log 记录
- **AND** 系统保留 `startedAt >= T - 10 days` 的 research 记录
- **AND** 系统保留 `createdAt >= T - 10 days` 的 tx_log 记录

#### Scenario: Daily schedule uses Beijing midnight
- **WHEN** 应用部署到 Vercel
- **THEN** 系统 SHALL 配置每天 UTC 16:00 触发清理任务
- **AND** 该时间对应北京时间每天 00:00

### Requirement: Protected purge endpoint
系统 MUST 防止未授权请求触发历史清理。

#### Scenario: Missing or invalid cron secret
- **WHEN** 清理 API 收到缺失或错误的 `Authorization` header
- **THEN** 系统返回 401
- **AND** 系统不得删除任何 research 或 tx_log 记录

#### Scenario: Valid cron secret
- **WHEN** 清理 API 收到 `Authorization: Bearer <CRON_SECRET>`
- **THEN** 系统执行一次 10 天保留清理
- **AND** 系统返回清理截止时间和删除统计

### Requirement: Idempotent purge behavior
系统 SHALL 允许同一个清理任务重复执行而不会影响保留期内数据。

#### Scenario: Duplicate invocation
- **WHEN** 相同截止时间的清理任务执行两次
- **THEN** 第二次执行不会删除额外的保留期内记录
- **AND** 第二次执行返回的删除数量可以为 0
