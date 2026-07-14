# onchain-research-escrow 14.9 本地回滚演练报告

日期：2026-07-11

范围：OpenSpec change `onchain-research-escrow` 的任务 14.9：

> 回滚演练：停止新 voucher/activation、切回 calldata/mock；已 Funded 可取消、已 Active 仍由 durable worker 结算关闭或最终到期退出。

本报告只整理本地代码、测试与文档证据。未部署、未广播、未读取私钥、未授权或花费 test USDC，且未修改 `openspec/changes/onchain-research-escrow/tasks.md`。

## 总结论

不建议勾选 14.9。

本报告未执行部署或广播，也没有执行 source verification、role 配置、source 注册、真实回滚切流、链上退款/settlement/close 或 test USDC smoke。14.9 的 live rollback 演练必须等 13.6 独立公开 RPC verifier 通过，并具备最终 deployments/5042002.json manifest；该 manifest 必须与链上 bytecode、Factory/Implementation/Registry/Verifier/SourceRegistry 地址、roles、authorized sources、USDC 配置和 smoke tx 证据一致。候选 manifest、本地模拟 verifier、mock evidence、14.5 本地回归证据都不能替代 14.9 live rollback 证据。

授权整理材料也不能把 14.9 推进成真实回滚授权或证据：`deployment-authorization-package.mjs`、`deployment-authorization-handoff.md`、`deployment-authorization-briefing.mjs`、单阶段 briefing 和 requestDigest 只能帮助整理公开 stage、chain、commit、address、gas、maxUsdcUnits 与回滚影响，不能替代 13.1 授权记录，不能替代 13.6 final public verifier，不能替代最终 manifest/verifier，不能替代 14.9 live rollback，也不能替代真实回滚授权。用户未回应或模糊同意必须停止；request/commit/address/gas/maxUsdcUnits 变化必须重新授权。

本地测试已经证明大量组成能力存在：新 funding UI 可被关闭，legacy calldata/mock 单步路径仍可用，Funded clone 的 `cancelUnactivated()` 本地合约与 UI 路径可用，Active clone 的 settlement/close/expired refund 合约逻辑与 worker 库层 lease/manual 恢复逻辑可用。

本次补充已修复一个本地阻塞：受保护的 workflow worker 与 funding-expiry worker route 不再把 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` 解释为禁止处理既有 Escrow work。新增/改写的 route 测试已证明在 calldata rollback 下，两个 worker 入口仍会通过 worker auth 与不依赖 backend flag 的 durable DB guard，并分别调用 `processDueWorkflowOperations` 与 `handleFundingExpiry`。同时补充了 malformed JSON fail-closed 测试，避免 workflow route 把坏请求默认当作 `process_due` 执行。

但 14.9 的完整回滚演练仍不能勾选，原因是：

1. 真实环境未执行。没有在部署环境中实际停止新 voucher/activation、切回 calldata/mock，并观察既有 Funded/Active 实例的退款、settlement、close 或到期退出。
2. 本地 route 修复只证明“worker 入口不会因 backend=calldata 自行停机”；它还不能替代真实 Funded/Active clone 在回滚窗口内完成取消、settlement、close 或 expiry 的部署级证据。

## 前置条件与安全边界

- OpenSpec change：`onchain-research-escrow`。
- 当前进度：`openspec list` 显示 `100/107 tasks`，14.9 未完成。
- 本地工作树在开始前已有大量未提交/新增/删除文件；本报告只新增当前文件，避免覆盖既有改动。
- 禁止项：未执行 `forge script --broadcast`、未调用部署脚本、未触碰私钥/keystore/带凭据 RPC、未花费 test USDC、未修改运行时配置。
- Graphify：已读取 `graphify-out/GRAPH_REPORT.md`，并执行结构查询：
  - `graphify query "onchain-research-escrow rollback calldata funding_expired cancel finalizationState impact callers tests dependencies"`

## 执行命令与结果

### OpenSpec 与上下文

- `openspec list --specs`
  - 通过；列出当前 specs。
- `openspec list`
  - 通过；`onchain-research-escrow 100/107 tasks`。
- `openspec status --change onchain-research-escrow --json`
  - 通过；schema 为 `spec-driven`，repo-local。
- `openspec instructions apply --change onchain-research-escrow --json`
  - 通过；上下文文件为 proposal、六份 spec、design、tasks；14.9 仍 pending。
- `openspec validate onchain-research-escrow --strict --no-interactive`
  - 通过；输出 `Change 'onchain-research-escrow' is valid`。

### 本次本地修复 RED/GREEN

RED 命令：

```bash
npm test -- --run app/api/research/workflow/route.test.ts app/api/research/funding-expiry/route.test.ts
```

RED 结果：

- `Test Files 2 failed (2)`
- `Tests 2 failed | 9 passed (11)`
- 两个失败均为期望 `200` 但实际收到 `409`，说明当前 route 在 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` 时返回 `ESCROW_BACKEND_DISABLED`，未进入 `processDueWorkflowOperations` / `handleFundingExpiry`。

GREEN 命令：

```bash
npm test -- --run app/api/research/workflow/route.test.ts app/api/research/funding-expiry/route.test.ts lib/research/backend-config.test.ts app/api/research/start/route.test.ts app/api/research/prepare/route.test.ts app/research/ResearchPageClient.test.tsx
```

GREEN 结果：

- `Test Files 6 passed (6)`
- `Tests 79 passed (79)`

Reviewer 修复验证：

```bash
npm test -- --run lib/db/index.test.ts app/api/research/workflow/route.test.ts app/api/research/funding-expiry/route.test.ts
```

结果：

- `Test Files 3 passed (3)`
- `Tests 24 passed (24)`
- 覆盖 production + `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` + 无 durable DB 时，workflow/funding-expiry route 返回 `503 DURABLE_DB_REQUIRED` 且不调用 worker handler；同时保留 legacy calldata memory fallback 的旧 guard 语义。

OpenSpec 校验：

```bash
openspec validate onchain-research-escrow --strict --no-interactive
```

结果：`Change 'onchain-research-escrow' is valid`。

### 前后端回滚相关测试

命令：

```bash
npm test -- --run lib/research/backend-config.test.ts app/api/research/config/route.test.ts app/api/research/prepare/route.test.ts lib/research/funding-expiry.test.ts lib/research/activation-worker.test.ts lib/research/workflow-worker.test.ts app/api/research/workflow/route.test.ts app/api/research/start/route.test.ts 'app/api/research/[id]/cancel/route.test.ts' 'app/research/[id]/ResearchDetailClient.test.tsx' app/research/ResearchPageClient.test.tsx app/api/data/mock-sources.test.ts 'app/api/research/[id]/follow-ups/route.test.ts' app/api/stats/global/route.test.ts app/api/quota/route.test.ts
```

结果：

- `Test Files 15 passed (15)`
- `Tests 154 passed (154)`

覆盖到的关键点：

- `lib/research/backend-config.test.ts`：默认 `calldata`；funding UI 只有在 `backend=escrow` 且显式开启时启用；contract migration 必须等回滚窗口关闭；非法 backend fail closed。
- `app/api/research/config/route.test.ts`：公开配置 API 返回 backend/funding UI/dual-write/contract migration 状态，非法配置 fail closed。
- `app/api/research/prepare/route.test.ts`：prepare 需要稳定 Idempotency-Key；worker auth 或 funding signer 缺失时在 reservation/voucher 前 fail closed。
- `app/api/research/start/route.test.ts`：`calldata` backend 保持 legacy one-step start；`escrow` backend 拒绝 legacy one-step；Funded start 不创建第二条 running research；无效 buyer、预算、expiry、签名、链、TTL、activation window 均不会 consume quota 或创建 runner。
- `lib/research/funding-expiry.test.ts`：fundingDeadline 到达后先 reconcile ACTIVATE；pending/不确定时不 release；Active 后 consume 并恢复 RUN 或 cancelled/closing；证明未 Active 后才 `funding_expired` + release。
- `lib/research/activation-worker.test.ts`：ACTIVATE 广播前/后崩溃恢复；链上已 Active 时不重播；cancel 后 Active 会 consume reservation 但不创建 RUN，进入 closing。
- `lib/research/workflow-worker.test.ts`：ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE 的 lease、fencing、backoff、manual recovery 和 mark closed 证据门禁。
- `app/api/research/workflow/route.test.ts`：worker 鉴权、durable DB guard、SETTLE/RECONCILE wiring、manual recovery、malformed JSON fail-closed；同时证明 `backend=calldata` 时受保护 worker route 仍返回 200 并调用 `processDueWorkflowOperations` 来 drain 既有 outbox，且无 durable DB 时返回 503。
- `app/api/research/funding-expiry/route.test.ts`：worker 鉴权、durable DB guard、body validation；同时证明 `backend=calldata` 时受保护 funding-expiry route 仍返回 200 并调用 `handleFundingExpiry` 来处理既有 research，且无 durable DB 时返回 503。
- `app/research/ResearchPageClient.test.tsx`：funding UI disabled 时隐藏 Escrow funding，并走 mock/calldata legacy start；Escrow flow 的 prepare/approve/createAndFund/activation/start、拒签恢复、reload 恢复和重复点击防重。
- `app/research/[id]/ResearchDetailClient.test.tsx`：详情页区分 status/finalization/budget/address/operation evidence；Funded 时展示并广播 `cancelUnactivated()`；Active 后不再提供 Funded cancel。
- `app/api/data/mock-sources.test.ts`：即使 research escrow backend enabled，直接 `/api/data/*` ARC receipt 仍走 legacy path，不创建 Escrow settlement。
- `app/api/research/[id]/follow-ups/route.test.ts`：Escrow completed research 的 follow-up 不触碰 Escrow、不创建 intent、不推进 workflow。
- `app/api/stats/global/route.test.ts`、`app/api/quota/route.test.ts`：pending/failed 不计入 spent，quota 返回 consumed/reserved/used/remaining。

### 合约层状态机与退出路径测试

命令：

```bash
/Users/captain/.foundry/bin/forge test --root contracts --match-contract 'ResearchEscrow(Activation|Close|Settlement)'
```

结果：

- `Ran 3 test suites ... 76 tests passed, 0 failed, 0 skipped`

覆盖到的关键点：

- `ResearchEscrowActivationTest`：Funded→Active、buyer EOA/ERC-1271 activation、activation replay/cutoff 拒绝、intent signer 固化、`cancelUnactivated()` 全额退款、activation/cancel 竞态、creation pause 不阻断 Funded cancel、creation pause 阻止 activation 且不消耗 nonce。
- `ResearchEscrowSettlementTest`：Active settlement 的双授权、Registry snapshot、key 防重、结果摘要、失败不消耗 key、部署区块事件恢复、非 Active/expired/Closed 禁止 settlement。
- `ResearchEscrowCloseTest`：签名 close、空/PAID/VOID/manual liabilities、到期任意账户触发但只退 buyer、creation pause 不阻断既有 signed settlement/close/expired refund、close 失败可重试、excess recovery 只退 buyer。

## 14.9 证据映射

| 14.9 子项 | 本地证据 | 结论 |
| --- | --- | --- |
| 停止新 voucher | `backend-config` 与 config route 证明 funding UI 可关闭；prepare route 在缺少 worker auth/funding signer 时不会创建 reservation/voucher；ResearchPage 在 funding UI disabled 时不显示 Escrow funding | 本地 partial，通过配置/依赖门禁可阻断新 voucher，但未在真实部署环境演练 |
| 停止新 activation | start route 对 escrow activation 的 buyer/预算/expiry/signature/TTL/window 做 fail-closed；合约 creation pause 阻止 activation 且不消耗 nonce | 本地 partial；还缺真实“回滚时停止 activation”的环境级开关演练 |
| 切回 calldata/mock | `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` 默认/legacy one-step start 通过；ResearchPage funding disabled 时走 mock/calldata；direct `/api/data/*` 在 escrow enabled 时仍走 legacy receipt | 本地通过单元/组件层；14.5 已有本地回归证据，覆盖 direct `/api/data/*`、calldata rollback、mock/history/follow-up/stats/quota/list，但不替代真实 rollout/E2E/rollback 或真实流量切换演练 |
| Funded 可取消 | 合约 `cancelUnactivated()`、pause 不阻断 Funded cancel、activation/cancel 竞态通过；详情页 Funded 时展示并广播 cancel，Active 后隐藏 | 本地强覆盖；真实 Funded clone 退款交易未执行 |
| Active 仍由 durable worker settlement/close | workflow worker 库层覆盖 ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE，合约覆盖 signed settlement/close/expired refund，activation/funding-expiry worker 覆盖 Active 后 consume/RUN 或 cancelled/closing；本次 route 测试补充证明 `backend=calldata` 时 workflow/funding-expiry 入口仍处理既有 work | 本地 route 阻塞已修复；真实 Active clone 在回滚窗口内 settlement/close/expiry 的部署级演练仍未执行 |
| Active 最终到期退出 | 合约 `refundExpired()` 任意账户触发且只退 buyer，creation pause 不阻断 expired refund | 本地合约通过；真实 Active 到期/worker 错过 expiry 的 E2E 未执行 |

## 当前剩余缺口

### 1. 已本地修复：全局 backend flag 不再停止受保护 worker 入口

此前 `app/api/research/workflow/route.ts` 与 `app/api/research/funding-expiry/route.ts` 的行为是：

- 先读取 `getResearchBackendConfig()`；
- 如果 `settlementBackend !== 'escrow'`，返回 `{ error: 'ESCROW_BACKEND_DISABLED' }`，状态码 `409`；
- workflow 不调用 `processDueWorkflowOperations`；
- funding-expiry 不调用 `handleFundingExpiry`。

本次本地修复已移除两个受保护 worker route 的 backend early return，并把它们切换到不依赖 settlement backend 的 durable DB guard。当前保留：

- worker bearer auth；
- durable DB guard（production 无 `DATABASE_URL`/`POSTGRES_URL` 时，即使 backend 为 `calldata` 也返回 `DURABLE_DB_REQUIRED`）；
- body validation；
- workflow manual recovery audit 与 handler wiring。

对应测试已改为：

- `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` 时 workflow route 返回 200，并调用 `processDueWorkflowOperations`；
- `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` 时 funding-expiry route 返回 200，并调用 `handleFundingExpiry`。
- production + `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` + 无 durable DB 时，两个 route 均在调用 worker handler 前返回 503。
- workflow route 对 malformed JSON 返回 400，不再默认执行 `process_due`。

因此“当前代码阻塞 worker/expiry route”的本地问题已修复；但这只消除了本地代码层阻塞，不代表真实回滚演练已经发生。

### 2. 缺少真实环境回滚证据

本地测试不能替代以下真实事实：

- 真实部署环境中关闭 funding UI/prepare/start activation 后，新用户无法拿到 voucher 或提交 activation。
- `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` 或 mock 回滚后，新的 research 确实走 legacy/mock，并且统计、quota、history、follow-up 没有回归。
- 至少一个真实 Funded clone 能在回滚期间由 buyer 执行 `cancelUnactivated()` 并对账退款、quota release。
- 至少一个真实 Active clone 在回滚期间继续由 durable worker 完成 SETTLE/RECONCILE/CLOSE，或到期后 `refundExpired()` 只退 buyer。
- worker 进程、Cron/queue、DB migration、worker auth、RPC、outbox SLA 与 manual recovery 在回滚窗口内持续可用。

### 3. 上游任务仍未完成

以下任务未完成会继续阻塞 14.9 的真实性：

- 13.3–13.6：真实 Arc Testnet 部署、source/role 配置、test USDC smoke、公开 RPC verifier。
- 14.2–14.4：生产 DB/worker 切流、真实成功 E2E、真实失败 E2E 仍未执行。14.5 已有本地回归证据，覆盖 direct `/api/data/*` mock/arc、calldata rollback、mock/history/follow-up/stats/quota/list；但这些本地证据不替代真实 rollout/E2E/rollback。
- 14.7：逐 spec 场景核验仍不建议勾选。

## 真实回滚执行 Runbook

本节是进入真实环境前的执行清单，只描述未来 live rollback 演练如何安全执行；它不替代真实 14.9 live rollback 证据，也不授权任何部署、广播、配置切流或 test USDC 支出。真实执行前仍必须重新列出目标链、地址、角色、预计交易、资金影响和回滚影响，并取得当次明确授权。

### 1. 停止新 voucher 与新 activation

1. 先关闭 funding UI，使新用户不能进入 Escrow funding 流程；配置侧必须能证明 funding UI disabled 已对外生效。
2. 停止新 voucher：prepare 不再签发 FundingVoucher，也不得创建新的 quota reservation、researchKey 或 funding intent；任何仍到达 prepare 的请求必须 fail closed，并记录公开、无秘密的拒绝原因。
3. 拒绝新的 activation/start：已 Funded 但尚未 Active 的 research 不得继续提交新的 ActivationAuthorization 或 start；UI 和 API 都必须提示进入回滚窗口。
4. 不得停止既有 worker drain：上述停止动作只阻断新 voucher、新 activation/start 和新 Escrow research，不得停止已有 ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE outbox 的 worker drain。

### 2. 切回 calldata/mock 的边界

1. 切回 calldata/mock 时，核心开关为 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata`，必要时配合关闭 funding UI flag；direct `/api/data/*` 继续走既有 receipt 路径。
2. calldata/mock 回滚只影响新的 research 入口；已存在的 Funded/Active Escrow work 仍必须由 durable worker 继续 drain，直到取消、settlement/close 或到期退出完成。
3. 切换后要抽查新建 research 的 backend/version、quota consumed/reserved、history、follow-up、stats 和 tx feed，确认没有把新请求错误接入 Escrow funding。

### 3. 保持 worker 与恢复基础设施

1. worker auth 必须保持有效；workflow/funding-expiry route 仍要拒绝未授权请求。
2. durable DB 必须保持可读写；没有 durable DB 时，worker route 必须 fail closed 为 `DURABLE_DB_REQUIRED`，不能用 memory fallback 处理生产 Escrow work。
3. Cron/queue 必须继续调度 funding-expiry 和 workflow worker；暂停新入口不等于暂停队列。
4. RPC/outbox SLA 必须持续观测：记录 RPC 健康、pending tx、outbox phase、attempt、nextAttemptAt、lease owner/fence、lastError 和接近 expiresAt 的 Active Escrow。
5. 若 worker 无法判定链上/DB 事实，必须进入 manual recovery，而不是重播不确定交易或把任务标记完成。

### 4. Funded 样本观察

1. 选择至少一个真实 Funded 样本，记录 buyer、escrow、researchKey、budgetUnits、funding txHash/block/logIndex、quota reservation 和当前 activationPhase。
2. 在回滚窗口内观察 buyer 执行 `cancelUnactivated`；验收证据必须包括 txHash、receipt、Escrow state、USDC balance delta、refund recipient 和 quota release。
3. 如果 Funded 样本已过 fundingDeadline，必须先确认不存在可生效 activation；只有证明未 Active 后才允许 release quota 或保留 funding_expired 状态。
4. Funded 样本观察不得使用 mock evidence、候选 manifest 或本地 fork 结果替代真实链上 receipt。

### 5. Active 样本观察

1. 选择至少一个真实 Active 样本，记录 buyer、escrow、researchKey、initialBudget、spent、expectedExpiresAt、已有 pending intents 和 outbox operationKey。
2. 优先观察 durable worker 完成 `SETTLE/RECONCILE/CLOSE`；验收证据必须包括 settlement/close txHash、result digest、USDC Transfer、finalizationState、closed readback 和 tx feed 对账。
3. 如果 Active 样本无法在窗口内结算关闭，必须观察 expiresAt 后的 `refundExpired`，并证明只有 buyer 收到退款。
4. Active 样本不能因为切回 calldata/mock 而丢失 pending intent、重复执行工具、重复支付或跳过 close。

### 6. manual recovery 边界

1. manual recovery 只能在 operation 重试耗尽、RPC 不确定、链上/DB 证据冲突或签名/Registry mismatch 无法自动判定时使用。
2. 每次 manual recovery 必须记录操作者、原因、evidence digest、受影响 operationKey、链上定位和恢复动作。
3. manual recovery 可以 requeue 仍需执行的 operation 回到 closing；只有公开证据已证明 Escrow Closed 时，才能把 finalizationState 改为 closed。
4. manual recovery 不能伪造 closed，不能跳过公开 RPC/verifier 证据，不能把 operator 备注、候选 manifest、mock receipt 或本地测试当作真实 14.9 live rollback 证据。

## 最终建议

- 不勾选 `tasks.md` 的 14.9，保持当前 pending。
- 在真实部署/花费 test USDC 前继续停在授权门口；任何部署、配置、角色、smoke 或 rollback live 演练都必须重新取得明确授权。
- 下一步进入真实环境前，先按“真实回滚执行 Runbook”准备执行窗口、样本、监控和人工恢复责任人；runbook 通过后仍需要真实授权与真实证据。
- 完成后再跑真实 14.2–14.4 rollout/E2E 与 14.9 rollback live 演练，并把真实回滚演练命令、环境变量、日志、txHash、outbox phase、quota 状态和 Explorer/RPC 证据追加到本报告或新报告；14.5 本地回归证据只作为基础回归，不替代这些真实证据。
