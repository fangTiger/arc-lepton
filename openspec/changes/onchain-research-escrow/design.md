## Context

当前 ARC 模式已经具备两层数据库幂等：直接付费 API 按 `address + requestId` claim，research 先写 payment intents，再按 `address + researchId` claim 异步 settlement。链上部分仍是 recorder EOA 发送 `value: 0` calldata，因此只能证明 receipt 上链，不能证明用户预算被托管或 test USDC 支付给数据提供方。

本变更把 research 路径升级为 `3 + R`：一个 `DataSourceRegistry`、一个 `ResearchEscrow` implementation、一个 `ResearchEscrowFactory`，以及每个真实资助 research 一个 clone。直接 `/api/data/*` 继续使用既有 receipt 路径。

真实资金也暴露了当前架构的两个限制：Agent runner、取消和 SSE event bus 只存在进程内；settlement 虽有 retry 函数，却没有持久 outbox 和实际定时 worker。Escrow backend 因此必须同时引入 durable runner lease、operation outbox 和链上恢复，不能仅把 `sendTransaction` 换成 `writeContract`。

当前数据库金额使用 8 位小数，Arc Testnet USDC 使用 6 位原子单位。真实转账必须精确转换，禁止截断或四舍五入。

## Goals / Non-Goals

**Goals:**

- 为每个 ARC research 创建隔离的 Escrow，并让 buyer 明确授权 Agent 在固定预算、数据源边界和有效期内支付。
- 使用独立 funding signer、intent signer 和 settler，避免任一运行密钥单独伪造资金操作。
- 让 settlement 执行真实 test USDC 转账，并以 Registry revision、签名、链上 key、事件和余额差共同对账。
- 通过 durable runner lease 与 operation outbox 确保 serverless 崩溃后不会重复执行工具、重复支付或遗忘退款。
- 通过 deployer → Factory/implementation/Registry → clone 形成可复现的 `3 + R` 谱系。
- 为未激活退款、正常完成、取消、到期和 excess recovery 提供不会被管理员永久阻断的退出路径。

**Non-Goals:**

- 不把直接 `/api/data/*` 改造成真实 USDC 支付；该路径继续使用现有 receipt 语义。
- 不实现 mainnet 托管、争议仲裁、收益、跨链 Escrow 或完整 x402 协议。
- 不引入 Transparent/UUPS/Beacon 可升级代理或 `ProxyAdmin`；V2 通过新 implementation/Factory 地址发布。
- 不在链上保存原始 researchId、requestId、topic、报告、JSON payload 或数据响应。
- 不部署空壳 `Deployer.sol`，也不把官方 USDC、Safe 或公共基础设施计为项目合约。

## Decisions

### Decision 1: 采用 Registry + fixed implementation + Factory + per-research clone

核心部署为：

1. `DataSourceRegistry`：固定官方 USDC、登记版本化 source 支付边界；部署后一次性绑定项目 Factory，随后不可更换。
2. `ResearchEscrow` implementation：实现资助、激活、结算、防重、关闭和退款；constructor 锁定 initializer。
3. `ResearchEscrowFactory`：固定 implementation、Registry 和 USDC，验证 funding voucher 并创建 clone。
4. `ResearchEscrow` clone：每个非零资助 research 一个，实例数为 `R`。

Factory 使用 EIP-1167 + CREATE2，精确 salt 公式为 `salt = keccak256(abi.encode(buyer, researchKey))`，状态索引为 `escrowOf[buyer][researchKey]`，查询接口为 `escrowOf(buyer, researchKey)`。`createAndFund` 仅在 Registry 已反向绑定且 initialDeployer 在 Factory/Registry 全部撤权后开放，并必须验证服务端 funding signer 对 buyer、researchKey、budgetUnits、expectedExpiresAt、fundingDeadline、intentSigner 和 voucherNonce 的 EIP-712 签名，因此其他地址无法通过 mempool 抢占真实 buyer 的实例；clone 初始化的 `expiresAt` 必须精确等于 voucher 的 `expectedExpiresAt`。

Factory 创建成功时必须发出可重建 child lineage 与资金事实的事件：`ResearchEscrowCreated(address indexed buyer, bytes32 indexed researchKey, address indexed escrow, address implementation)` 和 `ResearchEscrowFunded(address indexed buyer, bytes32 indexed researchKey, address indexed escrow, uint256 budgetUnits, uint64 expectedExpiresAt, uint64 activationCutoff)`。Clone 必须暴露只读恢复接口 `factory()`、`registry()`、`usdc()`、`buyer()`、`researchKey()`、`initialBudget()`、`expectedExpiresAt()`、`activationCutoff()`、`plannedIntentSigner()`、`activeIntentSigner()`、`spent()`、`accountedBalance()`、`activationNonceUsed(uint256)`、`processedRequestKey(bytes32)`、`processedSettlementKey(bytes32)` 与 `state()`；`createAndFund` 成功后的状态必须为 `EscrowState.Funded`。

选择 clone 而不是共享单例，是为了资金隔离、退款边界和 Factory child lineage。只有成功非零资助的 clone 才计入 `R`；部署报告另外列出完成过真实 settlement 的 clone 数量，禁止用空实例膨胀计数。

### Decision 2: 固定 key/hash 规范与 EIP-712 域

所有字符串 ID 由服务端生成并保存为小写、带连字符的 canonical UUID；source name 只允许小写 ASCII `[a-z0-9-]+`。所有 Solidity/TypeScript 编码使用 `abi.encode`/viem `encodeAbiParameters`，禁止 `abi.encodePacked`。域常量为对应 ASCII 字符串的 `keccak256(bytes(...))`：

- `RESEARCH_DOMAIN = keccak256("arc-lepton.research-key.v1")`
- `REQUEST_DOMAIN = keccak256("arc-lepton.request-key.v1")`
- `SETTLEMENT_DOMAIN = keccak256("arc-lepton.settlement-key.v1")`
- `SOURCE_DOMAIN = keccak256("arc-lepton.source-id.v1")`
- `ITEMS_DOMAIN = keccak256("arc-lepton.items-hash.v1")`
- `SETTLEMENT_RESULT_DOMAIN = keccak256("arc-lepton.settlement-result.v1")`
- `FINAL_LIABILITY_DOMAIN = keccak256("arc-lepton.final-liability.v1")`

公式为：

- `researchKey = keccak256(abi.encode(RESEARCH_DOMAIN, uint256(chainId), buyer, keccak256(bytes(canonicalResearchId))))`，ABI 类型为 `(bytes32,uint256,address,bytes32)`
- `requestKey = keccak256(abi.encode(REQUEST_DOMAIN, researchKey, keccak256(bytes(canonicalPaymentIntentId))))`，ABI 类型为 `(bytes32,bytes32,bytes32)`
- `settlementKey = keccak256(abi.encode(SETTLEMENT_DOMAIN, researchKey, keccak256(bytes(canonicalSettlementId))))`，ABI 类型为 `(bytes32,bytes32,bytes32)`
- `sourceId = keccak256(abi.encode(SOURCE_DOMAIN, keccak256(bytes(canonicalSourceName))))`，ABI 类型为 `(bytes32,bytes32)`
- items 按 requestKey 无符号升序排列；item tuple 的字段与 ABI 类型固定为 `(bytes32 requestKey, bytes32 sourceId, uint64 registryRevision, address expectedPayout, uint256 maxUnitPrice, uint256 amount)`；`itemsHash = keccak256(abi.encode(bytes32 ITEMS_DOMAIN, uint256(1), SettlementItem[] items))`
- `settlementResultDigest = keccak256(abi.encode(SETTLEMENT_RESULT_DOMAIN, settlementKey, itemsHash, total, itemCount))`，ABI 类型为 `(bytes32,bytes32,bytes32,uint256,uint32)`
- final liabilities 按 requestKey 无符号升序，tuple 固定为 `(bytes32 requestKey, uint256 amount, uint8 terminalState, bytes32 settlementKey, bytes32 terminalEvidenceHash)`；`finalLiabilityHash = keccak256(abi.encode(FINAL_LIABILITY_DOMAIN, uint256(1), LiabilityItem[] liabilities))`

Liability terminalState 固定为 `1=PAID`、`2=VOID_BEFORE_SIDE_EFFECT`、`3=UNPAYABLE_MANUAL`。每个持久 payment intent 必须恰好出现一次：PAID 要求非零 settlementKey、terminalEvidenceHash 等于对应 settlementResultDigest、requestKey 链上已处理，且全部 PAID amount 之和精确等于 Escrow spent；VOID 要求工具副作用从未发生、settlementKey 为零并以 durable checkpoint digest 为证；UNPAYABLE_MANUAL 只允许 finalizationState=manual 经受保护审批后使用，并绑定失败/人工决定 evidence digest。任何未知状态、零/重复 requestKey 或遗漏 intent 都不得签 close。

规范测试向量使用 chainId `5042002`、buyer `0x1111111111111111111111111111111111111111`、canonicalResearchId `00000000-0000-4000-8000-000000000001`、canonicalPaymentIntentId `00000000-0000-4000-8000-000000000002`、canonicalSettlementId `00000000-0000-4000-8000-000000000003`、source `whale-flow`、payout `0x2222222222222222222222222222222222222222`、revision `1`、max `1000`、amount `100`，结果：

- researchKey `0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464`
- requestKey `0xbb469196cc6b5028360740da10f0e57e763db8971c37fe1a04515283233e32ab`
- settlementKey `0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7`
- sourceId `0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1`
- itemsHash `0x97180eb3603765a7d6b345f882b2e54df6caa90acf6f2a372b7b2197fbd707ea`
- settlementResultDigest `0xb1518f344eeee729e760f0c0d2be569b83fa550833b2309d8e6b7e2cb037b6c4`
- 空 liabilities 的 finalLiabilityHash `0xa700e53730858c2f4b9b5e2287eb6277837358afa904bd8288dccd07809876e4`
- 仅含上述 PAID item 的 finalLiabilityHash `0x338ee25354eba1e0ea3d435dce293825bc9f8143a25d97c1ecfeb5eb29ad3f2e`

Factory EIP-712 domain 固定 name `ArcLeptonResearchEscrowFactory`、version `1`；每个 clone 的 domain 固定 name `ArcLeptonResearchEscrow`、version `1`，并使用实际 chainId 与 verifyingContract。四类授权的 canonical type string 固定为：

- `FundingVoucher(address buyer,bytes32 researchKey,uint256 budgetUnits,uint64 expectedExpiresAt,uint64 fundingDeadline,address intentSigner,uint256 voucherNonce)`
- `ActivationAuthorization(address escrow,bytes32 researchKey,address buyer,address intentSigner,uint256 initialBudget,uint64 expectedExpiresAt,uint256 activationNonce,uint64 deadline)`
- `SettlementAuthorization(address escrow,bytes32 researchKey,bytes32 settlementKey,bytes32 itemsHash,uint256 total,uint32 itemCount,uint256 nonce,uint64 issuedAt,uint64 deadline)`
- `CloseAuthorization(address escrow,bytes32 researchKey,uint8 closeReason,bytes32 finalLiabilityHash,uint256 spent,uint256 nonce,uint64 issuedAt,uint64 deadline)`

实现 SHALL 使用标准 EIP-712 `hashTypedDataV4`，不得额外拼接或省略字段；`closeReason` 数值映射固定为 `1=completed`、`2=cancelled`、`3=failed`。上述 type hash、domain separator、struct hash 与最终 digest 必须作为 Solidity 常量/ABI 文档和共享测试向量固化。FundingVoucher signer 与 buyer ActivationAuthorization SHALL 使用 SignatureChecker 接受规范 ECDSA/ERC-1271；V1 intent signer 为降低隐藏共同控制风险，MUST 是 `code.length == 0` 的 allowlisted EOA，Settlement/Close 只接受 strict ECDSA，并拒绝 malleable 或非 canonical 签名。未来支持 ERC-1271 intent signer 必须作为新 spec，加入 owner/threshold/module 控制图证明。

EIP-712 digest 测试向量沿用上述 chainId/buyer/researchKey/settlementKey/itemsHash，并使用 Factory `0x3333333333333333333333333333333333333333`、Escrow `0x4444444444444444444444444444444444444444`、intentSigner `0x5555555555555555555555555555555555555555`、budget/initialBudget `1000000`、expectedExpiresAt `2000000000`、fundingDeadline/activationCutoff `1999996400`、activation deadline `1999996300`、settlement/close deadline `1999999000`、settlement/close issuedAt `1999998700`、voucher/activation/settlement/close nonce `7/8/9/10`、settlement total `100`、itemCount `1`、closeReason `1`、上述单 PAID item finalLiabilityHash、spent `100`。最终 digest 必须分别为：

- FundingVoucher `0x8faa9182addb6d5d08af23306436f3306498c84252c9ed09d88f3c6fd8eff95b`
- ActivationAuthorization `0xbc1cbf4093c2e740f17393d450269fed5983c790354666867f34bd8a4949e6d7`
- SettlementAuthorization `0xb3b9a8aa53892c97a11bea76829a29d72741f75bc6e0046ae69c0fcdeb3712b2`
- CloseAuthorization `0x00b2124a61089fcd6b75eadd2b33a5c8876165709f25ccba22a38a213f5139ba`

### Decision 3: prepare 预留 quota，并签发不可篡改 funding voucher

ARC 流程为 `prepare → approve/createAndFund → buyer activation signature → start`：

1. prepare 接收稳定 `Idempotency-Key`，原子创建 `funding` research、预留 wallet/global quota，并保存 `prepareRequestId`、buyer、researchKey、budgetUnits、expectedExpiresAt、fundingDeadline 和 intentSigner。reservation 合法边固定为 `reserved→released`（从未进入激活）或 `reserved→activating→consumed|released`，终态不可再次转换；所有转换与 research/outbox 使用同一 Postgres 事务和条件更新。
2. prepare 生成 FundingVoucher，由独立 funding signer 签名。voucher 绑定全部上述字段和 nonce；Factory 只接受 `msg.sender == buyer`、未过 fundingDeadline 且签名有效的 voucher。
3. buyer approve 后调用 `createAndFund(voucher, signature)`；Factory 原子创建 clone 并精确转入全部 budget，状态为 `Funded`，不允许部分、超额或 top-up。
4. buyer 在 start 时签署 ActivationAuthorization，明确把本 Escrow 预算委托给 voucher 中不可变的 intentSigner；签名 deadline 不得晚于 fundingDeadline，start 还必须留出配置的最小 activation 提交窗口。服务端先在持久事务把 reservation 从 reserved 改为 activating、保存授权摘要/受保护 payload并写入唯一 ACTIVATE outbox，再由持有 lease 的 worker（请求线程可作为同一 worker 等待）提交 `activate`。receipt 完整对账后，系统在同一数据库事务中把 reservation 精确改为 consumed、把 research 转为 running 并写入 durable RUN outbox；请求若在确认前超时返回独立 `activationPhase=activating`，research status 仍为 funding，重试只查询/推进同一 operation。

时间常量首版固定：funding window 15 分钟、`MIN_ACTIVATION_SUBMISSION_WINDOW` 2 分钟、Factory `MIN_ESCROW_TTL` 2 小时、默认 Escrow TTL 24 小时、start 最小剩余 TTL 60 分钟、`MIN_SETTLEMENT_SAFETY_WINDOW` 15 分钟、settlement/close `MAX_AUTHORIZATION_LIFETIME` 5 分钟。expectedExpiresAt 由 prepare 生成并持久化；Factory 和 start 都要求链上值完全相等。clone 把 voucher fundingDeadline 固化为 `activationCutoff`，activate 同时要求 `block.timestamp <= authorization.deadline <= activationCutoff`；voucher 在 cutoff 后不能创建，start 剩余 activation window 少于 2 分钟时拒绝。每次创建 intent 要求距离 expectedExpiresAt 至少 15 分钟，Settlement/Close authorization deadline 不得超过 `min(signingTime+5m, expectedExpiresAt)`。

到达 fundingDeadline 时，expiry/cancel worker 必须先 claim 并 reconcile 任何 ACTIVATE operation；reservation=activating 或广播结果不确定时绝不能先释放。若链上已 Active且没有取消请求，系统 consume reservation 并恢复唯一 RUN；若 Active但 cancelRequestedAt 已持久化，则 consume reservation、不创建 RUN，直接进入 cancelled/closing 并签名关闭退款。只有证明未 Active且不存在可在 deadline 后生效的授权时，系统才保留 `funding_expired` 终态并把 reservation 精确改为 released。若已经 Funded 但尚未 Active，buyer 可立即 `cancelUnactivated` 取回全部余额。start 重试对 running/completed 返回既有结果且不得再次创建 runner。

mock 模式保持当前单步 start 和 memory fallback，不使用 voucher 或 Escrow。

### Decision 4: Registry 使用不可复用 revision，item 原子绑定配置

每个 source 保存单调递增 `revision`、payout、`maxUnitPrice` 和 active。Registry 初始 admin 在 Factory 部署后调用一次性 `bindFactory(factory)`；调用要求 factory 有 code、`Factory.registry()==address(this)` 且 `Factory.usdc()==registry.usdc()`，绑定后地址永久不可更换。在绑定成功前，source 写入和除初始移交所需外的敏感角色 grant 均禁用。这样 Registry 能在 source 配置和角色 grant 时查询 Factory 敏感角色，Factory 也能查询 Registry 角色，跨合约互斥可链上实现。

每次 source 更新必须 revision + 1 并发事件，旧 sourceId/revision 不删除。payment intent 在工具执行前保存 expected revision、payout、maxUnitPrice 和读取区块。

每个 settlement item 把 `registryRevision`、`expectedPayout`、`maxUnitPrice` 纳入 itemsHash 和 intent signer 签名。Escrow 在同一交易中读取 Registry 并要求 revision/payout/max/active 全部匹配，再支付 `0 < amount <= maxUnitPrice`。这样 Registry 变更不会在 worker 预读与交易执行之间重定向 pending payment；不匹配时 fail closed 并进入人工/补偿流程。

Registry 在配置写入时拒绝 payout 为零地址、Factory、Registry、USDC 或其他显式协议地址；Escrow 在每次 settlement 时进一步拒绝该实例的 buyer、Escrow 自身，以及 Factory/Registry 当前任一 DEFAULT_ADMIN、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER 成员。所有 source payout（不只 smoke）必须与 deployer、governance 和运行敏感身份分离。

### Decision 5: Funded → Active 需要 buyer 签名，settlement 需要独立 intent signer 签名

Escrow 状态为 `Funded`、`Active`、`Closed`。createAndFund 后不能 settlement；buyer 可在 Funded 阶段无条件退款。ActivationAuthorization 包含 escrow、researchKey、buyer、intentSigner、initialBudget、expectedExpiresAt、activationNonce 和 deadline，并由 buyer 签名。start 还要求 `spent == 0`、没有已处理 key、accounted balance 等于 initialBudget。

clone 初始化时保存 FundingVoucher 中的 planned intent signer；activate 的 Authorization 必须使用同一 signer，不能在 buyer 激活阶段替换为另一个 allowlisted signer。`settleBatch(settlementKey, items, itemsHash, total, authorization)` 需要两层授权：调用方是 Factory 当前 settler，且 SettlementAuthorization 由该 Escrow 激活时固化的 intentSigner 签名。签名包含 escrow、researchKey、settlementKey、itemsHash、total、itemCount、nonce、issuedAt 和 deadline。settler 只能提交已签名批次，不能自行伪造 payment intents；intent signer 不能直接广播或关闭 Escrow。每次 settlement/签名 close 都动态要求 `intentSigner != msg.sender`、intentSigner 仍持有 Factory INTENT_SIGNER_ROLE，且不持有 Factory/Registry 的 settler、funding、source 或 admin role；后续错误 grant 只会 fail closed，不能把双钥退化成单钥。

合约验证 key 非零、items 非空且不超过 MAX_BATCH_SIZE、items 已排序且无重复、计算 total 与参数相等、`spent + total <= initialBudget`、Registry revision/config 一致。每个付款前后读取 Escrow 与 payout 的 USDC balance，要求 Escrow 精确减少 amount、payout 精确增加 amount；self-transfer 和 fee-on-transfer 行为使全批回滚。

链上为每个 settlementKey 保存 `itemsHash + total + itemCount` 结果摘要，并为每个 requestKey 保存处理状态。批次事件将 escrow、settlementKey indexed，逐项事件将 requestKey indexed；worker 可从 Factory 部署区块开始扫描并恢复广播后 DB 崩溃的结果。

### Decision 6: durable runner lease 与 workflow outbox 是 Escrow backend 的硬依赖

新增持久 `workflow_outbox`（或等价表），operation type 至少包含 ACTIVATE、RUN、SETTLE、RECONCILE、CLOSE。记录 operationKey、research/escrow、phase、payload hash、txHash、lease owner/expiry、单调 fencing token、attempts、nextAttemptAt、lastError 和链上定位；唯一约束保证同一 operationKey 只有一个逻辑操作，所有 checkpoint/intent/phase 写入条件校验当前 fence。广播所需但尚未上链的可重放授权只保存在受保护数据库字段/secret envelope 中，公开 event、日志和 outbox 诊断字段只保存 digest。

prepare/start/cancel/research 终态和 outbox 写入使用同一数据库事务。受保护的 Cron/queue worker 按 lease claim 执行；进程内触发只作降延迟优化，不能作为唯一调度。no-intent research 也必须创建 CLOSE operation。worker 覆盖 activation/settlement/close 的广播前、广播后未保存 txHash、receipt 后未写 DB和下一阶段入队前崩溃的恢复。

Agent runner 同样使用 DB lease；SSE 不再自行启动第二个 runner。每个付费工具步骤先持久化稳定 paymentIntentId/toolOrdinal，再产生 requestKey 和副作用，禁止直接使用临时 LLM call.id。取消 API 持久化 `cancelRequestedAt` 并写 finalization outbox；runner 在每次 LLM、工具和 intent 前读取 durable cancellation。若 lease 在首个付费 intent 后丢失，V1 不自动重跑 Agent，而是安全标记失败、结算既有 intents 并关闭退款；用户另建 research 重试。

SSE event 需要持久 event/checkpoint 或可由 research/tx_log 重建；globalThis event bus 仅作为同实例实时优化。

Escrow backend 在无持久 Postgres、无 worker 鉴权配置或 schema 未迁移时返回 `503 DURABLE_DB_REQUIRED`，绝不使用 production memory fallback。签名 research token fallback 仅保留 mock 路径。

### Decision 7: 关闭使用数据库屏障与 intent-signed CloseAuthorization

持久状态词汇固定如下，API 不得用同一 `status` 字段表达多套状态机：

| 维度 | 值 | 转换含义 |
| --- | --- | --- |
| research status | `funding → running → completed|failed|cancelled`，或 `funding → funding_expired|cancelled` | 面向用户的研究生命周期；报告完成后立即进入终态，不等待资金关闭 |
| activationPhase | `none → funded → activating → active`；`none|funded|activating → expired|cancelled` | 资助/激活进度；start 超时时 API 返回 `status=funding, activationPhase=activating` |
| Escrow state | `Funded → Active → Closed`，或 `Funded → Closed` | 链上不可逆状态 |
| finalizationState | `none → open → closing → closed`，或 Funded 退款对账后 `none → closed`；自动恢复耗尽时 `closing → manual → closing|closed` | 资金终态化；manual 只表示需要人工诊断，不改变链上事实 |
| quota reservation | `reserved → released`，或 `reserved → activating → consumed|released` | 只能恰好消费或释放一次 |

未激活分支的四元组固定为：无 clone 过期=`funding_expired/expired/none/released`；无 clone 主动取消=`cancelled/cancelled/none/released`；Funded 过期待 buyer 退款=`funding_expired/expired/none/released`；Funded 的 cancelUnactivated receipt 对账后=`cancelled/cancelled/closed/released`（若此前已 funding_expired则保留 status=funding_expired）；ACTIVATE 后才观察到取消=`cancelled/active/closing→closed/consumed`。Active 正常启动=`running/active/open/consumed`。operation 达到重试上限、链上/DB 证据冲突或签名/Registry mismatch 无法自动判定时变为 manual。只有受保护的人工恢复动作在记录操作者、原因和 evidence digest 后才能 requeue 为 closing；只有公开证据已证明 Escrow Closed 才能直接 reconcile 为 closed。

完成、失败或取消时，数据库保留面向用户的 research status（`completed`/`failed`/`cancelled`），并在同一事务把独立 `finalizationState` 从 `open` 原子切为 `closing`、阻止新 intent、写 SETTLE/CLOSE outbox。待所有已存在 intents 终态后，intent signer 对 closeReason、finalLiabilityHash、spent、nonce、issuedAt 和 deadline 签署 CloseAuthorization，settler 才能调用 close；成功后 `finalizationState=closed`。这样报告可以先终态化，settler 不能单独提前关闭，intent 创建也不能与关闭穿透竞态。

creation/activation pause 只阻止新风险，不阻止 Active Escrow 的已签名 settlement、正常 close、Funded 取消或到期退款。治理方如需阻止泄漏的 settler，撤销 settler role；intent signer 签名仍是第二道边界。

到达 expiresAt 后任何账户可触发退款，但资金只发送给 buyer。start 的 60 分钟剩余 TTL 门禁和 24 小时默认期为 worker 留出窗口；若系统仍错过期限，buyer 退出优先，provider 未付款被记录为严重运营失败。

直接转入的 excess 不扩大预算。合约内部 `accountedBalance = initialBudget - spent`，只要未关闭就要求实际余额不小于 accountedBalance，并把 `actualBalance - accountedBalance` 只读分类为 excess；任何结算上限都只使用 accountedBalance。close 时分别记录 `budgetRefund=initialBudget-spent` 与 `excessRefund=actualBalance-budgetRefund` 并把当前余额全部退 buyer。Closed 后再次被强制转入 USDC 时，任何账户可调用 `recoverExcess()`，但接收方固定为 buyer；“余额为零”只要求在 close/recover 交易完成时成立，而不是永久不变量。

### Decision 8: 角色矩阵与完整成员证明

| 合约/身份 | 权限 | 约束 |
| --- | --- | --- |
| deployment key | 部署和初始 grant | 完成后不持有任何 admin/runtime role |
| Factory DEFAULT_ADMIN | 管理 creation pause、funding signer、intent signer allowlist、settler | 项目 governance Safe |
| FUNDING_SIGNER_ROLE | 签 FundingVoucher | 独立服务地址，不是 settler/intent signer/admin |
| INTENT_SIGNER_ROLE | 为单个 Escrow 签 settlement/close | V1 为 allowlisted EOA；激活时固化，不可替换，运行时仍要求 role 有效且与其他敏感角色不重叠 |
| SETTLER_ROLE | 提交 activate/settlement/close | 不能生成 funding/intent/close 签名 |
| Registry DEFAULT_ADMIN | 管理 SOURCE_ADMIN | 与 Factory governance 分离的 Registry Safe |
| SOURCE_ADMIN_ROLE | 更新 versioned source | 不持有 Factory admin、funding、intent、settler role |
| buyer | 资助、签激活、Funded 取消、到期/Closed excess 受益人 | 不能管理 source 或 runtime role |

Factory/Registry 使用 AccessControlEnumerable，或部署验证器从 genesis deployment block 完整重放 RoleGranted/RoleRevoked；必须证明敏感角色的完整成员集合、role-admin 图和成员数量，而不只是抽查声明地址。唯一 bootstrap 例外是 deployment key 可由两个 constructor 临时获得 DEFAULT_ADMIN；此阶段禁止对外 funding，发布前必须移交并全部撤销。此后 Factory/Registry 的 grant 路径必须拒绝同一地址同时拥有 DEFAULT_ADMIN、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER 或 SETTLER 中两个敏感角色；createAndFund/activate 还拒绝零 intentSigner、buyer 与任一项目敏感角色重叠，以及 intentSigner 与 buyer/funding signer/协议地址重叠。

### Decision 9: 6 位 USDC units 与可复核 token 身份

链上应用金额全部使用 `uint256` 六位 ERC-20 USDC units。scale-8 数据只有在能被 100 整除时才能转换；否则 prepare/settlement fail closed。数据库保留展示值并同时保存链上 units。Arc 原生余额/gas 使用 18 位且与六位 ERC-20 接口共享底层余额，因此换算常量固定为 `NATIVE_PER_ERC20_UNIT = 10^12`，任何跨接口比较必须先做整数精确换算，不得截断。

Arc Testnet 5042002 verifier 内置 Circle 官方公布的 USDC 地址 `0x3600000000000000000000000000000000000000`，权威来源为 [Circle USDC Contract Addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)，且来源独立于待验证 manifest；同时验证该地址 code、decimals、指定复核区块 runtime hash，以及如适用的 proxy implementation。manifest 只能引用该权威值，不能自行声明任意六位 token 为官方 USDC。

### Decision 10: 独立 rollout flag 与零停机迁移

新增 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata|escrow`，与 `ARC_RECEIPT_MODE` 分离；另有 funding UI enable flag。direct API 在 mock/arc 下均保持既有行为并有专项回归测试。

数据库采用 expand/backfill/switch/contract：先增加 nullable `createdAt/preparedAt/fundingExpiresAt/startedAt`、Escrow/key/snapshot/outbox/lease 字段与索引，回填旧 research，再双读写，部署 worker，最后开启 escrow backend；列表排序改用稳定 createdAt，不依赖 nullable startedAt。现有 KV daily quota 迁移为 Postgres 权威 bucket：先 shadow dual-write/read-compare，在明确的下一 UTC bucket 边界完成滚动实例排空与原子 switch，禁止 KV/Postgres 各自独立计数；Escrow funding 在 Postgres quota 与 reconciliation 健康前保持关闭。V1 不急于收紧旧行约束。

### Decision 11: 部署证据是发布门禁

Foundry 固定 compiler、OpenZeppelin、optimizer 和 EVM。最终 manifest 只允许从 clean Git commit 的可复现 artifact 生成，记录 chainId、commit、compiler、deployer、完整角色、USDC、三个核心地址、tx/block、构造参数和 bytecode hash。

发布前验证 code/hash、clone implementation、Factory/Registry wiring、initializer 锁、完整 role membership、deployer 撤权和权威 USDC。smoke 执行 `approve → createAndFund(Funded) → buyer activate → signed settleBatch → signed close/refund`，并核对付款双方余额差。[Arc 官方文档](https://docs.arc.io/arc/concepts/stablecoin-native-model)规定原生 gas 用 18 位、ERC-20 接口用 6 位且共享余额；smoke 固定 direct EOA buyer、`tx.from == buyer`、buyer 为实际 gas payer、无 AA/paymaster/sponsorship。createAndFund 必须同时证明 Factory 调用内部的 buyer/clone `balanceOf` 差额精确等于 budgetUnits，以及交易前后原生余额满足 `nativeBefore18 - nativeAfter18 - gasUsed*effectiveGasPrice == budgetUnits6 * 10^12`。验证器使用同一 finalized block 的可复核 state diff，或 block N-1/N 加整块交易/system event 扫描证明无其他 buyer 余额变化；settlement/close 的 Escrow 不是 gas payer，其六位收付款差额必须直接精确相等。[USDC system events](https://docs.arc.io/arc/references/usdc-system-events) 固定 native emitter 为 `0xfffffffffffffffffffffffffffffffffffffffe`（18 位）、ERC-20 emitter 为官方 USDC（6 位）；verifier 必须按 emitter 区分并以 `amount6*10^12=amount18` 交叉核对，不能双计。gas 不产生 Transfer，必须只由 receipt 的 `gasUsed*effectiveGasPrice` 计算。payout 必须与 buyer/deployer/admin/signers/settler/协议地址全部不同。

## Risks / Trade-offs

- [用户需要 approve、funding tx 和激活签名] → allowance 足够时只有一笔交易；签名不花 gas，UI 可恢复每个阶段。
- [三个运行签名身份增加运维复杂度] → funding signer、intent signer、settler 各自最小权限；密钥轮换和 incident runbook 纳入发布门禁。
- [Registry 更新阻断 pending intents] → revision 原子校验避免错付；失败进入人工恢复，绝不静默重定向。
- [每个 research 部署 clone 增加 gas/状态] → EIP-1167，只为真实非零资助创建，并单列 funded/settled 实例数量。
- [durable worker 增加数据库与 Cron 依赖] → Escrow backend 无依赖时 fail closed；mock 仍可本地运行。
- [默认 24 小时锁定期影响 buyer] → Funded 可立即取消；Active 有 60 分钟启动余量、durable close worker 和最终到期退出。
- [intent signer 泄漏可签伪造批次] → V1 EOA allowlist、与 settler/全部敏感角色链上动态互斥、Escrow/预算/Registry/revision/expiry 限制、撤销 role 后停止执行；只有 intent signer 与独立 settler 同时失陷才可在边界内支付。
- [到期仍可能让 provider 未付款] → buyer 退出优先；监控 outbox SLA，临近期限停止新工具并升级人工处理。
- [链上成功但 DB 失败] → 结果摘要、indexed events、operationKey 和扫描恢复防止重复支付。
- [旧 receipt 与 Escrow 并存] → 独立 backend/version 字段和 rollout flag，UI 明确区分。

## Migration Plan

1. 先完成合约和共享 hash/signature RED 测试，再实现 Registry、Factory、Escrow。
2. 按 expand/backfill/switch/contract 增加 research、intent、event、runner lease 和 workflow_outbox 数据结构；生产 Escrow 路径在 DB/worker 就绪前 fail closed。
3. 实现 prepare quota reservation、funding voucher、buyer 激活签名和 durable RUN worker；验证多实例不会重复运行。
4. 实现 versioned Registry snapshot、intent signer 批次签名、Escrow settlement、链上恢复和 closing barrier。
5. 本地 Anvil 完成角色、崩溃点、取消竞态、expiry、fee/self-transfer、excess 和端到端测试。
6. 经再次授权后在 Arc Testnet 部署三个核心合约，验证源码、角色、manifest 和独立 payout smoke。
7. 先启用 funding UI，再小范围切换 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow`；监控 runner/outbox/settlement/close SLA 后扩大。

回滚时停止新 voucher/激活并把新 research 切回 mock/legacy；已 Funded 用户可取消，已 Active 实例必须继续由 durable worker 结算/关闭或等待到期退款。部署和 manifest 永不删除，V2 使用新地址。

## Open Questions

- Factory governance Safe、Registry Safe、funding signer、intent signer、settler 和备用地址分别使用哪些真实地址？
- 五个数据源的独立测试 payout 与 maxUnitPrice 如何分配？
- direct `/api/data/*` 后续接入 Circle Gateway/x402，还是另建用户签名 direct-payment 路径？
