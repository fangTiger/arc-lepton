# onchain-research-escrow 14.7 本地 spec 场景核验报告草稿

日期：2026-07-11

范围：OpenSpec change `onchain-research-escrow` 的六份 delta spec。此报告只做本地实现、测试与文档证据核验；未部署、未广播、未读取私钥、未花费 test USDC，且未修改 `openspec/changes/onchain-research-escrow/tasks.md`。

## 总结论

不建议勾选 14.7，14.7 仍未完成。

当前 OpenSpec 进度为 `95/107 tasks`。14.1 文档/runbook 与 14.5 本地回归矩阵已经完成并有本地证据；但六份 spec 仍存在明确 blocked 场景：13.1–13.6 的外部写入授权、真实 Arc Testnet 部署、Explorer exact-match、test USDC smoke、公开 RPC 独立 verifier 未完成；14.2–14.4 的生产 DB/worker 切流、真实成功 E2E、真实失败 E2E 未完成；14.7–14.9 仍未完成。只要这些场景仍 blocked，14.7 的“逐场景核验实现和测试”不能声明完成。

| Spec | 场景数 | 本地结论 | 14.7 建议 |
| --- | ---: | --- | --- |
| `arc-payment-receipts` | 11 | partial；14.5 本地 direct/legacy regression covered，真实链上 receipt/E2E blocked | 不勾 |
| `contract-deployment-evidence` | 42 | blocked | 不勾 |
| `onchain-research-escrow` | 55 | partial | 不勾 |
| `research-agent-engine` | 43 | partial；14.5 本地 mock/history/follow-up regression covered，真实 worker/E2E blocked | 不勾 |
| `research-daily-quota` | 14 | partial；14.5 本地 quota regression covered，生产切流/E2E blocked | 不勾 |
| `research-web-ui` | 10 | partial；14.5 本地 UI regression covered，真实钱包/E2E blocked | 不勾 |

## 核验方法与命令证据

本次刷新读取并核对：

- `openspec/changes/onchain-research-escrow/tasks.md`
- `openspec/changes/onchain-research-escrow/specs/arc-payment-receipts/spec.md`
- `openspec/changes/onchain-research-escrow/specs/contract-deployment-evidence/spec.md`
- `openspec/changes/onchain-research-escrow/specs/onchain-research-escrow/spec.md`
- `openspec/changes/onchain-research-escrow/specs/research-agent-engine/spec.md`
- `openspec/changes/onchain-research-escrow/specs/research-daily-quota/spec.md`
- `openspec/changes/onchain-research-escrow/specs/research-web-ui/spec.md`
- `docs/contracts/onchain-research-escrow.md`
- `contracts/scripts/deployment-docs.node-test.mjs`
- `docs/plans/2026-07-11-onchain-research-escrow-regression-matrix.md`

本轮执行/查询：

- `openspec list --specs`：通过，列出现有 specs。
- `openspec list`：`onchain-research-escrow` 为 `95/107 tasks`，14.7 未完成。
- `openspec status --change onchain-research-escrow --json`：schema 为 `spec-driven`，repo-local，可编辑根为本项目。
- `openspec instructions apply --change onchain-research-escrow --json`：上下文文件确认六份 spec；剩余任务为 13.1–13.6、14.2–14.4、14.7–14.9。
- `openspec/changes/onchain-research-escrow/tasks.md`：14.1、14.5、14.6 为 `[x]`；13.1–13.6、14.2–14.4、14.7–14.9 为 `[ ]`。
- `rg -c "^#### Scenario" openspec/changes/onchain-research-escrow/specs/*/spec.md`：场景计数分别为 11、42、55、43、14、10。
- `rg --files | rg '(^|/)deployments/5042002\.json$|(^|/)deployments/'`：无输出，未发现最终 `deployments/5042002.json`。
- `openspec validate onchain-research-escrow --strict --no-interactive`：通过，输出 `Change 'onchain-research-escrow' is valid`。
- `graphify-out/GRAPH_REPORT.md`：当前 Graphify 报告为 `1189 nodes`、`2573 edges`、`39 communities detected`；该报告可作为本地影响图阅读证据，但不替代最终地址/commit/manifest/verifier 的真实发布证据。
- `node --test contracts/scripts/deployment-readiness-audit.node-test.mjs contracts/scripts/rollout-e2e-readiness.node-test.mjs contracts/scripts/graphify-final-evidence-readiness.node-test.mjs`：12/12 pass，覆盖 13.2、14.2–14.4、14.8 的本地 readiness 边界；这些 readiness 只降低后续授权执行风险，不替代真实外部写入或 E2E。
- 最新本地复核：`npm run contracts:tooling:test` 485/485 pass，新增覆盖 deployment authorization handoff placeholder boundary、deployment authorization handoff machine-readable safety flags、deployment authorization briefing JSON-like input hygiene、deployment authorization exact reply template、deployment evidence package JSON-like input hygiene、deployment evidence approval marker hygiene、deployment manifest JSON-like input hygiene、deployment authorization gate JSON-like input hygiene、deployment authorization record field hygiene、deployment authorization package JSON-like input hygiene、deployment authorization package exact replies、graphify final evidence authorization safety scope、authorization package misuse safety、deployment readiness authorization package handoff non-authorization safety、deployment readiness predeploy commit staging hazards、predeploy commit scope candidate/exclusion gate、predeploy stoplight deployment blocked gate、predeploy stoplight JSON-like input hygiene、deployment next action checklist authorization boundary、deployment next action checklist exact reply、deployment next action checklist secret hygiene、deployment authorization input gap report、deployment authorization request draft exact schema/secret boundary、deployment write plan freeze local-only digest boundary、deployment write plan freeze null-prototype input hygiene、deployment gate/tooling null-prototype input hygiene、remaining task evidence matrix authority boundary、source role readiness authorization boundary、source role readiness report、smoke spend readiness authorization boundary、smoke evidence verifier JSON-like input hygiene、RPC verifier envelope input hygiene、local smoke runner input/harness getter hygiene、artifact consistency wrapper input getter hygiene、Slither wrapper input getter hygiene、deployment/predeploy CLI streams wrapper input getter hygiene、CLI stream helper wrapper shape hygiene、final evidence publication gate、final public verifier readiness publication boundary、rollout authorization package handoff non-authorization safety、rollback authorization package handoff non-authorization safety 与 rollback drill final public verifier gate、rollback live execution runbook；该复核只证明本地授权交接、authorization package 防误用和 JSON-like 入口扫描 fail-closed、deployment authorization exact reply template 只渲染公开字段且不构成授权记录、deployment next action checklist 输出同字段 exact reply 且仍不构成授权记录、deployment write plan freeze 只冻结三阶段公共写入摘要与 digest 且不构成授权记录、deployment manifest 生成/校验输入扫描 fail-closed、predeploy stoplight 输入扫描 fail-closed、evidence package 公开输入/approval-shaped marker 扫描 fail-closed、authorization gate requestDigest/authorization 输入扫描 fail-closed、authorization 记录字段白名单 fail-closed、local smoke runner 输入 envelope、harness 方法与 optional harness 字段读取不执行 getter、artifact consistency、Slither wrapper 与 deployment/predeploy CLI streams wrapper 输入读取不执行 getter、CLI stream helper wrapper shape hygiene、13.1 逐阶段授权公共输入缺口分类和 request digest draft 生成、13.2 readiness/preflight 授权包负授权边界、13.2 前 clean commit 候选范围分类、本地提交警戒、部署前 stoplight 阻断门禁、下一阶段 checklist 授权边界、剩余任务证据矩阵的 readiness/authoritative evidence 分类、13.4 source/roles/exact-match 本地授权边界、13.5 smoke_usdc_spend/test USDC 花费授权边界、13.6 final public verifier 发布边界、Graphify/final evidence 授权安全影响范围、最终证据发布审查本地门禁、rollout/E2E 授权包负授权边界、rollback live 授权包负授权边界、rollback live 证据门禁、tooling 与文档门禁仍通过，不替代 13.1–13.6 的真实授权、部署、source/roles、smoke 或公开 RPC verifier。

新增 readiness 证据：

- 13.2 部署前 readiness：`docs/plans/2026-07-11-onchain-research-escrow-deployment-readiness-audit.md` 与 `contracts/scripts/deployment-readiness-audit.node-test.mjs`。该材料列出授权后才可确认的 clean Git commit、compiler settings、deployer 余额、Factory/Registry Safe、source payout、funding signer、intent signer、settler、官方 USDC 和 RPC；它不替代 13.1 授权或 13.2 授权后真实确认。
- 13.5 test USDC smoke readiness：`docs/plans/2026-07-11-onchain-research-escrow-smoke-spend-readiness.md` 与 `contracts/scripts/smoke-spend-readiness.node-test.mjs`。该材料列出 `smoke_usdc_spend` 的独立 test USDC 授权、direct EOA buyer、无 AA/paymaster、approve → createAndFund → activate → settleBatch → close、maxUsdcUnits、nativeDelta18-gas18=budgetUnits6*10^12、六位合约差额、18 位 native/gas、两类 emitter Transfer 去重和 buyer/payout/Factory/USDC/Escrow 证据要求；它不能替代 13.5 真实 test USDC smoke。
- 13.6 final public RPC verifier readiness：`docs/plans/2026-07-11-onchain-research-escrow-final-public-verifier-readiness.md` 与 `contracts/scripts/final-public-verifier-readiness.node-test.mjs`。该材料列出独立公开 RPC verifier 只能依赖公开 RPC、权威 USDC 配置和最终 `deployments/5042002.json` manifest 复核 `3 + R`、fundedCloneCount、settledCloneCount、smoke_usdc_spend、finalized block、Explorer exact-match、role graph、deployer 零权限和 source 配置；它不能替代 13.6 真实 public verifier。
- 14.2–14.4 rollout/E2E readiness：`docs/plans/2026-07-11-onchain-research-escrow-rollout-e2e-readiness.md` 与 `contracts/scripts/rollout-e2e-readiness.node-test.mjs`。该材料列出 DB expand/backfill、durable worker/monitor、funding UI、小流量 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow`、成功 E2E 和失败 E2E 的证据要求；它不替代真实 rollout、成功 E2E 或失败 E2E。
- 14.8 Graphify/final evidence readiness：`docs/plans/2026-07-11-onchain-research-escrow-graphify-final-evidence-readiness.md` 与 `contracts/scripts/graphify-final-evidence-readiness.node-test.mjs`。该材料记录当前 Graphify `1189 nodes` / `2573 edges`，并列出 deployment manifest、verifier、smoke、preflight、authorization、README、`docs/contracts`、`contracts/scripts`、`openspec tasks` 的影响检查范围；它不替代最终地址、最终 commit、chainId 5042002、tx hash/block、runtime/code hash 的真实证据。`contracts/scripts/final-evidence-publication-gate.mjs` 进一步把最终 manifest、README、docs/contracts、verifier、Graphify、core address、clone count 和 final evidence flags 的一致性整理成本地 fail-closed gate，但输出只允许请求最终发布审查，不允许发布最终证据或完成 13.6/14.8。

主要既有验证记录：

- `docs/plans/2026-07-11-onchain-research-escrow-verification-sweep.md` 记录 14.6 本地验证矩阵，并追加最新本地复核：`npm run contracts:tooling:test` 485/485、deployment authorization handoff placeholder boundary、deployment authorization handoff machine-readable safety flags、deployment authorization briefing JSON-like input hygiene、deployment authorization exact reply template、deployment evidence package JSON-like input hygiene、deployment evidence approval marker hygiene、deployment manifest JSON-like input hygiene、deployment authorization gate JSON-like input hygiene、deployment authorization record field hygiene、deployment authorization package JSON-like input hygiene、deployment authorization package exact replies、graphify final evidence authorization safety scope、authorization package misuse safety、deployment readiness authorization package handoff non-authorization safety、deployment readiness predeploy commit staging hazards、predeploy commit scope candidate/exclusion gate、predeploy stoplight deployment blocked gate、predeploy stoplight JSON-like input hygiene、deployment next action checklist authorization boundary、deployment next action checklist exact reply、deployment next action checklist secret hygiene、deployment authorization input gap report、deployment authorization request draft exact schema/secret boundary、deployment write plan freeze local-only digest boundary、deployment write plan freeze null-prototype input hygiene、deployment gate/tooling null-prototype input hygiene、remaining task evidence matrix authority boundary、source role readiness authorization boundary、source role readiness report、smoke spend readiness authorization boundary、smoke evidence verifier JSON-like input hygiene、RPC verifier envelope input hygiene、local smoke runner input/harness getter hygiene、artifact consistency wrapper input getter hygiene、Slither wrapper input getter hygiene、deployment/predeploy CLI streams wrapper input getter hygiene、CLI stream helper wrapper shape hygiene、final evidence publication gate、final public verifier readiness publication boundary、rollout authorization package handoff non-authorization safety、rollback authorization package handoff non-authorization safety、rollback drill final public verifier gate、rollback live execution runbook、`npm run contracts:test:unit` 167/167、fuzz 4/4、invariant 6/6、coverage 通过、Slither 通过、`npm test -- --run` 76 files / 485 tests、typecheck/build/migration dry-run/OpenSpec validate/Graphify 重建通过（1189 nodes、2573 edges、39 communities detected）。
- `docs/contracts/onchain-research-escrow.md` 与 `contracts/scripts/deployment-docs.node-test.mjs` 覆盖 14.1 文档/runbook：`3 + R` 拓扑、信任边界、角色、funding UX、worker SLA、部署/回滚/密钥轮换/事故处置、Explorer 证据和“pre-deployment runbook 不等于最终链上证据”的门禁。
- `docs/plans/2026-07-11-onchain-research-escrow-regression-matrix.md` 覆盖 14.5 本地回归矩阵，目标命令结果为 `Test Files 15 passed (15)`、`Tests 163 passed (163)`。
- 上述本地记录明确声明：不替代 13.1–13.6 的真实外部写入授权、Arc Testnet 部署、Explorer exact-match、角色读回、source 登记、test USDC smoke 和独立公开 RPC verifier；也不替代 14.2–14.4 的生产 DB/worker 切流、真实成功/失败 E2E，或 14.9 的回滚演练。

## Spec: `arc-payment-receipts` — partial

本地覆盖的主要场景：

- 直接 `/api/data/*` receipt 路径：`app/api/data/mock-sources.test.ts` 覆盖 escrow backend 启用时 direct ARC receipt 仍走 legacy path；`lib/chain/arc-receipt.test.ts`、`lib/x402/payment-recorder.test.ts` 覆盖 mock/arc receipt、tx hash、confirmation 与失败路径。
- pending intent 与 tx_log：`lib/db/tx-log-repo-memory.test.ts` 覆盖 escrow payment intent 的 immutable snapshot、requestKey、amountUnits、registryRevision、expectedPayout、maxUnitPrice、pending/confirmed/failed 批次更新；`lib/agent/research-agent.test.ts` 覆盖工具副作用前持久化 stable payment intent、pending payment 事件和报告完成不等待 settlement。
- settlement outbox/reconciliation 本地逻辑：`lib/research/settlement-worker.test.ts`、`lib/research/settlement-client.test.ts`、`lib/research/workflow-worker.test.ts` 覆盖 SETTLE/RECONCILE operation、snapshot、itemsHash、total、签名 payload、失败退避和恢复分支。
- wallet/detail/feed 展示：`app/api/wallet/wallet-routes.test.ts`、`app/api/research/[id]/route.test.ts`、`components/research/TxFeed.test.tsx`、`components/research/types.test.ts` 覆盖 pending 不显示 confirmed、共享 settlement txHash 仍保留 requestKey、operation phase 和 reconciliation 状态。
- 14.5 本地回归矩阵：`docs/plans/2026-07-11-onchain-research-escrow-regression-matrix.md` 覆盖 direct `/api/data/*` mock receipt、ARC receipt、escrow backend 不影响 direct data、`ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` legacy 回滚、mock research、历史 research、follow-up、统计/配额/钱包 tx-log/list/dashboard；目标测试为 15 files / 163 tests。

Blocked 场景：

- `Research Escrow settlement 聚合多个工具调用` 中“当前 SETTLER_ROLE 广播 signed batch、ResearchEscrow 转移真实 ARC test USDC、共享 settlement txHash”的真实链上部分 blocked：依赖 13.3 部署、13.4 角色/source 配置、13.5 test USDC smoke、13.6 公开 RPC verifier，以及 14.3 成功 E2E。
- `成功 receipt 与冻结 settlement 快照完全一致`、`receipt 成功但签名、摘要、事件或 Transfer 不匹配`、`广播后未保存 txHash 即崩溃` 的真实 receipt、indexed event、官方 USDC Transfer、Arc 18 位 system emitter 去重 blocked：本地 verifier 有模拟证据测试，但没有真实 Arc Testnet receipt 与 finalized block。
- direct `/api/data/*` 在 mock/arc 两种 receipt 模式、legacy calldata 回滚、mock/history/follow-up/stats/quota/list/dashboard 的本地 regression 已由 14.5 覆盖；但这不是真实链上 E2E、smoke 或 rollback 演练证据。

结论：本地实现/测试证据 partial；真实 receipt/Transfer/Explorer/E2E 证据 blocked。

## Spec: `contract-deployment-evidence` — blocked

本地覆盖的主要场景：

- manifest/schema/topology/verifier 工具：`contracts/scripts/deployment-manifest.node-test.mjs` 覆盖 chainId 5042002、核心地址、构造参数、artifact hash、clone count、外部依赖、dirty Git 拒绝和 JSON-like 输入卫生。
- authorization/preflight/evidence package：`contracts/scripts/deployment-authorization-gate.node-test.mjs`、`contracts/scripts/deployment-preflight-gate.node-test.mjs`、`contracts/scripts/deployment-evidence-package.node-test.mjs` 覆盖逐阶段授权请求、配置/角色/smoke 分阶段授权、preflight fail-closed、Explorer input 生成和机密扫描。
- RPC verifier/smoke verifier 本地模拟：`contracts/scripts/rpc-deployment-verifier.node-test.mjs`、`contracts/scripts/smoke-evidence-verifier.mjs`、`contracts/scripts/local-smoke-evidence-runner.mjs` 覆盖内置官方 USDC、native emitter、runtime hash、role graph、clone implementation、smoke 身份隔离、native gas 公式和 emitter 去重的本地模拟证据。
- 14.1 文档门禁：`docs/contracts/onchain-research-escrow.md`、`contracts/scripts/deployment-docs.node-test.mjs` 覆盖部署 runbook、回滚流程、密钥轮换、事故处置、Explorer 证据与 manifest，并明确这是 pre-deployment runbook，不得当作最终链上证据。

Blocked 场景：

- `核心合约归属于项目 deployer`、`Registry 与 Factory 双向绑定`、`clone 归属于固定 Factory 和 implementation`、`R 只计算非零真实资助 clone`、`单列真实 settlement 数量` blocked：13.3 未部署，13.4 未 bindFactory/source/角色移交，13.5 未产生非零 funded clone/smoke，13.6 未公开 RPC 复核。
- `manifest 引用权威 USDC`、`权威依赖链上状态不可复核` 的真实 finalized 链上复核 blocked：本地 verifier 有内置常量和模拟 RPC 测试，但没有最终 manifest 和公开 RPC 结果。
- `ARC 5042002 完整机器可读 manifest` 的全部最终 manifest 场景 blocked：仓库未发现 `deployments/5042002.json`，也没有真实 tx/block/runtime/source verification 填充。
- `clean commit 与可复现 artifact` 的最终部署来源 blocked：当前工作树包含大量未提交/新增/删除文件，本地 artifact gate 只能证明工具行为，不等于最终 clean commit 部署证据。
- `核心源码 exact-match 与 clone runtime 验证` blocked：13.4 Explorer exact-match 未执行。
- `完整角色成员集合与 role-admin 图` 的 finalized 角色读回 blocked：13.4/13.6 未执行。
- `外部链上写入必须逐阶段取得用户明确授权` 的真实授权、preflight 与广播 blocked：13.1–13.2 未完成，本报告也未取得外部写入授权。
- `身份隔离的真实 Funded 到关闭 smoke` 全部 6 个场景 blocked：13.5 未花费 test USDC、未执行 direct EOA buyer smoke。
- `失败即停止发布的证据门禁` 的“全部门禁通过后发布” blocked；“任一检查失败或不确定”目前应适用 fail-closed，因为最终 manifest/exact-match/smoke 缺失。
- `机密、未消费签名与审批证据不得泄露` 本地扫描逻辑 covered，但真实部署/签名产物尚未产生，不能核验真实产物。

结论：本地 tooling covered，但 spec 的可交付核心是外部部署证据；当前整体 blocked。

## Spec: `onchain-research-escrow` — partial

本地覆盖的主要场景：

- canonical key、itemsHash、liability、EIP-712：`contracts/test/unit/canonical/*.t.sol`、`contracts/test/vectors/*.json`、`contracts/scripts/*vectors.node-test.mjs`、`lib/chain/canonical.test.ts`、`lib/chain/eip712.test.ts` 覆盖共享向量、domain/type/hash/digest、非规范 key/source、排序、重复和 liability 校验。
- Registry：`contracts/src/registry/DataSourceRegistry.sol`，以及 `contracts/test/unit/registry/*.t.sol` 覆盖一次性 bindFactory、source revision、无效/越权更新、敏感 payout 拒绝。
- Factory/FundingVoucher：`contracts/src/factory/ResearchEscrowFactory.sol`，以及 `contracts/test/unit/factory/*.t.sol` 覆盖 CREATE2/EIP-1167、voucher 签名、initialDeployer 撤权、buyer/researchKey 隔离、全额资助、balance delta、fee-on-transfer/false/revert token 回滚。
- Escrow activation/settlement/close/excess/roles/events：`contracts/src/escrow/ResearchEscrow.sol`，以及 `contracts/test/unit/escrow/*.t.sol`、`contracts/test/unit/roles/FactoryRegistryRoles.t.sol`、`contracts/test/invariant/ResearchEscrowInvariants.t.sol` 覆盖 Funded→Active、cancelUnactivated、settleBatch 双授权、Registry snapshot、key 防重、result summary、close authorization、expiry refund、excess recovery、pause、role drift 和事件重建。
- prepare/quota/worker fail-closed：`lib/research/*.test.ts`、`lib/db/*repo*.test.ts`、`app/api/research/*/*.test.ts` 覆盖 prepare、start、funding expiry、activation worker、workflow worker、settlement worker、finalization、持久 outbox、fencing、manual recovery 与 `DURABLE_DB_REQUIRED`。

Blocked 场景：

- `精确 USDC 身份与六位金额 / 精确 transferFrom 入账` 中 direct EOA buyer 的 `nativeBefore18-nativeAfter18-actualGasDebit18 = budgetUnits6*10^12` 真实链上证据 blocked：13.5 未执行 test USDC smoke。
- `拒绝错误 token` 的发布验证真实链上官方 USDC/readback blocked：13.6 未公开 RPC verifier。
- `settlementKey/requestKey 防重与恢复摘要 / 广播后 DB 崩溃恢复` 中从部署区块扫描真实 indexed event 和 Transfer 的链上恢复 blocked：13.3–13.6 与 14.3/14.4 未执行。
- `durable workflow 与生产 fail-closed`、`durable Agent runner 与取消`、`签名关闭、closing 屏障与退款` 的真实 prepare→fund→activate→run→settle→close E2E blocked：14.3 成功 E2E、14.4 失败 E2E 未执行。
- `审计事件与只读接口 / 事件可完整对账` 对真实链上事件、USDC Transfer 与 DB snapshot 的完整对账 blocked：缺少部署与 E2E 链上事实。

结论：合约与服务端本地行为 partial/strong local covered；真实链上和端到端场景仍 blocked。

## Spec: `research-agent-engine` — partial

本地覆盖的主要场景：

- research 记录与状态机：`lib/db/research-repo-memory.test.ts`、`lib/db/research-repo-pg.test.ts` 覆盖 funding/running/completed/failed/cancelled、activationPhase、finalizationState、quota reservation、createdAt 排序、非法回边和事务回滚。
- prepare/start/cancel/detail/stream/workflow API：`app/api/research/prepare/route.test.ts`、`app/api/research/start/route.test.ts`、`app/api/research/[id]/cancel/route.test.ts`、`app/api/research/[id]/route.test.ts`、`app/api/research/[id]/stream/route.test.ts`、`app/api/research/workflow/route.test.ts` 覆盖鉴权、幂等、scope 冲突、预算精度、Funded receipt、ActivationAuthorization、TTL、DURABLE_DB_REQUIRED、cancel/outbox 和 SSE cold start。
- Agent runner/tool budget：`lib/agent/research-agent.test.ts` 覆盖 stable payment intent、closing/cancel barrier、budget/TTL fail-closed、最多 3 次付费工具、pending payment 不阻塞 final、异步 settlement 失败不撤回报告。
- durable worker/outbox：`lib/research/run-worker.test.ts`、`lib/research/activation-worker.test.ts`、`lib/research/funding-expiry.test.ts`、`lib/research/workflow-worker.test.ts`、`lib/research/finalization.test.ts`、`lib/db/workflow-outbox-repo-*.test.ts` 覆盖 lease、fencing、backoff、crash recovery、manual recovery。
- follow-up off-chain：`app/api/research/[id]/follow-ups/route.test.ts`、`lib/agent/research-follow-up.test.ts` 覆盖 completed escrow research follow-up 不触碰 Escrow、不创建 intent、不改变花费。
- 14.5 本地回归矩阵：`docs/plans/2026-07-11-onchain-research-escrow-regression-matrix.md` 覆盖 legacy calldata 回滚、mock research、历史 research/detail/list/stream、completed research follow-up、统计、配额、钱包 tx-log 和 dashboard/history UI；目标测试为 15 files / 163 tests。

Blocked 场景：

- `createAndFund 后保存 Funded 证据`、`激活成功后原子进入 running`、`funding reservation 到期先处理 ACTIVATE` 的真实 receipt/Factory event/chain state 对账 blocked：依赖 13.3–13.6 与 14.3/14.4。
- `Agent tool calling 与预算控制` 的真实 Active Escrow + live data tool + chain spent/key 组合验证 blocked：14.3 成功 E2E 未执行。
- `Research settlement lifecycle` 中 ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE 的真实广播前/后崩溃恢复、txHash、receipt、indexed event 恢复 blocked：14.3/14.4 未执行。
- 生产 DB expand/backfill、durable worker 与监控、funding UI 开启、小流量切到 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow` blocked：14.2 未执行。14.5 只证明本地 legacy/mock/history/follow-up/stats/quota/list 回归，不等于生产切流或 rollback 演练。

结论：本地 API/DB/runner/outbox/follow-up 与 14.5 回归证据 partial/covered；生产切流、真实 E2E 与 rollback 演练仍 blocked。

## Spec: `research-daily-quota` — partial

本地覆盖的主要场景：

- quota repository 与 state transitions：`lib/rate-limit/research-quota.test.ts`、`lib/db/research-quota-repo-memory.test.ts`、`lib/db/research-quota-repo-pg.test.ts` 覆盖 wallet 10/global 100、UTC reset、reserved/consumed/used、shadow dual-write/read-compare 和 fail-closed。
- prepare/start/activation/release：`lib/db/research-repo-memory.test.ts`、`lib/db/research-repo-pg.test.ts`、`lib/research/funding-expiry.test.ts`、`app/api/research/prepare/route.test.ts`、`app/api/research/start/route.test.ts` 覆盖 reserved→activating→consumed/released、ACTIVATE 不确定不释放、重试不双计。
- quota API/UI：`app/api/quota/route.test.ts`、`app/research/ResearchPageClient.test.tsx`、`app/dashboard/page.test.tsx` 覆盖 authenticated quota、401、consumed/reserved/used/remaining/resetAt、UI disabled 和 reservation 恢复显示。
- 14.5 本地回归矩阵：`docs/plans/2026-07-11-onchain-research-escrow-regression-matrix.md` 覆盖 quota route、start quota exceeded、reserved dashboard/UI 展示与 dashboard history/stat panels；目标测试为 15 files / 163 tests。

Blocked 场景：

- `KV 到 Postgres 权威切换` 的真实 production shadow dual-write、下一 UTC bucket 边界切换、旧 writer 排空 blocked：14.2 未部署/切流。
- `activation 精确消费 reservation`、`未激活终止精确释放 reservation`、`ACTIVATE 不确定时不得释放` 的真实链上 ACTIVATE/expiry/cancel 交错 blocked：14.3/14.4 未执行。
- UI 层 reserved/consumed 与详情恢复在真实钱包 funding 流程中的确认 blocked：14.3/14.4 未执行。

结论：quota 本地事务、UI/API 与 14.5 本地回归 covered/partial；生产切换与真实 E2E blocked。

## Spec: `research-web-ui` — partial

本地覆盖的主要场景：

- research 创建页面：`app/research/ResearchPageClient.test.tsx` 覆盖 mock/legacy 单步、escrow prepare、approve/createAndFund、activation signature、running/activating、chain/account 变化停止、拒签后可恢复、页面 reload 恢复、重复点击防重。
- Live/SSE/tx feed：`app/research/ResearchPageClient.test.tsx`、`components/research/AgentLogStream.test.tsx`、`components/research/TxFeed.test.tsx` 覆盖 durable event replay、pending settlement 不阻塞 final、pending 不渲染 explorer link、shared txHash 多 logical rows。
- detail/dashboard/home stats：`app/research/[id]/ResearchDetailClient.test.tsx`、`app/dashboard/page.test.tsx`、`app/page.test.tsx`、`app/api/stats/global/route.test.ts` 覆盖 report detail、escrow status/finalization/budget/address/operation evidence、Funded cancelUnactivated、history status 分离、global stats 排除 pending/funding_expired。
- 14.5 本地回归矩阵：`docs/plans/2026-07-11-onchain-research-escrow-regression-matrix.md` 覆盖 funding UI disabled legacy start、mock demo、历史/detail/stream、follow-up、dashboard history/stat panels、quota reserved UI 与 tx-log/detail truthfulness；目标测试为 15 files / 163 tests。

Blocked 场景：

- `Escrow prepare 与非零资助`、`buyer 看清授权后签署激活`、`钱包、会话或网络中途变化`、`funding 流程重载恢复` 的真实钱包/RPC/Explorer UI E2E blocked：14.3/14.4 未执行。
- `查看完成报告` 与 `查看 funding 或人工恢复状态` 中真实 settlement/close Explorer 证据 blocked：13.3–13.6 与 14.3 未执行。
- dashboard 与首页 stats 的本地 regression 已由 14.5 覆盖；真实生产 backend 切流、钱包/RPC/Explorer E2E 与回滚演练仍 blocked：14.2–14.4、14.9 未执行。

结论：组件、路由测试与 14.5 本地回归 covered/partial；真实浏览器/钱包/E2E/生产切流/rollback blocked。

## 明确 blocked 清单

以下未完成任务直接阻塞本报告把任何 spec 判定为完全 covered：

- 13.1：未针对部署、source 登记、角色 grant/revoke/移交或 test USDC 支出逐次列明目标链、地址、角色、预计交易和资金影响并重新取得明确授权。
- 13.2：未在获授权后确认 clean Git commit、compiler settings、deployer 余额、Factory/Registry Safe、source payout、funding signer、intent signer、settler、官方 USDC 和 RPC。
- 13.3：未在 chainId 5042002 部署 Registry、锁定 implementation、Factory；无成功 receipt/block/code hash。
- 13.4：未完成 Explorer exact-match source/ABI 验证、bindFactory、source 登记、角色移交/deployer 撤权与 finalized block 复核。
- 13.5：未授权/执行 direct EOA buyer test USDC smoke；无六位合约差额、18 位 native/gas 公式、两类 emitter Transfer 去重、摘要和退款证据。
- 13.6：未执行独立公开 RPC verifier 复核地址、角色、`3 + R`、settled 数量与 smoke。
- 14.2：未先部署 DB expand/backfill、durable worker 与监控，未开启 funding UI，也未小流量切换 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow`。
- 14.3：未运行成功 E2E：prepare/quota、非零资助、激活、最多三次 intent、报告先完成、异步真实 USDC settlement、TX feed、close/refund/excess recovery。
- 14.4：未运行失败 E2E：拒签/账户变化、错误网络、funding_expired、短 TTL、Registry revision 变化、runner/worker 崩溃、RPC 不确定、DB 确认失败和到期退出。
- 14.7：本报告仍只能给出 partial/blocked 结论，不能勾选自身完成。
- 14.8：当前本地 Graphify 已重建（`1189 nodes` / `2573 edges` / `39 communities detected`），可作为影响图阅读证据；`final-evidence-publication-gate.mjs` 也已覆盖最终 manifest/docs/verifier/Graphify/core address/count/final evidence flags 的本地一致性门禁。但最终地址、最终 commit、manifest、verifier 的最终部署引用仍缺少真实链上证据，因此 14.8 仍未完成，不能勾选。
- 14.9：未执行回滚演练：停止新 voucher/activation、切回 calldata/mock、验证已 Funded 可取消、已 Active 仍由 durable worker 结算关闭或最终到期退出。

已覆盖但不解除上述阻塞：

- 14.1：`docs/contracts/onchain-research-escrow.md` 与 `contracts/scripts/deployment-docs.node-test.mjs` 已覆盖文档/runbook。
- 14.5：`docs/plans/2026-07-11-onchain-research-escrow-regression-matrix.md` 已覆盖本地回归矩阵，目标测试 15 files / 163 tests；这不是真实链上 E2E、smoke 或 rollback 演练。

## 建议

1. 不勾选 14.7；保持 `tasks.md` 原状。
2. 先完成或明确豁免 13.1–13.6、14.2–14.4、14.8–14.9，否则六份 spec 的真实链上、生产切流、E2E 和 rollback 场景无法从 partial/blocked 升级为 covered；14.7 自身在这些阻塞解除前不得勾选。
3. 在真实部署/E2E 完成后重新运行本报告中的核验路径，并追加：
   - 最终 `deployments/5042002.json`；
   - Explorer exact-match URL/状态；
   - public RPC verifier 报告；
   - test USDC smoke 证据；
   - 14.2–14.4 与 14.9 命令、环境、结果和失败/重试记录。
