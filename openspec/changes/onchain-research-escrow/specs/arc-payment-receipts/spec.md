## MODIFIED Requirements

### Requirement: ARC receipt transactions
系统 SHALL 在 `ARC_RECEIPT_MODE=arc` 时为直接付费数据源调用继续产生既有 ARC 测试网 receipt，且该直接路径 SHALL 不受 `ARC_RESEARCH_SETTLEMENT_BACKEND` 影响；仅当 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow` 时，research agent 的付费工具调用 SHALL 先形成持久 payment intents，再由独立 intent signer 授权、独立 settler 广播的 ResearchEscrow 批次执行真实 test USDC settlement。

#### Scenario: 直接付费 API 成功写入 ARC receipt
- **WHEN** 已认证用户直接调用受 payment wrapper 保护的付费数据源且 ARC receipt 配置完整
- **THEN** 系统 SHALL 发送 ARC 测试网交易并等待 receipt
- **AND** tx_log SHALL 保存真实 txHash、chainId、blockNumber、requestId 和 `confirmed` 状态
- **AND** 返回给调用方的 payment SHALL 包含同一 txHash 和 `confirmed` 状态
- **AND** 该 `/api/data/*` 路径 SHALL 保持既有 receipt 行为，不 SHALL 创建 workflow outbox、要求 ResearchEscrow、请求 intent signer 签名或由 settler 广播 Escrow settlement

#### Scenario: Research 工具调用先创建带 Registry 快照的 pending intent
- **GIVEN** ARC research 已绑定 Active ResearchEscrow，且 escrow backend 的持久数据库与 worker 已就绪
- **WHEN** research agent 准备执行一次付费工具调用
- **THEN** 系统 SHALL 在工具副作用前持久化稳定 paymentIntentId/toolOrdinal，并按 v1 canonical 公式生成 researchKey、requestKey 和 sourceId
- **AND** tx_log payment intent SHALL 绑定 escrowAddress、researchKey、requestKey、六位 amountUnits，以及当次读取的 registryRevision、expectedPayout、maxUnitPrice 和 Registry blockNumber
- **AND** tx_log 的 txStatus SHALL 为 `pending`
- **AND** 该工具调用不 SHALL 等待 settlement 广播或 receipt 确认
- **AND** 返回给 Agent event 的 payment SHALL 包含 requestId、amount、source、escrowAddress、requestKey 和 `pending` 状态

#### Scenario: Research Escrow settlement 聚合多个工具调用
- **GIVEN** 同一 buyer、researchId 和 escrowAddress 下存在一条或多条 pending payment intent
- **WHEN** research 终态化流程为这些 intents 创建 settlement
- **THEN** 系统 SHALL 在持久事务中冻结确定性 intent 快照，并创建具有唯一 operationKey、payloadHash、phase、lease 和 attempt 信息的 SETTLE outbox operation
- **AND** 系统 SHALL 从稳定 canonicalSettlementId 生成 settlementKey，按 requestKey 无符号升序排列 items，并按 v1 canonical item 编码计算 itemsHash
- **AND** 每个 item SHALL 包含 requestKey、sourceId、registryRevision、expectedPayout、maxUnitPrice 和 amount，且 total 与 itemCount SHALL 由该不可变快照确定
- **AND** 与 settler 不同身份的 intent signer SHALL 对 escrow、researchKey、settlementKey、itemsHash、total、itemCount、nonce、issuedAt 和 deadline 生成有效 SettlementAuthorization
- **AND** 只有当前 SETTLER_ROLE SHALL 广播该已签名批次；settler 不 SHALL 自行生成授权，intent signer 不 SHALL 直接广播
- **AND** ResearchEscrow SHALL 在同一交易原子校验签名、canonical itemsHash、Registry revision/payout/max/active 和预算，并从 Escrow 向每个 expectedPayout 转移真实 ARC test USDC
- **AND** 每项转账 SHALL 强制 Escrow sender balance 精确减少 amount、expectedPayout receiver balance 精确增加 amount；self-transfer、fee-on-transfer 或任一异常余额差 SHALL 回滚全批
- **AND** 同一 settlementKey SHALL 最多成功执行一次，且同批 intents SHALL 共享 settlement txHash、chainId、blockNumber 和 escrowAddress

#### Scenario: Research settlement 不阻塞报告完成
- **WHEN** ARC RPC 慢、出块慢、SETTLE/RECONCILE operation 尚未执行或 Escrow settlement 尚未确认
- **THEN** research 报告仍 SHALL 保存为 completed 并返回给用户
- **AND** durable workflow outbox SHALL 在后台继续调度 settlement 与 reconciliation
- **AND** TX feed SHALL 展示 pending payment 状态
- **AND** 后续查询 SHALL 只在完整对账 confirmed 后展示 settlement explorer 链接

#### Scenario: Research Escrow settlement 失败
- **WHEN** SettlementAuthorization 无效、Registry 快照不再匹配、交易明确 reverted、receipt 或链上证据校验失败，或 escrow 配置缺失
- **THEN** 系统 SHALL 在 workflow operation/settlement attempt 保存失败 phase、attempt、nextAttemptAt 和不含机密的失败原因
- **AND** 对于已确定未在链上执行的批次，系统 SHALL 将 intents 保持为可补偿 pending 或进入明确 `failed` 终态，不得标记为 `confirmed`
- **AND** 对于广播结果不确定的批次，系统 SHALL 转入 RECONCILE phase，并在查询 txHash、indexed events、settlement result summary 和链上 key 前禁止重新广播
- **AND** 已完成的 research 报告不 SHALL 被撤回
- **AND** 事件缺失本身不构成未执行证明；只有 finalized 状态明确 `processed(settlementKey)=false`、相关 requestKey 未处理、已知 tx receipt/nonce 已确定未成功，且从部署区块到 finalized head 的索引扫描完整无匹配后，worker 才 MAY 使用同一冻结快照和仍有效签名安全重试

#### Scenario: 相同 settlement 批次避免重复支付
- **WHEN** 多个 worker 同时尝试处理同一 SETTLE 或 RECONCILE operation
- **THEN** workflow outbox 的唯一 operationKey 和 lease SHALL 保证同一时刻最多一个 worker 持有执行权
- **AND** 所有重试 SHALL 使用相同 settlementKey、canonical itemsHash、total、itemCount 和签名快照，不得重新选取或重排 intents
- **AND** ResearchEscrow SHALL 通过 settlementKey、requestKey 和 settlement result summary 拒绝重复执行已处理批次或 item
- **AND** 未获得 lease 的 worker 不 SHALL 广播 ARC transaction
- **AND** 任一 worker 在提交前 SHALL 查询链上处理状态，且不 SHALL 对已支付 item 再次转移 USDC

### Requirement: Payment event status
系统 SHALL 在 API、Agent event 和 wallet tx-log 中暴露 payment 的真实链上、outbox 与 reconciliation 状态；对于 escrow backend，系统还 SHALL 暴露可关联 canonical intent 快照、ResearchEscrow、签名批次、settlement result summary 和 indexed events 的公开标识，同时不得把仅已广播或仅 receipt 成功的记录表示为 `confirmed`。

#### Scenario: 研究工具调用产生 pending payment 事件
- **WHEN** Agent 工具调用完成但 research Escrow settlement 尚未完整对账
- **THEN** `tool_result.payment` SHALL 包含 amount、txStatus、chainId、blockNumber、requestId、escrowAddress 和 requestKey
- **AND** txStatus SHALL 为 `pending`
- **AND** txHash MAY 为 null
- **AND** SETTLE/RECONCILE operation 尚未终态时，API SHALL 保留 pending 真实性，不 SHALL 根据广播成功、局部事件或本地签名提前显示 confirmed

#### Scenario: 钱包查询 settlement 后的 tx_log
- **WHEN** 已登录用户调用 `/api/wallet/tx-log`
- **THEN** 响应 SHALL 返回每条记录的 txStatus、chainId、blockNumber、requestId、errorMessage、settlement txHash、escrowAddress 和 backend/version
- **AND** escrow 记录 SHALL 返回 researchKey、requestKey、settlementKey、itemsHash、registryRevision、expectedPayout、maxUnitPrice、amountUnits、operation phase 和 reconciliation 状态
- **AND** 已对账记录 SHALL 返回 settlement result summary 的 total、itemCount 和 processed 状态，以及批次/逐项 indexed event 的 transactionHash、blockNumber 和 logIndex
- **AND** 多条同一 research 的记录 MAY 共享同一个 settlement txHash，但每条记录 SHALL 保留自己的 requestKey、source 快照和逐项事件定位

## ADDED Requirements

### Requirement: Escrow settlement event reconciliation
系统 SHALL 将 durable operation snapshot、成功 receipt、ResearchEscrow 的 settlement result summary、批次/逐项 indexed events 和权威 USDC `Transfer` 日志共同作为 ARC research payment intent 进入 `confirmed` 的必要证据。批次事件 SHALL 至少把 escrow 与 settlementKey 设为 indexed，逐项事件 SHALL 把 requestKey 设为 indexed；链上 result summary SHALL 可按 settlementKey 读取 processed、itemsHash、total 和 itemCount。

#### Scenario: 成功 receipt 与冻结 settlement 快照完全一致
- **GIVEN** SETTLE worker 已提交由独立 intent signer 授权、当前 settler 广播的 signed batch
- **WHEN** receipt 成功且链上 settlementKey 已处理
- **THEN** reconciler SHALL 校验交易目标、调用方 settler、SettlementAuthorization signer/domain/issuedAt/deadline/nonce、escrow、researchKey、settlementKey、itemsHash、total 和 itemCount 与 durable snapshot 完全一致
- **AND** result summary 的 processed、itemsHash、total 和 itemCount SHALL 与 durable snapshot 完全一致
- **AND** 批次 indexed event 的 escrow/settlementKey 和每个逐项 indexed event 的 requestKey、sourceId、registryRevision、expectedPayout、maxUnitPrice、amount SHALL 与 canonical items 完全一致
- **AND** 每个 item SHALL 存在由权威 USDC contract 发出的六位精确 `Transfer(from=escrow,to=expectedPayout,value=amount)`，且该批次不得存在 snapshot 之外从 Escrow 发出的该 emitter Transfer
- **AND** reconciler SHALL 按 emitter 区分 Arc 同时产生的 18 位 system Transfer并以 `amount * 10^12` 交叉核对，不得把两类日志双计为两次支付
- **AND** 成功链上执行 SHALL 已强制验证每项 sender balance 精确减少 amount、receiver balance 精确增加 amount，否则完整交易必须 reverted
- **AND** 仅在全部校验通过后，系统 SHALL 原子地把 settlement operation、payment settlement 和全部对应 tx_log 标记为 `confirmed`，并保存 txHash、chainId、blockNumber、result summary 与事件位置

#### Scenario: receipt 成功但签名、摘要、事件或 Transfer 不匹配
- **GIVEN** settlement transaction receipt 状态为成功
- **WHEN** signer、canonical itemsHash、result summary、批次/逐项事件、Registry 快照字段、事件数量或 USDC Transfer 任一项与 durable snapshot 不一致
- **THEN** 系统不 SHALL 将相关 payment intent 标记为 `confirmed`
- **AND** 系统 SHALL 把 operation 转入 RECONCILE 或人工处置 phase，并保存可诊断的不匹配类型和已观察到的公开链上定位
- **AND** 系统 SHALL 在任何重新提交前查询 settlementKey/requestKey、result summary 和 indexed event，避免因本地对账失败造成重复支付

#### Scenario: 广播后未保存 txHash 即崩溃
- **GIVEN** settler 已广播 signed batch，但 worker 在持久化 txHash 或确认结果前崩溃
- **WHEN** lease 到期后补偿 worker claim 同一 operationKey
- **THEN** 补偿 worker SHALL 使用冻结 settlementKey、escrowAddress 和部署区块范围扫描批次 indexed event，并读取 settlement result summary
- **AND** 若找到匹配摘要和事件，补偿 worker SHALL 定位原交易、校验全部逐项事件和 USDC Transfer 后恢复 DB confirmed 状态
- **AND** 若未找到事件，补偿 worker SHALL 查询 settlementKey/requestKey 与已知或可推导 txHash 状态，并只有在证明批次未执行后才允许重广播同一 signed snapshot
- **AND** 补偿 worker 不 SHALL 创建新的 settlementKey、重新选择 intents 或再次支付已处理 requestKey
