## MODIFIED Requirements

### Requirement: UTC daily research quota
系统 SHALL 对 research 创建实行 UTC 自然日配额：每个钱包最多 10 次，所有钱包累计最多 100 次。生产环境 SHALL 使用同一持久 Postgres quota bucket/reservation 作为 mock、legacy calldata 与 Escrow backend 的权威计数；Escrow prepare SHALL 先预留，Active 后精确消费，未激活终止后精确释放。合法边只有 `reserved→released` 或 `reserved→activating→consumed|released`。quota 聚合字段 `reserved` SHALL 同时统计 reservation state 为 reserved 或 activating 的记录，`used = consumed + reserved`；所有 wallet/global 更新 SHALL 位于同一数据库事务并使用唯一 reservation 防重。开发 mock MAY 使用现有回退，但不得启用真实 Escrow。

#### Scenario: mock 或 legacy start 原子消费配额
- **GIVEN** 当前 wallet/global UTC bucket 均有剩余额度
- **WHEN** mock 或 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` research 成功创建
- **THEN** 系统 SHALL 在创建 research 的同一持久事务把 wallet/global consumed 各增加一
- **AND** 重试、失败或事务回滚不 SHALL 重复消费

#### Scenario: Escrow prepare 原子预留配额
- **GIVEN** 当前 wallet/global UTC bucket 均满足 `consumed + reserved < limit`
- **WHEN** buyer 使用新的 Idempotency-Key 成功 prepare
- **THEN** 系统 SHALL 在创建 funding research 的同一 Postgres 事务创建唯一 reservation，并把 wallet/global reserved 各增加一
- **AND** 相同幂等作用域重试 SHALL 返回同一 reservation，不重复增加 used

#### Scenario: Wallet reaches its daily limit
- **GIVEN** 某钱包当日 `consumed + reserved` 已达到 10
- **WHEN** 该钱包再次请求 start 或 prepare
- **THEN** 系统 SHALL 拒绝请求并返回 `429`
- **AND** 响应错误码 SHALL 为 `WALLET_LIMIT`

#### Scenario: Global daily limit is reached
- **GIVEN** 当日所有钱包累计 `consumed + reserved` 已达到 100
- **WHEN** 任意钱包再次请求 start 或 prepare
- **THEN** 系统 SHALL 拒绝请求并返回 `429`
- **AND** 响应错误码 SHALL 为 `GLOBAL_LIMIT`

#### Scenario: activation 精确消费 reservation
- **GIVEN** reservation 为 `activating` 且 ACTIVATE 已完整对账为 Active
- **WHEN** 系统执行 funding→running 转换
- **THEN** 同一事务 SHALL 把 reservation 改为 `consumed`、wallet/global reserved 各减一、consumed 各加一
- **AND** start/worker 重试不 SHALL 再改变 bucket

#### Scenario: 未激活终止精确释放 reservation
- **GIVEN** reservation 仍为 `reserved` 或 `activating`，且链上已证明 Escrow 未 Active并已取消/未创建，或 voucher 确定过期且不存在待 reconcile ACTIVATE
- **WHEN** funding_expired 或 cancelUnactivated 终态完成
- **THEN** 系统 SHALL 把 reservation 改为 `released`，wallet/global reserved 各减一且 consumed 不变
- **AND** 重试、cancel-vs-expiry 或 worker 并发只 SHALL 释放一次

#### Scenario: ACTIVATE 不确定时不得释放
- **GIVEN** ACTIVATE 已广播或链上结果不确定
- **WHEN** fundingDeadline、取消或 quota cleanup 到达
- **THEN** 系统 SHALL 先 claim/reconcile 同一 ACTIVATE operation，reservation SHALL 保持 `activating`
- **AND** 若链上 Active则 SHALL 精确消费 reservation；若确定未激活并完成 Funded 退款则 SHALL 精确释放

#### Scenario: Quota resets at UTC midnight
- **GIVEN** quota bucket/reservation 在某 UTC 日期创建
- **WHEN** 时间进入下一 UTC 日期
- **THEN** 新 start/prepare SHALL 使用新日期的独立 bucket，其 used 从 0 开始
- **AND** 跨午夜仍有效的旧 reservation SHALL 继续绑定原 quotaDate，并只在原 bucket consume/release，不得迁移或双计入新 bucket

#### Scenario: KV 到 Postgres 权威切换
- **GIVEN** 现有 production quota 仍由 KV 计数
- **WHEN** 发布 Postgres quota bucket/reservation
- **THEN** 系统 SHALL 先 shadow dual-write 并逐请求 read-compare，在指定下一 UTC bucket 边界排空旧实例后原子切换权威 backend
- **AND** 任一时刻 SHALL 只有一个 backend 决定是否放行；对账不一致、混合旧 writer 或切换配置不一致时 Escrow funding SHALL fail closed
- **AND** 切换完成前后 wallet 10/global 100 限额不得因跨存储重复或漏计而突破

### Requirement: Authenticated quota status API
系统 SHALL 提供登录态 `GET /api/quota`，返回当前 UTC bucket 的 wallet/global consumed、reserved、used、limit、remaining 和 resetAt；used SHALL 精确等于 consumed + reserved，remaining SHALL 为 `max(limit-used, 0)`。

#### Scenario: Authenticated user requests quota
- **GIVEN** 用户已登录
- **WHEN** 请求 `GET /api/quota`
- **THEN** 返回当前 wallet/global 的 consumed、reserved、used、limit、remaining、resetAt 和权威 backend
- **AND** funding reservation 创建、消费或释放后重试查询 SHALL 反映已提交的持久事实

#### Scenario: Anonymous user requests quota
- **GIVEN** 用户未登录
- **WHEN** 请求 `GET /api/quota`
- **THEN** 返回 `401`

### Requirement: Terminal quota UI
研究创建页和 dashboard SHALL 以 Bloomberg 终端风格展示每日配额，并 SHALL 区分 consumed 与 funding reserved。Escrow funding 流程进行时 SHALL 以服务端 quota response 为准，不能仅靠客户端乐观计数。

#### Scenario: Quota is available
- **GIVEN** 当前钱包和全局配额均未耗尽
- **WHEN** 用户打开 `/research`
- **THEN** 创建表单 SHALL 展示 wallet/global consumed、reserved、used、ASCII 进度条、距离重置时间和 mainnet 后放开提示

#### Scenario: Quota is exceeded
- **GIVEN** 当前钱包或全局 `used` 已达到 limit
- **WHEN** 用户打开 `/research` 或 prepare 返回限额错误
- **THEN** `START RESEARCH`/prepare 入口 SHALL 禁用并显示 `[ QUOTA EXCEEDED ]`

#### Scenario: reservation 状态可恢复
- **GIVEN** 当前 buyer 已有 funding/activating research 的 quota reservation
- **WHEN** 页面刷新或重新登录
- **THEN** UI SHALL 从 API 恢复 reserved 用量和对应 research 状态，不重复 prepare，也不把 reserved 显示成已运行 consumed
