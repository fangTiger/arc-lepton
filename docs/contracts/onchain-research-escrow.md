# On-chain research escrow 部署与运行手册

本文是 `onchain-research-escrow` 的 pre-deployment runbook。它用于描述合约拓扑、信任边界、角色、funding UX、worker SLA、部署、回滚、密钥轮换、事故处置以及 Explorer 证据与 manifest 的填充规则。

当前文档不得被当作最终链上证据。真实地址、交易、区块、Explorer exact-match 结果、角色读回和 smoke 结果只能来自 Arc Testnet 写入后的 `deployments/5042002.json`、公开 RPC 与独立 verifier。缺少这些事实前，不得将最终部署证据/13.x/14.8/14.9 标记为完成或发布，也不得发布最终部署证据。

## 3 + R 拓扑

部署拓扑固定为 `3 + R`：

- 3 个核心合约：`DataSourceRegistry`、`ResearchEscrow implementation`、`ResearchEscrowFactory`。
- `R` 是可公开复核的非零资助 research clone 数量，manifest 中记录为 `fundedCloneCount = R`。
- `settledCloneCount` 只统计已公开证明完成 settlement/close 的 clone。
- 官方 USDC 是外部依赖，不计入项目部署合约数量。
- 空资助、零金额或不可复核 clone 不得计入 `R`。

最终 manifest 必须把核心合约、clone 谱系、artifact hash、runtime hash、构造参数、交易和 finalized block 绑定到同一 clean commit。任何地址、hash、clone 数或 source 配置无法复核时，文档只能保持“待填充”状态。

证据线必须能按 `deployer → DataSourceRegistry / ResearchEscrow implementation / ResearchEscrowFactory → Factory-created clone` 逐级追溯：核心合约由 manifest 声明的 deployer 创建；Registry/Factory wiring 双向读回；每个 clone 由 Factory 创建事件、CREATE2 salt、预测地址、runtime code 和初始化参数共同证明。

## 信任边界

系统把链上事实、服务端状态和用户钱包交互分开处理：

- 链上事实以 Arc Testnet chainId `5042002`、官方 USDC、核心合约 runtime hash、事件和只读接口为准。
- 服务端只能基于 durable database、`workflow_outbox`、公开 RPC 证据和签名授权推进状态机。
- 前端展示可以提示用户 funding、activation、settlement 和 Explorer 入口，但不能自行制造链上事实。
- deployer 只负责 bootstrap 部署与初始配置；发布前不得持有最终 admin/runtime role。
- private key、助记词、带凭据 RPC、原始 funding/activation/settlement/close signature 不得写入 README、manifest、日志或部署证据。

## 角色矩阵

发布前必须读回并复核以下角色和成员数量：

| 角色或账户 | 目标归属 | 发布前要求 |
| --- | --- | --- |
| deployer | 临时部署账户 | 完成部署、bind、source 配置和角色移交后不持有任何敏感角色 |
| Factory governance Safe | Factory admin | 持有 Factory 最终治理权限，必须有 code |
| Registry governance Safe | Registry admin | 持有 Registry 最终治理权限，必须有 code |
| SOURCE_ADMIN | source 配置账户 | 负责五个 data source 的配置和轮换 |
| FUNDING_SIGNER | funding voucher 签名账户 | 仅用于 funding 授权，不得与其他敏感角色重叠 |
| INTENT_SIGNER | intent/close 授权账户 | 必须是 EOA，不能有 code，不能与 buyer、协议地址或其他敏感角色重叠 |
| SETTLER | settlement 执行账户 | 只负责已授权 payment intent 的 settlement |

grant/revoke 证据必须从 deployment block 起完整重放，或由等价 enumerable readback 证明完整成员集合、role-admin 图和成员数量。只抽查单个地址是不够的。

## Funding UX

funding UX 分三层：

1. Prepare：用户选择 topic 和预算后，服务端创建 funding 状态、quota reservation、researchKey、预测 Escrow 地址、funding deadline 和 expected expiry。
2. Approve/fund：用户在钱包中执行 `approve → createAndFund(Funded)`，预算进入 clone 后才允许进入 activation。
3. Activate：后端验证链上 funding 事实、Registry revision、`ActivationAuthorization` 和持久 checkpoint 后，才启动 Agent runner。

用户界面必须清楚展示官方 USDC、Factory/Escrow、预算、status、activationPhase、finalizationState、txHash、Explorer 链接和可取消/恢复入口。未完成 funding 的 run 不得启动付费工具。

## Worker SLA

durable worker 必须以数据库和链上公开事实为准：

- ACTIVATE、RUN、SETTLE、RECONCILE、CLOSE 都必须有 fencing 和幂等键。
- `workflow_outbox` 是跨进程恢复入口，worker 崩溃后必须能从 checkpoint 继续。
- 每个 operation 诊断必须至少能公开定位 lease owner、lease expiry、attempts、nextAttemptAt、phase、txHash 或 lastError digest；不得公开受保护授权 payload 或原始签名。
- 报告完成不等于资金终态完成；finalizationState 可以停留在 `closing` 或 `manual`。
- `manual` 只能由受保护人工恢复动作携带操作者、原因和 evidence digest 后推进。
- RPC 不确定、DB 确认失败、签名失效、Registry revision drift 或链上/数据库证据冲突时，worker 必须 fail closed。

## 部署流程

部署必须分阶段授权，且每个阶段都要向操作者列出 chainId、目标地址、角色、预计交易、资金影响和回滚边界：

1. 本地 preflight：确认 clean Git commit、Foundry/Solc/compiler settings、deployer gas、官方 USDC、公开 RPC、Factory/Registry Safe、source payout、funding signer、intent signer 和 settler。
2. 核心部署：部署 `DataSourceRegistry`、锁定 `ResearchEscrow implementation`、部署 `ResearchEscrowFactory`，并保存成功 receipt、block、code hash 和 artifact hash。
3. Wiring/config：一次性 bind Factory，读回 Registry/Factory 双向 wiring，登记五个 source，完成 role grant/revoke 和 deployer 撤权。
4. Source verification：对三个核心合约执行 Explorer exact-match source/ABI 验证。
5. Smoke：另取明确授权，用 direct EOA buyer、官方 test USDC 和无 AA/paymaster 路径完成 create/fund/activate/settle/close smoke，并记录六位 USDC 与 18 位 native/gas 公式。
6. 独立 verifier：只凭公开 RPC、权威 USDC 配置和 manifest 复核全部地址、角色、`3 + R`、settled 数量与 smoke。

未授权时不得广播任何部署、source、角色或 smoke 交易。任何已批准范围只对该次展示的 chainId、clean commit、地址、交易 calldata、gas 上限和最大 USDC 影响有效；chain、commit、地址、calldata、gas 或 USDC 范围变化时，旧授权自动失效，必须重新展示差异并取得新的阶段授权。

任何失败或不确定状态都必须先查链上再决定下一步，不得盲目重播交易。

## 回滚流程

回滚优先保护用户资金和状态一致性。真实回滚演练前必须按以下清单执行；这些动作只改变新流量和后台调度，不删除部署、manifest、Explorer 证据或既有链上事实：

1. **冻结新资金入口**：先停止签发新 funding voucher，再关闭新的 prepare API 放行，然后关闭 funding UI，最后停止接受新的 buyer activation/start。顺序不得反过来，避免用户已拿到可用 voucher 却无法看到取消或恢复入口。
2. **切回新应用流量**：把新 research 流量切回 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata`；如需完全演示离线流程，可切到 mock。切换后 legacy calldata/mock 单步 start 可继续服务新请求，但不得把 legacy tx 展示成真实 USDC settlement。
3. **保持 drain worker 在线**：回滚 UI 或新流量时，worker/Cron 环境必须继续使用 worker auth、durable DB 和公开 RPC（public RPC）。`/api/research/workflow` 与 `/api/research/funding-expiry` 入口必须保持可运行，用于 drain 既有 Escrow work；workflow 入口继续调用 `processDueWorkflowOperations`，funding-expiry 入口继续处理 fundingDeadline、ACTIVATE reconcile 和 quota release。生产环境缺少 durable DB 或 worker auth 时必须返回 `503 DURABLE_DB_REQUIRED`，但不能用关闭 Escrow 新流量来停止既有 Active/Funded 的恢复路径。
4. **观察 Funded 未 Active 样本**：选取至少一个已验证 funding receipt、Escrow state=`Funded`、activationPhase 非 `active` 的样本。确认 reservation 仍为 `reserved` 或 `activating`，ACTIVATE operation 没有 pending/不确定结果后，引导 buyer 调用 `cancelUnactivated`。receipt 对账后必须确认 Escrow Closed、退款只到 buyer、activationPhase=`cancelled` 或保留既有 `funding_expired`、finalizationState=`closed|none` 按状态表落位，并且 wallet/global quota reservation 精确 release 一次。
5. **观察 Active 样本**：选取至少一个 Escrow state=`Active` 的样本。即使新流量已切回 calldata/mock，durable worker 仍必须继续 SETTLE/RECONCILE/CLOSE：已有 pending intent 继续 settlement，对账后 close；无 intent 也要创建 CLOSE operation 退回预算/excess。若 worker 错过 expiry 或需要最终退出，到期后由任意账户触发 `refundExpired`，但资金只能退给 buyer；不得在到期前给 Active buyer 暴露单方面抽资动作。
6. **manual recovery 门禁**：只有受保护操作者可以执行 manual recovery。每次从 `manual→closing|closed` 或人工 reconcile 前，必须记录操作者、原因、原 evidence digest、新 evidence digest、公开链上定位、DB operationKey 和审批时间；不得修改 canonical intent、签名 payload、settlementKey/requestKey 或链上事实。普通用户、SSE 请求、无审批 Cron 或本地脚本不得绕过此门禁。
7. **已 Closed 只修复展示**：已 Closed 的 Escrow 不回滚链上事实，只修复 UI、索引、tx_log、Explorer 链接和 manifest 引用；任何显示层修复都必须保留原 txHash/block/logIndex 和 verifier 证据。

回滚演练必须覆盖 funding_expired、短 TTL、runner 崩溃、RPC 不确定、DB 确认失败和历史 research 可读性。

## 密钥轮换

密钥轮换按角色分开执行：

- deployer：仅用于部署窗口；完成后移出权限集合并下线。
- governance Safe：通过多签策略替换成员，替换前后都要读回完整 role graph。
- SOURCE_ADMIN：轮换后重新验证五个 source 的 sourceId、payout、maxUnitPrice 和 active 状态。
- FUNDING_SIGNER：新旧签名窗口不得重叠失控；未使用 voucher 必须可判定过期或作废。
- INTENT_SIGNER：必须保证 pending intent 的 signer/revision 可恢复，避免 settlement/close 误签。
- SETTLER：轮换期间暂停新 settlement，保留已处理 requestKey/settlementKey 的防重状态。

所有轮换记录只保存公开地址、txHash、block、原因和审批摘要；不得保存私钥或原始签名。

## 事故处置

事故分级以资金风险和链上事实不确定性为先：

- RPC 分叉或 finalized block 不一致：暂停发布证据，切到独立 RPC 复核。
- role graph 与 manifest 不一致：停止 funding/activation，重放 RoleGranted/RoleRevoked，查明后再决定是否恢复。
- USDC 差额不一致：冻结新 settlement，核对 ERC-20 Transfer、native emitter Transfer、余额差和 gas 公式。
- worker 重试耗尽：进入 manual，记录操作者、原因和 evidence digest。
- Explorer exact-match 失败：不得发布最终证据；只能保留部署草稿和待修复项。

事故结束后必须补齐 postmortem：影响范围、链上事实、用户影响、修复交易、验证命令和回滚/恢复决定。

## Explorer 证据与 manifest

最终证据以 `deployments/5042002.json` 为机器可读入口，并由 Explorer exact-match、公开 RPC 和独立 verifier 交叉验证。manifest 至少包含：

- 网络、chainId、finalized blockNumber/blockHash。
- 核心地址、creator、deployment txHash、receipt status、transactionIndex。
- artifact 名称、source 文件、constructor/init 参数、init code hash、creation bytecode hash、runtime bytecode hash、ABI hash、metadata hash、build-info hash 和 source bundle hash。
- role graph、grant/revoke 事件、Factory/Registry wiring、source 配置和官方 USDC 配置。
- `fundedCloneCount = R`、`settledCloneCount`、clone lineage、smoke tx、余额差和去重 Transfer 摘要。

Explorer contract、source exact-match、ABI、tx、block 和 log 定位必须全部来自公开浏览器或公开 RPC 可复核事实，并与 manifest 中的 transactionIndex、logIndex、runtime hash、ABI hash 和源码验证状态一致。

只要 `deployments/5042002.json`、Explorer exact-match、独立 verifier 或 smoke evidence 任一项缺失或不一致，就不得将最终部署证据/13.x/14.8/14.9 标记为完成或发布，不得发布最终部署证据。
