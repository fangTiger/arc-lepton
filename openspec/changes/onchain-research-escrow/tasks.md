## 1. 合约工程、依赖与发布基线

- [x] 1.1 创建 `contracts/` Foundry 工程，固定 Solidity、EVM、optimizer、remapping、OpenZeppelin Contracts 与 Foundry 版本
- [x] 1.2 在根工程和 CI 增加 contract fmt/build/unit/fuzz/invariant/coverage、Slither 与 artifact 一致性命令，不改变既有 Next.js 命令语义
- [x] 1.3 创建 6 位 MockUSDC、返回 false/revert token、fee-on-transfer token、重入 token 和 buyer/admin/signer/settler/payout 隔离 fixtures
- [x] 1.4 先写部署配置 RED 测试，覆盖错误 chainId、零地址、无 code、错误 decimals、可升级 implementation 和不受支持 token
- [x] 1.5 增加 clean Git commit 与可复现 artifact hash 门禁；dirty worktree 构建只能生成临时产物，不能发布最终 manifest

## 2. Canonical key、EIP-712 与金额 TDD

- [x] 2.1 为 design 中 research/request/settlement/source/items、settlementResultDigest、空/单 PAID finalLiabilityHash 写 Solidity、TypeScript 和独立 verifier 共享 RED 测试向量
- [x] 2.2 实现仅使用 `abi.encode`/`encodeAbiParameters` 的全部 canonical 编码器，固定 liability terminalState/排序/证据/spent 关系，并拒绝非 canonical ID/source、零/遗漏/重复 key、未排序 item/liability
- [x] 2.3 为 FundingVoucher、ActivationAuthorization、SettlementAuthorization、CloseAuthorization 的 domain/type/struct/digest 写跨语言共享 RED 测试
- [x] 2.4 实现 EIP-712 编码：funding/buyer 支持 ECDSA/ERC-1271，V1 intent signer 仅 allowlisted EOA strict ECDSA；覆盖错误 domain、过期、nonce、防 malleability，以及拒绝 ERC-1271 intent signer/隐藏共同控制
- [x] 2.5 为 scale-8↔六位 ERC-20 units 与六位↔18 位 Arc native units (`*10^12`) 写 RED 测试，覆盖精度、零/溢出、边界和禁止截断/混比
- [x] 2.6 实现金额转换工具；Escrow 路径禁止 float、截断或四舍五入，同时保持 mock/direct 路径兼容

## 3. DataSourceRegistry TDD

- [x] 3.1 先写 Registry RED 测试，覆盖 constructor 固定官方 USDC、一次性 bindFactory 的 code/双向 wiring、绑定前禁写、重复/错误绑定拒绝，以及 source revision/config/事件
- [x] 3.2 增加零 sourceId/payout/max、重复新建、revision 溢出、越权、停用和 sourceId 不可删除复用的 RED 测试
- [x] 3.3 实现一次性 Factory 绑定、版本化 `DataSourceRegistry`、跨 Factory 角色检查、自定义错误、只读接口与 AccessControlEnumerable，使 3.1–3.2 通过
- [x] 3.4 增加 payout 为 Registry/Factory/USDC/已知协议地址时的拒绝测试和配置校验

## 4. Factory、FundingVoucher 与 Funded 激活 TDD

- [x] 4.1 先写 Factory RED 测试，覆盖 EIP-1167、CREATE2 预测、`(buyer,researchKey)` 映射、跨 buyer 同 key、零 key、固定 implementation/Registry/USDC 和 initializer 锁
- [x] 4.2 先写 FundingVoucher RED 测试，覆盖 Registry反向绑定、initialDeployer未撤权时禁 funding、msg.sender/buyer、FUNDING/INTENT signer角色互斥、deadline/nonce与MIN_ESCROW_TTL
- [x] 4.3 先写 `createAndFund` RED 测试，覆盖单交易创建/初始化/登记/全额 transferFrom/Funded、allowance/余额不足、部分/超额/top-up/重放和全交易回滚
- [x] 4.4 增加 sender 与 clone balance delta 均精确等于 budgetUnits 的测试，覆盖 self-transfer、fee-on-transfer、false/revert token
- [x] 4.5 最小实现锁定 initializer 的 `ResearchEscrow` implementation 与固定依赖、可暂停新创建的 `ResearchEscrowFactory`
- [x] 4.6 实现 voucher 验证、地址预测、`createAndFund` 与完整 lineage/funding 事件，使 4.1–4.4 通过
- [x] 4.7 先写 Funded→Active RED 测试，覆盖 buyer EIP-712/1271、relayer、nonce、防重、`deadline≤activationCutoff`、cutoff 后链上拒绝和 intentSigner 固化
- [x] 4.8 增加激活前 `spent=0`、无 processed key、accounted balance 等于 initialBudget 的测试，以及 Funded 时 settlement/Active close 必须失败的恶意 settler测试
- [x] 4.9 实现 `activate` 和 `cancelUnactivated`；覆盖两者并发只允许先执行者成功，Funded buyer 可立即全额退出，creation/activation pause 不阻断该退出

## 5. 双签名 settlement、关闭与会计安全 TDD

- [x] 5.1 先写有效 `settleBatch` RED 测试，覆盖 SETTLER_ROLE + intent signer 双授权、多 source、计算 total、spent、结果摘要、indexed 批次/逐项事件和全批原子成功
- [x] 5.2 增加空/超大/未排序/重复/零 key、错误 hash/total/nonce、授权 lifetime>5m或 deadline>expiry、角色冲突、非 Active/到期/Closed和预算超限 RED 测试
- [x] 5.3 增加每项 Registry revision/payout/max/active 原子匹配测试，覆盖 worker 预读后链上更新的 TOCTOU 与旧 intent fail-closed
- [x] 5.4 增加 payout 为零、buyer、Escrow、Factory、Registry、USDC 或当前任一 Factory/Registry 敏感角色成员的动态拒绝测试
- [x] 5.5 增加 Escrow balance 精确减少且 payout 精确增加的 RED 测试，覆盖 self-transfer、fee-on-transfer、false/revert token 与恶意重入全批回滚
- [x] 5.6 实现 settlement 授权、Registry 原子校验、MAX_BATCH_SIZE、SafeERC20、CEI/nonReentrant 和精确余额差，使 5.1–5.5 通过
- [x] 5.7 先写 settlementKey/requestKey 双层防重 RED 测试，覆盖批内/跨批重复、失败不消耗 key、结果摘要与只读恢复接口
- [x] 5.8 实现 processed key 与 `settlementKey -> itemsHash/total/itemCount` 摘要，并验证事件索引可从部署区块恢复
- [x] 5.9 先写 CloseAuthorization RED 测试，覆盖 canonical liability、空集合、PAID/VOID/UNPAYABLE_MANUAL、遗漏/重复/未知状态、spent/result、closeReason、nonce/issuedAt/deadline/lifetime 与提前关闭
- [x] 5.10 增加到期任意账户触发但只退 buyer、creation pause 不阻断已有签名 settlement/close/退款、签名失败可重试的测试
- [x] 5.11 增加直接转入 excess、不扩大预算、close 分离 budgetRefund/excessRefund、close 交易余额清零、Closed 后 `recoverExcess()` 只到 buyer 的测试
- [x] 5.12 实现不可逆 Funded/Active/Closed 状态机、closeReason、签名 close、到期退款和 recoverExcess，使 5.9–5.11 通过
- [x] 5.13 编写会计、key、角色、expiry、暂停和恶意 token fuzz/invariant 测试，并在测试保护下整理存储与错误类型

## 6. 角色、暂停与链上可审计性 TDD

- [x] 6.1 先写 Factory/Registry 完整角色 RED 测试，覆盖绑定后的跨合约 role 查询、成员数量/role-admin、两套 governance 分离，以及任意双敏感角色 grant 必须失败
- [x] 6.2 实现 AccessControlEnumerable、最小 creation/activation pause 和运行角色轮换；deployment key 移交后不持有任何 admin/runtime role
- [x] 6.3 验证 governance 不能替换既有 intentSigner；settlement/close 动态拒绝 intentSigner=msg.sender或持有其他敏感角色，单独泄漏任一密钥均不能付款
- [x] 6.4 为 source revision、child lineage、funding、activation、settlement、close/refund/recovery 事件和读接口写完整重建测试
- [x] 6.5 固化 V1 implementation 不可替换约束；升级必须使用新 implementation/Factory/manifest

## 7. 数据库 expand/backfill/switch/contract 与 Repository TDD

- [x] 7.1 为 schema/repo 写 RED 测试，逐项覆盖 design 状态表与五个未激活/Active 四元组，特别是 `reserved→released`、`reserved→activating→consumed|released`、`none→closed` 及全部非法回边
- [x] 7.2 为 payment intent 写 RED 测试，覆盖稳定 paymentIntentId/toolOrdinal/requestKey、sourceId、Registry revision/payout/max/readBlock 快照、amountUnits、payload hash 与 escrow 绑定
- [x] 7.3 为 runner lease、durable event/checkpoint 和 workflow_outbox 写 RED 测试，覆盖唯一 operationKey、ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE、phase、受保护授权 payload/digest、lease/fencing token、attempt、nextAttemptAt、txHash/error/log locator
- [x] 7.4 建立正式 migrator、migration journal、部署命令和单实例 advisory lock，再编写 expand migration：先增加 nullable 字段、唯一约束和索引，不改变旧行可读性或旧服务写入
- [x] 7.5 编写并测试 backfill：补齐 createdAt/backend/version/排序字段，旧 research 不伪造 escrow、签名或资金事实
- [x] 7.6 同步 Postgres 与 memory repo；memory 只服务 mock/test，production escrow 路径不得使用
- [x] 7.7 实现 switch 阶段双读写和显式 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata|escrow`、funding UI flag；待回滚窗口结束后再执行 contract migration
- [x] 7.8 增加 migration upgrade/downgrade dry-run、混合版本服务、列表排序和统计回归测试，确保不依赖 nullable startedAt
- [x] 7.9 实现 KV quota→Postgres shadow dual-write/read-compare，在下一 UTC bucket 边界排空旧 writer并原子 switch；不一致时 funding fail closed，验证 wallet 10/global 100 不漏计或双计

## 8. Prepare、quota、funding 与 start API TDD

- [x] 8.1 先写 prepare API RED 测试，覆盖认证 buyer、稳定 Idempotency-Key、同 scope 重试、跨 buyer/topic/budget 冲突、6 位预算、researchKey、预测地址和不启动 Agent
- [x] 8.2 增加 Postgres 同一 UoW 内 wallet/global UTC bucket + quota reservation、并发 prepare/start-vs-expiry、exactly-once consume/release、15 分钟 fundingDeadline、prepare+24h expectedExpiresAt 与 voucher 字段完全一致的测试；Escrow 路径不得复用 KV 双 `incr`
- [x] 8.3 实现 prepare service/route、唯一约束、quota reservation 和 funding signer；Escrow production 无 Postgres/schema/worker auth 时返回 `503 DURABLE_DB_REQUIRED` 且不签 voucher
- [x] 8.4 先写 reservation=`reserved→activating→consumed|released` 与 funding_expired worker/API RED 测试，覆盖 ACTIVATE 广播跨 fundingDeadline、cancel/expiry/activation 交错、先 reconcile、Active 后 consume+RUN或consume+cancelled/closing、未 Active 才恰好 release 一次
- [x] 8.5 先写 start RED 测试，覆盖 funding receipt/Factory event/clone code、buyer/Factory/researchKey/USDC/Funded、精确 budget/expiry/activationCutoff、剩余 TTL≥60m且 activation window≥2m、spent/key/balance 干净
- [x] 8.6 增加伪造/失败/未确认 tx、错误 event/log、账户或 SIWE buyer 变化、篡改 budget/expiry、临界 TTL、错误 chain/Factory、重复/并发 start 和已取消/过期的失败测试
- [x] 8.7 实现 buyer ActivationAuthorization（deadline≤fundingDeadline、最小提交窗口）的受保护持久化、`reserved→activating` 与唯一 ACTIVATE outbox；持 lease worker 对账后原子 `activating→consumed`、research→running并创建 RUN，请求超时以 activationPhase 返回 activating
- [x] 8.8 实现 start/ACTIVATE 幂等与崩溃恢复：广播前、广播后未存 txHash、receipt 后未写 DB、RUN 入队前均只推进同一 activation；running/任一终态或 finalizationState=closing/closed 重试绝不创建第二 runner
- [x] 8.9 保留 mock 单步 start 与签名 token fallback，仅 mock 可使用 memory；补 start/detail/list/stream/cancel 历史回归测试
- [x] 8.10 更新 `GET /api/quota` schema/repo 测试，返回 consumed/reserved/used/limit/remaining/resetAt/backend，并验证 reservation 每次转换后的强一致查询

## 9. Durable Agent runner、intent 与取消 TDD

- [x] 9.1 先写多实例 runner RED 测试，覆盖 DB lease owner/expiry/heartbeat/attempt/fencing；旧 worker 暂停、lease 被回收再恢复时不得写状态、intent 或执行工具，SSE 不得启动第二 runner
- [x] 9.2 实现 RUN worker 与持久 event/checkpoint，显式测试 eventId 单调、重复写冲突、Last-Event-ID 和 final checkpoint 冷启动恢复；globalThis event bus 仅作为同实例低延迟优化
- [x] 9.3 先写付费工具 RED 测试，要求在副作用前原子持久化稳定 toolOrdinal/paymentIntentId/requestKey 和 Registry snapshot，禁止使用临时 LLM call.id
- [x] 9.4 实现 closing 条件写、intent 唯一约束与预算 reservation，保证并发 runner/重试不能重复工具副作用或突破 initialBudget
- [x] 9.5 先写 durable cancel RED 测试，覆盖 cancelRequestedAt、每次 LLM/工具/intent 前检查、cancel-vs-intent 同事务竞态和 finalization outbox
- [x] 9.6 实现取消屏障；runner 在首个付费 intent 前崩溃可安全 lease 重试，在已有付费 intent 后丢 lease则 V1 标记安全失败、不重跑 Agent、只结算既有 intent 并关闭退款
- [x] 9.7 增加 escrow-bound completed research 的 follow-up 回归测试，证明 follow-up 不读取/调用 Escrow、不创建 intent 且不改变原花费

## 10. Workflow outbox、链上对账与崩溃恢复 TDD

- [x] 10.1 先写受保护 Cron/queue worker 鉴权、lease claim/renew/release、退避、dead-letter/人工恢复和多 worker 并发 RED 测试
- [x] 10.2 实现带 fencing 的 ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE worker；CLOSE 对账后 finalizationState 必须 `closing→closed`，不可自动恢复则 `closing→manual`，并实现带操作者/原因/evidence digest 审计的 `manual→closing|closed` 受保护恢复；进程内 `void` 调用只能 enqueue/提示
- [x] 10.3 先写 settlement client RED 测试，覆盖 deterministic items、itemsHash/total、intent signer 签名、simulate/write、receipt 与摘要/逐项/USDC Transfer 精确匹配
- [x] 10.4 实现只替换 research 的 Escrow settlement client；直接 `/api/data/*` 在 mock/arc receipt 模式继续原路径
- [x] 10.5 先写崩溃点 RED 测试：广播前、广播成功未保存 txHash、txHash 已存未确认、receipt 成功未写 DB、reconcile 后 close 前
- [x] 10.6 实现从 operationKey、链上 processed key/result summary、indexed event、tx receipt 与部署区块扫描恢复，RPC 不确定时不得盲目重播或误标 confirmed
- [x] 10.7 先写 closing 屏障 RED 测试，覆盖完成/取消与 intent 创建竞态、每个 intent 的 canonical terminal liability、PAID result/spent、manual approval、CloseAuthorization 和固定 no-intent hash
- [x] 10.8 实现原子 research status→completed/failed/cancelled 且 finalizationState→closing + 阻止新 intent + SETTLE/RECONCILE/CLOSE outbox；报告 final 不等待链上 settlement
- [x] 10.9 增加 Registry 更新 fail-closed、到期前停止新工具、错过 expiry 的严重运营告警和人工处置测试
- [x] 10.10 更新 detail/wallet tx-log/TX feed，对 escrow、operation phase、共享 txHash、pending/confirmed/failed/refund/excess 只显示已对账事实

## 11. 钱包资助 UI TDD

- [x] 11.1 先写 UI RED 测试，覆盖 prepare、allowance、approve、createAndFund(Funded)、buyer activation 签名、activating/start、拒签、链切换、失败重试和页面重载恢复
- [x] 11.2 每次 approve/create/activate/start 前重新校验 wallet account、SIWE buyer、chainId、Factory、voucher deadline 与 expected expiry；任一变化必须停止流程
- [x] 11.3 实现可恢复 funding 状态机；Activation 签名前展示 intentSigner、授权预算/expiry/deadline 和双钥信任边界，已有 allowance 跳过 approve，重复点击不创建第二 clone、签名或 runner
- [x] 11.4 分开展示 research status、finalizationState、预算、官方 USDC、Factory/Escrow、Funded/Active/Closed、tx 与 Explorer 证据，并提供 Funded 取消入口
- [x] 11.5 保留 mock demo 的无钱包交易体验，增加 accessibility、错误文案和 feature-flag 回归测试
- [x] 11.6 更新 `/research` 与 dashboard quota UI，区分 consumed/reserved；覆盖 mock/legacy 单步 UI、Escrow reservation 恢复与 funding_expired/取消后的精确回退

## 12. 部署证据工具与本地演练

- [x] 12.1 先写 manifest RED 测试，覆盖 chainId/commit/compiler/settings/deployer、三个核心地址、构造/初始化参数、tx/block、runtime/artifact hashes、外部依赖和 funded/settled clone 计数
- [x] 12.2 实现 Foundry deploy、source 配置、角色移交、manifest/Explorer input 生成器和 secret/path/provider-key 扫描；manifest 不含私钥、签名原文或本机敏感路径
- [x] 12.3 先写独立 RPC verifier RED 测试，内置 chainId 5042002 官方 USDC `0x3600000000000000000000000000000000000000` 与 native emitter `0xfffffffffffffffffffffffffffffffffffffffe`，验证 code/decimals/runtime/proxy且不信任 manifest
- [x] 12.4 增加 Registry/implementation/Factory code/hash/wiring、initializer 锁、clone implementation、完整 role members/count/admin graph/grant-revoke、INTENT_SIGNER EOA/角色互斥和 deployer 零权限验证
- [x] 12.5 定义 `R` 只计可复核非零资助 clone，另报有成功 settlement 的 clone 数；官方 USDC/Safe/外部协议和空实例不得计数
- [x] 12.6 先写 smoke verifier RED 测试，要求 buyer、payout、deployer、两套 admin、funding signer、intent signer、settler 和协议地址关系公开，payout 与所有敏感身份不同
- [x] 12.7 在支持 Arc 双接口语义的本地/fork 环境执行完整 smoke，验证合约内六位差额、direct EOA buyer 的 `nativeDelta18-gas18=budget6*10^12`、六/18 位双 emitter 日志去重、摘要和 lineage
- [x] 12.8 运行 Forge coverage、长时 fuzz/invariant 和 Slither；高/中风险必须修复或经明确安全评审阻断发布

## 13. Arc Testnet 外部写入授权门禁

- [x] 13.1 在任何部署、source 登记、角色 grant/revoke/移交或 test USDC 支出前，向用户列出目标链、地址、角色、预计交易和资金影响，并针对该次写入重新取得明确授权
- [x] 13.2 获授权后才确认 clean Git commit、compiler settings、deployer余额、Factory/Registry Safe、source payout、funding signer、intent signer、settler、官方 USDC 和 RPC
- [x] 13.3 在 chainId 5042002 部署 Registry、锁定 implementation、Factory，保存成功 receipt/block/code hash；失败或不确定状态先查链上再决定，不得盲目重播
- [ ] 13.4 对三个核心合约完成 exact-match source/ABI 验证，先一次性 bindFactory 并读回双向 wiring，再登记五个 source、完成角色移交/deployer撤权并从 finalized block 复核
- [x] 13.5 经独立 test USDC 授权后，用 direct EOA buyer（无 AA/paymaster）执行 smoke；记录六位合约差额、18 位 native/gas/`*10^12` 公式、两类 emitter Transfer 去重、摘要和退款
- [x] 13.6 独立 verifier 仅凭公开 RPC、权威 USDC 配置和 manifest 复核全部地址、角色、`3 + R`、settled 数量与 smoke；任一不一致不得发布证据

## 14. Rollout、文档与完成验证

- [x] 14.1 更新 README 与 `docs/contracts/`，说明 `3 + R` 拓扑、信任边界、角色、funding UX、worker SLA、部署/回滚/密钥轮换/事故处置和 Explorer 证据
- [ ] 14.2 先部署 DB expand/backfill、durable worker 与监控，再开启 funding UI；最后小流量切换 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow`
- [ ] 14.3 运行成功 E2E：prepare/quota、非零资助、激活、最多三次 intent、报告先完成、异步真实 USDC settlement、TX feed、close/refund/excess recovery
- [ ] 14.4 运行失败 E2E：拒签/账户变化、错误网络、funding_expired、短 TTL、Registry revision 变化、runner/worker 崩溃、RPC 不确定、DB 确认失败和到期退出
- [x] 14.5 运行 direct `/api/data/*` 在 mock/arc 两种 receipt 模式、`ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` legacy 回滚矩阵、mock research、历史 research、follow-up、统计/配额/列表的全量回归
- [x] 14.6 运行全部 Forge fmt/build/test/fuzz/invariant/coverage、Slither、前端/后端 test、typecheck、build、迁移 dry-run并保存命令与结果
- [ ] 14.7 对照六份 delta spec 逐场景核验实现和测试，更新本 tasks 状态并运行 `openspec validate onchain-research-escrow --strict --no-interactive`
- [ ] 14.8 修改代码后重建 Graphify 并检查影响图；确认部署文档、README、manifest 和 verifier 均引用最终地址/commit
- [ ] 14.9 回滚演练：停止新 voucher/activation、切回 calldata/mock；已 Funded 可取消、已 Active 仍由 durable worker结算关闭或最终到期退出
