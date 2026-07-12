## MODIFIED Requirements

### Requirement: Research 记录持久化
系统 SHALL 保存 research 的 buyer、主题、展示预算、六位链上预算、花费、面向用户的 status、独立 activationPhase/finalizationState、报告、错误、创建/准备/启动/完成时间和取消请求；ARC Escrow research 还 SHALL 保存 prepare 幂等作用域、quota reservation、researchKey、预期 Escrow/expiry、funding voucher、不可变 intent signer、funding/activation 链上证据、runner lease、持久事件 checkpoint 和 workflow operation 关联。research status SHALL 使用 `funding/funding_expired/running/completed/failed/cancelled`，activationPhase SHALL 使用 `none/funded/activating/active/expired/cancelled`，finalizationState SHALL 使用 `none/open/closing/closed/manual`，从而允许报告先完成而资金在后台终态化。所有状态转换 SHALL 遵循 design 状态表并使用持久数据库事务，旧 mock/calldata research SHALL 保持可读。

#### Scenario: 创建并完成既有模式 research
- **GIVEN** 已认证用户在 mock 或 legacy calldata 模式提交合法 topic 和 budget
- **WHEN** Agent 生成最终报告
- **THEN** research 状态 SHALL 为 `completed`，`reportMd` SHALL 被保存，`spentUsdc` SHALL 等于已持久化工具调用总额
- **AND** 既有 researchId、startedAt、completedAt、列表和详情响应语义 SHALL 保持兼容

#### Scenario: ARC prepare 原子保存 funding 与 quota reservation
- **GIVEN** production Escrow backend 的持久数据库、迁移和 worker 鉴权配置均已就绪
- **WHEN** 已认证 buyer 使用新的稳定 `Idempotency-Key` 提交合法 topic 与可精确表示为六位 units 的 budget
- **THEN** 系统 SHALL 在同一持久事务中创建唯一 `funding` research 和唯一 wallet/global quota reservation
- **AND** SHALL 保存 prepareRequestId、buyer、canonical researchId、researchKey、topic、budgetUsdc、budgetUnits、expectedExpiresAt、fundingDeadline、intentSigner、voucherNonce、quotaDate、reservation=`reserved`、activationPhase=`none`、createdAt、preparedAt 与 fundingExpiresAt
- **AND** spentUsdc 与 spentUnits SHALL 为零，startedAt、escrowAddress、fundingTxHash 和 activationTxHash SHALL 为空
- **AND** finalizationState SHALL 为 `none`
- **AND** prepare 不 SHALL 启动 Agent、兑现 quota reservation 或计入已运行/完成/取消/花费统计

#### Scenario: createAndFund 后保存 Funded 证据
- **GIVEN** buyer 已使用 prepare 返回的 FundingVoucher 成功调用 `createAndFund`
- **WHEN** 服务端或详情恢复流程验证 funding receipt 与链上实例
- **THEN** Escrow 链上状态 SHALL 为 `Funded` 而非 `Active`
- **AND** research SHALL 保存 escrowAddress、fundingTxHash、chainId、blockNumber、blockHash、event logIndex、实际 funding Transfer delta 与验证时间
- **AND** 实际入金 SHALL 精确等于 prepared budgetUnits，research SHALL 继续不处于 `running`
- **AND** quota reservation SHALL 保持预留但尚未兑现，Agent、payment intent 与 RUN operation 均不 SHALL 被创建

#### Scenario: 激活成功后原子进入 running
- **GIVEN** buyer 的 ActivationAuthorization、activation receipt 与 Funded Escrow 已通过全部 start 前置校验
- **WHEN** start 接受该激活
- **THEN** 系统 SHALL 在同一数据库事务中把 quota reservation 精确兑现一次、保存 activationTxHash 与链上定位、把 research 从 `funding` 转为 `running`、设置 startedAt 并创建唯一 RUN operation
- **AND** buyer、researchId、researchKey、topic、budgetUsdc、budgetUnits、expectedExpiresAt、escrowAddress 和 intentSigner SHALL 自 prepare/链上激活后不可替换
- **AND** finalizationState SHALL 从 `none` 转为 `open`
- **AND** start 重试不 SHALL 重复写 ACTIVATE/RUN operation、提交 activation、兑现 quota 或创建第二条 research

#### Scenario: funding reservation 到期先处理 ACTIVATE
- **GIVEN** fundingDeadline 到达
- **WHEN** 过期 worker 或任一相关 API 观察到过期
- **THEN** 系统 SHALL 先 claim/reconcile 任一 ACTIVATE operation；reservation=`activating`、交易 pending 或结果不确定时不得释放 quota 或标记 funding_expired
- **AND** 若链上 Active且无 cancelRequestedAt，系统 SHALL consume reservation、恢复唯一 RUN；若已 Active且已有 cancelRequestedAt，则 SHALL consume、不得创建 RUN并进入 cancelled/finalizationState=closing
- **AND** 只有证明链上未 Active、ActivationAuthorization 已过 deadline且不会再生效时，系统才 SHALL 以条件更新标记 `funding_expired` 并把 reservation 精确 release 一次
- **AND** SHALL 保留 research、voucher、funding/activation 链上证据和过期时间用于审计，不 SHALL 删除记录
- **AND** funding_expired 不 SHALL 计入运行、completed、cancelled 或 spent 统计；若 Escrow 仍 Funded，详情 SHALL 暴露 buyer 的 cancelUnactivated 退款动作

#### Scenario: expand/backfill/switch/contract 零停机迁移
- **GIVEN** 生产数据库中存在旧 research、tx_log 和 payment_settlement 行
- **WHEN** 发布 Escrow 数据模型
- **THEN** 系统 SHALL 通过带 migration journal、单实例锁和失败恢复的正式 migrator 执行变更；expand 阶段先增加 nullable 的 createdAt、preparedAt、fundingExpiresAt、可空 startedAt、Escrow/key/snapshot、runner lease、持久事件与 workflow_outbox 字段/表/索引，不改变旧 reader/writer
- **AND** backfill 阶段 SHALL 为旧行稳定回填 createdAt 及 backend/version 等兼容值，并证明行数、金额和状态不变
- **AND** switch 阶段 SHALL 在双读写、worker 健康检查和迁移版本检查通过后才允许开启 funding UI 与 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow`
- **AND** contract 阶段 SHALL 仅在无旧 writer 且回滚窗口结束后收紧约束；V1 不 SHALL 为方便而删除旧字段或旧行
- **AND** research 列表 SHALL 使用稳定 createdAt 与 id 排序，不 SHALL 依赖 nullable startedAt

### Requirement: Agent tool calling 与预算控制
系统 SHALL 让 Agent 在预算内调用 5 个 x402 数据源，为每次实际付费调用先持久化稳定 payment intent，再产生事件和异步结算；ARC Escrow research SHALL 由 DB runner lease 独占执行，并 SHALL 以 prepared budget、Active Escrow、expiry、Registry snapshot、链上 spent/key 和 closing/cancel 屏障共同限制新 intent。临时 LLM call.id 不得作为持久支付身份。

#### Scenario: 多实例只有 DB lease owner 执行 Agent
- **GIVEN** 同一 running research 被多个 serverless 实例、SSE 订阅或 worker 同时观察
- **WHEN** 它们尝试执行 RUN operation
- **THEN** 仅原子取得未过期 DB runner lease 的 worker SHALL 调用 LLM、执行工具或创建 payment intent
- **AND** 其他实例 SHALL 只读取持久状态/事件，不 SHALL 依赖 globalThis runner claim 启动第二个 Agent
- **AND** runner lease SHALL 保存 owner、expiresAt、attempts、单调 fencing token、heartbeat/checkpoint 和最后错误；每次状态/intent 写入必须条件校验当前 fence，并可在安全边界续租或回收

#### Scenario: 工具调用先持久化稳定 payment intent
- **GIVEN** lease owner 收到一个可执行付费 tool call
- **WHEN** 准备执行本地数据工具
- **THEN** 系统 SHALL 先在事务中分配 canonical paymentIntentId 与单调 toolOrdinal，并以 `(researchKey, paymentIntentId)` 派生稳定 requestKey
- **AND** SHALL 保存 source/sourceId、六位 amountUnits、Registry revision、expectedPayout、maxUnitPrice、读取 block、payload hash、escrowAddress、researchKey 和 pending 状态
- **AND** 相同 toolOrdinal/paymentIntentId 的重试 SHALL 复用既有 intent，不 SHALL 使用临时 LLM call.id 创建第二个 requestKey
- **AND** 只有持久化成功后才 SHALL 执行工具并产生 `tool_call`、`tool_result` 和 `budget` 事件
- **AND** `tool_result.payment.txStatus` SHALL 为 `pending`，且 Agent 不 SHALL 等待链上 settlement receipt

#### Scenario: 创建 intent 前执行精确资金与生命周期校验
- **GIVEN** ARC Agent 准备创建下一条付费 intent
- **WHEN** runner 在同一一致性边界读取 research、既有 intents 和 Escrow
- **THEN** research SHALL 仍为 running、runner lease SHALL 仍归当前 worker、cancelRequestedAt SHALL 为空且 closing 屏障 SHALL 未建立
- **AND** escrowAddress、buyer、researchKey、intentSigner、initialBudget 与 expectedExpiresAt SHALL 精确等于 prepare/start 持久值，Escrow SHALL 为 Active
- **AND** 链上 spent、已处理 settlementKey/requestKey、现有本地 liability 和 spentUnits SHALL 与持久 checkpoint 一致
- **AND** `chainSpent + 未结算 liability + nextAmount` SHALL 不超过 initialBudget，nextAmount SHALL 精确满足 Registry snapshot 上限
- **AND** 剩余 TTL SHALL 至少为固定 `MIN_SETTLEMENT_SAFETY_WINDOW=15m`；不满足任一条件时系统 SHALL fail closed、不得创建 intent，并进入报告生成或安全终态化

#### Scenario: 预算按持久 payment intent 精确扣减
- **GIVEN** 一条新的 pending payment intent 已持久化
- **WHEN** 系统更新 research 预算 checkpoint
- **THEN** spentUnits SHALL 使用整数六位 units 原子增加，spentUsdc SHALL 由 units 无损派生
- **AND** 后续工具循环 SHALL 基于已持久化 liability 而非进程内浮点累计计算剩余预算
- **AND** wallet settled totals MAY 仅统计已完整对账的 confirmed/mock 记录，但 research liability SHALL 包含 pending intent

#### Scenario: 预算不足停止工具循环
- **GIVEN** 本地剩余预算、Escrow 可用预算或安全 TTL 低于下一次工具调用所需边界
- **WHEN** Agent 准备继续请求工具
- **THEN** 系统 SHALL 跳过该工具且不创建 payment intent
- **AND** SHALL 进入报告生成或产生明确、可持久 replay 的预算/期限不足事件

#### Scenario: 默认最多执行三个付费数据源调用
- **GIVEN** DeepSeek 在一次 research 中返回超过 3 个可执行付费 tool calls
- **WHEN** 已存在 3 个实际执行的持久 payment intents
- **THEN** 后续付费 tool calls SHALL 写入 tool message `skipped`，reason 为 `tool_call_limit_reached`
- **AND** 系统不 SHALL 为被跳过的 tool call 分配 paymentIntentId/requestKey
- **AND** spentUsdc SHALL 只包含实际持久化并执行的最多 3 个工具金额

#### Scenario: 首个付费 intent 后 runner lease 丢失
- **GIVEN** runner 已持久化至少一个付费 intent 后崩溃、失去 heartbeat 或 lease 过期
- **WHEN** 补偿 worker 观察到该 RUN operation
- **THEN** V1 不 SHALL 自动从头重跑 Agent 或生成新的 toolOrdinal/paymentIntentId
- **AND** 系统 SHALL 把 research status 标记为 `failed`、finalizationState 标记为 `closing`，保留可重建的报告 checkpoint，结算或明确终态化既有 intents，并调度 CLOSE 退款

#### Scenario: durable cancel 与 intent 创建竞态
- **GIVEN** cancel 请求与 runner 创建新 intent 并发
- **WHEN** 两者争用同一 research 条件更新/事务锁
- **THEN** 只 SHALL 有 cancel/closing 屏障或新 intent 创建之一成功
- **AND** cancelRequestedAt 或 closing 成功后 runner SHALL 在下一次 LLM、工具和 intent 边界停止
- **AND** 已存在 liability 不得遗漏，新的 liability 不得穿透 closing 屏障

### Requirement: SSE 研究事件流
系统 SHALL 通过 `/api/research/[id]/stream` 以 SSE 输出 AgentEvent，并 SHALL 将 ARC Escrow research 的事件或等价 checkpoint 持久化为可排序、可去重和可冷启动恢复的历史。globalThis event bus 只能作为同实例低延迟优化，SSE 订阅不得承担 runner 调度权；报告终态不 SHALL 等待 settlement/close 完成。

#### Scenario: 持久化事件与 checkpoint
- **GIVEN** runner 产生 thinking、tool_call、tool_result、budget、report_chunk、final 或 error
- **WHEN** 事件对客户端可见
- **THEN** 系统 SHALL 已保存单调 eventId/cursor、researchId、type、payload 或可确定性重建该事件的 checkpoint
- **AND** 相同 operation attempt 重放不 SHALL 生成逻辑重复事件
- **AND** payment 状态 SHALL 可由 tx_log/settlement 对账结果覆盖 pending checkpoint

#### Scenario: 订阅运行中的 research 不启动 runner
- **GIVEN** research 正在运行且 RUN operation 由 worker 管理
- **WHEN** 一个或多个客户端订阅 SSE
- **THEN** 服务端 SHALL 先 replay 持久事件，再推送后续事件
- **AND** SSE handler 不 SHALL claim DB runner lease、直接调用 Agent 或因订阅断开取消 Agent

#### Scenario: serverless 冷启动按 cursor 恢复
- **GIVEN** 原实例已退出或 globalThis event bus 为空
- **WHEN** 客户端刷新、重连或携带 Last-Event-ID/等价 cursor 订阅
- **THEN** 服务端 SHALL 从持久事件/checkpoint 与 research/tx_log 恢复缺失历史
- **AND** SHALL 从 cursor 之后继续发送且不重复已确认事件
- **AND** 冷启动不 SHALL 创建第二个 RUN operation 或重新执行已持久化工具步骤

#### Scenario: pending payment 不阻塞 final 事件
- **GIVEN** research agent 已完成报告生成并原子保存报告/终态/outbox
- **WHEN** SETTLE、RECONCILE 或 CLOSE 仍为 pending
- **THEN** SSE SHALL 发送持久 `final` 事件，research 报告 SHALL 可立即读取
- **AND** workflow worker SHALL 在后台继续资金终态化，且其失败不 SHALL 撤回报告

#### Scenario: 订阅已终态 research
- **GIVEN** research 已 completed、failed、cancelled 或 funding_expired
- **WHEN** 客户端订阅 SSE
- **THEN** 服务端 SHALL replay 持久终态及可用历史后关闭连接
- **AND** 即使进程内 event bus 已清空，也 SHALL 返回与数据库事实一致的终态

### Requirement: Research API
系统 SHALL 提供 prepare、start、detail、stream、cancel API 并全部通过 `requireAuth` 保护。ARC Escrow 模式 SHALL 使用 `prepare → approve/createAndFund(Funded) → buyer ActivationAuthorization → start`，并 SHALL 把 quota、资金验证、激活、runner/outbox 与取消实现为持久、幂等、可恢复的状态机；mock 模式 SHALL 保持现有单步 start。

#### Scenario: ARC prepare 使用 Idempotency-Key 预留 quota
- **GIVEN** 已认证 buyer、有效 topic/budget 和稳定 `Idempotency-Key`
- **WHEN** 首次调用 ARC prepare API
- **THEN** 系统 SHALL 原子创建 funding research 与 wallet/global quota reservation，并返回 researchId、researchKey、预测 Escrow、官方 USDC、Factory、budgetUnits、expectedExpiresAt、fundingDeadline、intentSigner、FundingVoucher 和调用数据
- **AND** fundingDeadline SHALL 为 prepare 后 15 分钟，expectedExpiresAt SHALL 为 prepare 后 24 小时且满足 Factory 2 小时 MIN_ESCROW_TTL
- **AND** 响应不 SHALL 表示 running，且 prepare 不 SHALL 执行 Agent

#### Scenario: ARC prepare 幂等重试与作用域冲突
- **WHEN** 同一 buyer 使用相同 Idempotency-Key 与相同规范化 topic/budget 重试 prepare
- **THEN** 系统 SHALL 返回同一 research、reservation、voucher nonce/signature 与预测地址，不重复预留 quota
- **AND** 相同 key 被用于不同 buyer、topic 或 budget 时 SHALL 返回幂等冲突，不创建第二条 research/voucher/reservation

#### Scenario: createAndFund 后只进入 Funded
- **GIVEN** buyer 完成 approve 并成功提交有效 FundingVoucher 到 Factory
- **WHEN** 客户端查询详情或继续 start
- **THEN** API SHALL 验证 msg.sender/buyer、Factory、researchKey、预测地址、clone code、USDC、Transfer delta、budgetUnits、expectedExpiresAt、intentSigner、receipt 与事件
- **AND** SHALL 报告 Escrow 为 `Funded`，不 SHALL 把 research 标为 running 或允许 settlement
- **AND** buyer 在未激活时 SHALL 可调用 `cancelUnactivated` 并由详情恢复该退款动作

#### Scenario: buyer 签名激活并启动既有 research
- **GIVEN** 当前认证钱包拥有既有 funding research，Escrow 为 Funded，且 buyer 已签署字段完全匹配的未过期 ActivationAuthorization
- **WHEN** 调用 `POST /api/research/start`
- **THEN** 服务端 SHALL 验证签名 domain/chainId/verifyingContract、escrow、researchKey、buyer、intentSigner、initialBudget、expectedExpiresAt、activation nonce 和 deadline
- **AND** SHALL 先在持久事务保存授权 digest/受保护 payload 并创建唯一 ACTIVATE outbox，再由持有 lease 的授权 relayer/settler 提交 activate、等待并验证 receipt、事件与 Active 状态
- **AND** ActivationAuthorization deadline SHALL 不晚于 fundingDeadline，reservation SHALL 在同一事务从 reserved 变为 activating；剩余提交窗口不足时 SHALL 拒绝 start
- **AND** SHALL 在完整对账后的同一数据库事务中兑现 quota reservation、保存 activation 证据、执行 funding→running 条件更新并写唯一 RUN outbox
- **AND** 确认在请求窗口内完成时 SHALL 返回 `{ researchId, status: "running", activationPhase: "active" }`；否则 SHALL 返回可重试的 `{ researchId, status: "funding", activationPhase: "activating" }`，请求线程不 SHALL 以内存 fire-and-forget 作为唯一调度

#### Scenario: start 精确校验预算、expiry、TTL、spent 与 key
- **WHEN** start 在激活前后读取 prepared record、funding receipt 和 Escrow
- **THEN** initialBudget SHALL 精确等于 prepared budgetUnits 与官方 USDC funding Transfer delta
- **AND** 链上 expectedExpiresAt SHALL 精确等于 prepare 持久值，当前剩余 TTL SHALL 至少 60 分钟
- **AND** buyer、Factory、researchKey、预测/实际 Escrow、runtime implementation、USDC 和 intentSigner SHALL 全部匹配
- **AND** 激活前 spent SHALL 为零、accounted balance SHALL 等于 initialBudget、settlementKey/requestKey 处理状态 SHALL 为空且 Escrow SHALL 为 Funded
- **AND** 激活后 SHALL 验证 Active、不可变 intentSigner 与 activation event；任一不一致 SHALL fail closed 且不得进入 running、兑现 quota 或写 RUN operation

#### Scenario: start 幂等重试不重复 runner
- **GIVEN** 同一 research 已成功进入 running 或 completed，但首次 start 响应丢失
- **WHEN** buyer 使用相同 researchId 重试 start
- **THEN** 系统 SHALL 返回既有 researchId/status 与 activation 证据
- **AND** 不 SHALL 再创建 ACTIVATE、提交 activate、再次兑现 quota、创建第二个 RUN operation 或第二个 runner lease

#### Scenario: funding 到期拒绝延迟启动
- **GIVEN** fundingDeadline 已过或剩余 Escrow TTL 少于 60 分钟
- **WHEN** buyer 尝试 create/start 或过期 worker 扫描该 research
- **THEN** 已过期 voucher SHALL 不能创建 Escrow，start SHALL 拒绝进入 running
- **AND** 系统 SHALL 先 reconcile 任何 ACTIVATE；只有证明未 Active且授权不能再生效时才终态化 funding_expired 并 release reservation
- **AND** 已 Funded 未 Active 的 buyer SHALL 仍可通过 cancelUnactivated 立即取回余额

#### Scenario: production Escrow 缺少持久依赖时 fail closed
- **GIVEN** production 缺少持久 Postgres、所需 schema migration、workflow worker 或 worker 鉴权配置
- **WHEN** 请求 prepare 或 start Escrow research
- **THEN** 系统 SHALL 返回 `503 DURABLE_DB_REQUIRED`
- **AND** 不 SHALL 创建 quota reservation、FundingVoucher、research 资金流程或接受 activation
- **AND** production memory repo 与签名 research token fallback SHALL 仅允许 mock 路径使用

#### Scenario: mock 模式保持单步启动
- **GIVEN** 当前 `ARC_RECEIPT_MODE=mock`
- **WHEN** 已认证用户向 `POST /api/research/start` 提交合法 topic 和 budget
- **THEN** 系统 SHALL 继续返回 `{ researchId, status: "running" }` 并保持既有 mock runner/receipt 行为
- **AND** 不 SHALL 要求 Idempotency-Key、FundingVoucher、Escrow 资助或 ActivationAuthorization

#### Scenario: legacy ARC calldata 回滚路径保持单步启动
- **GIVEN** 当前 `ARC_RECEIPT_MODE=arc` 且 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata`
- **WHEN** 已认证用户向 `POST /api/research/start` 提交合法 topic 和 budget
- **THEN** 系统 SHALL 继续按既有 legacy 流程创建 running research、payment intents 和异步 0-value calldata receipt settlement
- **AND** 不 SHALL 请求 voucher/approve/Escrow/activation，不 SHALL 把 legacy tx 表示为真实 USDC transfer
- **AND** 从 escrow rollout 回滚到 calldata 不 SHALL 停止既有 Active Escrow 的 durable finalization worker

#### Scenario: cancel API 持久化并调度终态化
- **GIVEN** 当前用户拥有尚未 finalizationState=closed 的 funding、running、completed、failed 或 cancelled ARC research
- **WHEN** 调用 cancel API
- **THEN** 系统 SHALL 幂等持久化 cancelRequestedAt；若 Escrow 已 Active，SHALL 在同一事务建立 finalizationState=closing 屏障及必要的 SETTLE/RECONCILE/CLOSE outbox
- **AND** RUN worker SHALL 通过 durable cancellation 停止后续 LLM、工具和 intent，而不 SHALL 仅依赖进程内 AbortController
- **AND** funding/Funded 未 Active research SHALL 取消或 reconcile ACTIVATE、保持 finalizationState=none 并引导 buyer 调用 cancelUnactivated；receipt 对账后 activationPhase SHALL 为 cancelled、finalizationState SHALL 为 closed且 reservation SHALL released
- **AND** Active research SHALL consume reservation、先终态化既有 liability 再退款

#### Scenario: cancel 与 ACTIVATE 竞态确定处理
- **GIVEN** cancel 请求与 ACTIVATE operation 并发
- **WHEN** cancel API 建立持久 cancelRequestedAt
- **THEN** ACTIVATE 尚未广播时 SHALL 取消该 operation、保持 Funded 并走 cancelUnactivated/release；广播 pending 或不确定时 SHALL 先 reconcile，不得提前释放 quota
- **AND** 若链上已 Active，系统 SHALL consume reservation、绝不创建 RUN，并把 research status 设为 cancelled、finalizationState 设为 closing 后调度签名 CLOSE
- **AND** reservation 只 SHALL consumed 或 released 一次

### Requirement: Research settlement lifecycle
系统 SHALL 使用持久 `workflow_outbox` 驱动 ARC research 的 ACTIVATE、RUN、SETTLE、RECONCILE 和 CLOSE。每个 operation SHALL 保存唯一 operationKey、research/escrow、phase、依赖、payload hash、txHash、lease owner/expiry、fencing token、attempts、nextAttemptAt、lastError 和链上定位；start、cancel、research 终态与 outbox 写入 SHALL 位于同一数据库事务。受保护 Cron/queue worker 是必需调度器，进程内触发只能降低延迟。

#### Scenario: ACTIVATE 广播与 DB 崩溃可恢复
- **GIVEN** start 已持久化 buyer ActivationAuthorization 的 digest/受保护 payload 并创建唯一 ACTIVATE operation
- **WHEN** worker 在广播前、广播后未保存 txHash、receipt 后未写 DB 或 RUN 入队前崩溃
- **THEN** 补偿 worker SHALL 先读取 Escrow 状态、activation nonce/event 和已知交易状态，恢复或重试同一授权而不创建第二个 operation
- **AND** 链上已 Active且 cancelRequestedAt 为空时 SHALL 对账原 activation、原子把 reservation 变为 consumed并写唯一 RUN；不得误标 funding_expired 或再次 activate
- **AND** 链上已 Active且 cancelRequestedAt 非空时 SHALL 同样 consume reservation，但 MUST 禁止 RUN，把 research 设为 cancelled/finalizationState=closing 并调度签名 CLOSE
- **AND** 未消费的原始签名 SHALL 只存在受保护 payload，不得写入公开日志、event 或诊断字段

#### Scenario: RUN operation 使用 lease 启动 Agent
- **GIVEN** start 已原子创建唯一 RUN operation
- **WHEN** 一个或多个 worker 扫描到该 operation
- **THEN** 只有原子 claim 有效 lease 的 worker SHALL 执行 Agent
- **AND** RUN checkpoint/heartbeat SHALL 支持首个付费 intent 前的安全重试
- **AND** SSE 请求和 API 响应生命周期不 SHALL 决定 RUN 是否继续

#### Scenario: completed research 创建 SETTLE、RECONCILE 与 CLOSE 依赖链
- **GIVEN** ARC runner 已完成报告并存在一个或多个 payment intents
- **WHEN** research status 原子进入 completed 且 finalizationState 原子进入 closing
- **THEN** 同一事务 SHALL 冻结新 intent 并创建确定性 SETTLE 与 CLOSE operation；RECONCILE SHALL 在广播状态不确定或链上成功待本地确认时创建/推进
- **AND** SETTLE snapshot SHALL 固定 settlementId/key、按 requestKey 排序的 intents、itemsHash、total、Registry snapshots 和 intent signer authorization payload hash
- **AND** CLOSE SHALL 按 requestKey 排序把每个既有 intent 恰好编码为 PAID、VOID_BEFORE_SIDE_EFFECT 或经审批 UNPAYABLE_MANUAL，验证 PAID result/spent 与 canonical finalLiabilityHash 后才可签名
- **AND** 报告 final SHALL 不等待这些 operation 完成

#### Scenario: cancelled research 先终态化既有 liability
- **GIVEN** cancelRequestedAt 已持久化且 research 已有 payment intents
- **WHEN** finalization worker 建立 closing 屏障
- **THEN** SHALL 停止新 intent、对既有 intents 执行 SETTLE/RECONCILE 或明确失败处理，再以签名 CloseAuthorization 执行 CLOSE
- **AND** cancel 与 intent 创建的数据库竞态不得遗漏任何 liability
- **AND** tx_log 不 SHALL 永久停留在无 owner 的 pending 状态

#### Scenario: no-intent research 仍创建 CLOSE
- **GIVEN** Active research 完成、失败或取消且没有 payment intent/payment_settlement row
- **WHEN** research finalizationState 进入 closing
- **THEN** 同一事务 SHALL 创建唯一 CLOSE operation 并跳过 settleBatch
- **AND** worker SHALL 使用 design 固定的空 liabilities hash `0xa700e53730858c2f4b9b5e2287eb6277837358afa904bd8288dccd07809876e4` 和有效 CloseAuthorization 退回全部预算/excess
- **AND** 缺少 settlement row 不 SHALL 导致 Escrow 被遗忘到 expiry

#### Scenario: operation lease 防止多 worker 重复副作用
- **GIVEN** 多个 Cron/queue worker 同时扫描同一到期 operation
- **WHEN** 它们尝试 claim
- **THEN** 只有一个 worker SHALL 获得当前 lease 并推进 phase
- **AND** operationKey 唯一约束、条件更新和链上 activation/settlement/request/close nonce/key SHALL 共同防止重复 RUN、支付、激活或关闭
- **AND** 未获得 lease 的 worker SHALL 不广播交易
- **AND** 已失去 lease 的旧 worker 即使暂停后恢复，其旧 fencing token 也 SHALL 无法写 checkpoint、创建 intent、推进 phase 或广播下一步

#### Scenario: 广播前或广播后崩溃恢复
- **GIVEN** worker 在 simulate 后广播前、广播后未保存 txHash、保存 txHash 后等待 receipt、receipt 后未写 DB 或 CLOSE 前任一位置崩溃
- **WHEN** lease 到期且补偿 worker claim operation
- **THEN** worker SHALL 先依据 operation phase、operationKey、已知 txHash、nonce、链上 key/result 摘要与 indexed events 判断副作用是否发生
- **AND** 已发生的 settlement/close SHALL 经事件、USDC Transfer、余额差和 payload hash 对账后恢复本地状态
- **AND** 广播结果不确定时不 SHALL 盲目重发；仅在证明链上未处理且签名/nonce/deadline仍有效时才可重试

#### Scenario: retry 使用 backoff 且失败可诊断
- **GIVEN** RPC、receipt、Registry revision、签名、数据库或链上校验暂时失败
- **WHEN** operation 未达到人工恢复或永久失败边界
- **THEN** worker SHALL 增加 attempts、保存脱敏 lastError、设置 nextAttemptAt 并释放 lease
- **AND** 到期后其他 worker SHALL 可继续恢复，confirmed/Closed operation 不 SHALL 再广播
- **AND** 不可自动恢复的 mismatch SHALL 保留链上定位和人工恢复状态，不 SHALL 伪装 confirmed

#### Scenario: manual finalization 受审计恢复
- **GIVEN** operation 重试耗尽或链上/数据库证据冲突使 finalizationState 进入 manual
- **WHEN** 受保护的人工恢复入口尝试 requeue 或 reconcile
- **THEN** 系统 SHALL 记录操作者、原因、原/新 evidence digest 和时间；不得修改 canonical intent、签名或链上事实
- **AND** 只有仍需执行时可从 manual 回到 closing，只有公开证据已证明 Escrow Closed 时可变为 closed
- **AND** 普通用户、SSE 请求和无审批 cron 不 SHALL 绕过该门禁

#### Scenario: escrow backend worker 不可用时禁止新资金流程
- **GIVEN** Cron/queue 鉴权、数据库迁移版本或 worker 健康门禁未通过
- **WHEN** rollout 尝试切换 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow`
- **THEN** switch SHALL fail closed，prepare/start SHALL 保持禁用
- **AND** 既有 Active Escrow 的 worker/恢复路径 SHALL 继续运行，不得因回滚 UI 或新流量而停止 settlement/close

### Requirement: Follow-up Q&A remains off-chain
系统 SHALL 保持 follow-up Q&A 不产生链上 payment intent、quota reservation、runner lease 或资金 workflow operation，也不 SHALL 读取、签名、调用或改变原 research 的 Escrow。该行为 SHALL 对历史 mock/calldata research 与新 Escrow research 保持一致。

#### Scenario: 对任意已完成 research 提交 follow-up
- **GIVEN** 已认证用户拥有 completed research，无论其 backend 为 mock、legacy calldata 或 Escrow，且 Escrow 可能仍在 SETTLE/RECONCILE/CLOSE
- **WHEN** 用户提交 follow-up question
- **THEN** 系统 SHALL 只基于已保存报告和历史 Q&A 生成回答
- **AND** 不 SHALL 创建 tx_log payment intent、paymentIntentId/requestKey、quota reservation 或 RUN/SETTLE/RECONCILE/CLOSE operation
- **AND** 不 SHALL 请求 funding/activation/settlement/close 签名，不 SHALL 调用或改变 ResearchEscrow
- **AND** follow-up spentUsdc SHALL 为 `0`

#### Scenario: follow-up 重试与冷启动保持离线
- **GIVEN** follow-up 请求重试、进程冷启动或原 research 的资金 worker 同时运行
- **WHEN** follow-up 被执行或恢复
- **THEN** follow-up 幂等与状态 SHALL 继续使用既有 Q&A repository 语义
- **AND** 不 SHALL claim 原 research 的 runner/outbox lease、推进资金 phase 或影响持久 SSE/payment checkpoint
- **AND** 原 research 的 settlement/close 失败不 SHALL 把 follow-up 计费或改写为链上操作
