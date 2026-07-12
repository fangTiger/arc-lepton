# Onchain Research Escrow 14.2–14.4 rollout/E2E readiness

## 范围与硬边界

本文档只是一份本地 readiness 清单，用于在后续获得明确分阶段授权后执行 14.2–14.4。它不替代真实 rollout/E2E，不证明生产环境、Arc Testnet 或资金流已经通过，也不得作为勾选 14.2、14.3、14.4 的依据。

当前阶段不得执行任何外部写入：不得真实 DB migration，不得真实切流，不得部署，不得 source verify，不得 grant/revoke，不得角色移交，不得 --broadcast，不得花费 test USDC。后续若进入真实执行，必须先向用户展示 chainId 5042002、commit、真实地址、预计 tx hash 或交易计划、block number 取证方式、资金影响、operator、回滚点和观测指标，并针对该阶段重新取得明确授权。

rollout/E2E 还必须先通过 13.6 独立公开 RPC verifier：最终 deployments/5042002.json manifest 必须与 exact-match source、角色读回、source 配置、smoke 和公开 RPC 复核结果一致。不得使用候选 manifest、不得使用本地模拟 verifier、不得使用 readiness 文档或本地 mock 证据替代最终公开证据；未通过 13.6 前不得开启 funding UI，未通过 13.6 前不得小流量切换 ARC_RESEARCH_SETTLEMENT_BACKEND=escrow，也不得宣称 14.2、14.3 或 14.4 已完成。

授权整理材料同样只是负授权安全材料：`deployment-authorization-package.mjs`、`deployment-authorization-handoff.md`、单阶段 briefing 和 requestDigest 只能帮助把 chain、commit、address、gas、maxUsdcUnits 与阶段边界整理给用户确认，不能替代 13.1 授权记录，不能替代 13.2 preflight 证明，不能替代 13.6 final public verifier，也不能替代 14.2–14.4 真实 rollout/E2E。用户未回应或模糊同意必须停止；request/commit/address/gas/maxUsdcUnits 变化必须重新授权。

## 14.2 rollout 顺序

授权后建议按 fail-closed 顺序推进：

1. DB expand/backfill：先执行兼容旧路径的 expand migration 与 backfill dry-run，再在授权窗口执行真实迁移；每一步都需要记录 commit、operator、开始/结束时间、影响行数、校验 SQL、回滚脚本和只读复核结果。
2. durable worker：上线 durable worker 与 outbox monitor，保持 `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` 或旧安全路径可回退；记录 worker version、queue cursor、retry policy、dead-letter 指标和 crash recovery 证据。
3. 监控：打开 funding、activation、settlement、close/refund、excess recovery、RPC finality、DB confirmation、worker lag、failed outbox、refund backlog 与链上 tx 状态监控；异常必须 fail-closed。
4. funding UI：只在 DB/worker/监控稳定后开启 funding UI feature flag，并保持小流量入口、可关闭开关和用户错误提示回退。
5. 小流量切换：最后才小流量切换 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow`；每个批次必须记录真实 chainId 5042002、公开地址、tx hash、block number、commit、资金影响和观测窗口。

回滚点必须在每一步之前确认：migration 前可停止；backfill 后可继续旧 calldata/mock；worker 上线后可停新 voucher/activation；funding UI 后可关闭 flag；小流量切换后可把 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow` 切回旧路径。任何观测指标不达标，都不得扩大流量。

## 14.3 成功 E2E 证据

真实成功 E2E 必须覆盖一条非零资助路径，并保存可独立复核的证据：

- prepare/quota：记录 request、quota 预扣、research id、escrow address、chainId 5042002、commit 和 DB 状态。
- 非零资助：记录 buyer、USDC token、amount、tx hash、block number、receipt、余额差和资金影响；不得使用零金额或模拟资金替代。
- activate：记录 funding voucher、activation digest、恢复地址、tx hash、block number 和 DB `Funded -> Active` 状态变化。
- 最多三次 intent：记录每次 intent digest、attempt、worker cursor、settlement decision；超过三次必须 fail-closed。
- 报告先完成：证明 research report 已完成并可读，然后才允许异步真实 USDC settlement。
- 异步真实 USDC settlement：记录 settlement tx hash、block number、settler、source payout、六位 USDC 差额、18 位 native/gas 公式和 DB confirmation。
- TX feed：前端/接口 TX feed 必须展示 funding、activation、settlement、close/refund/excess recovery 的公开定位。
- close/refund/excess recovery：记录 close、refund、excess recovery 的触发条件、tx hash、block number、余额差和最终 DB 状态。

这些证据必须能让 reviewer 仅凭公开 RPC、manifest、DB 只读快照和日志摘要复核；不得包含 private key、mnemonic、credentialed RPC、raw signature 或完整 secret env。

## 14.4 失败 E2E 证据

真实失败 E2E 必须逐项证明系统 fail-closed，并且不会重复花费或错结算：

- 拒签：用户拒签 funding/activation/close 时，UI 给出可恢复错误，DB 不进入错误链上状态。
- 账户变化：签名前后账户变化时，voucher/intent 失效，要求重新 prepare/quota。
- 错误网络：非 chainId 5042002 时禁止提交，不能生成可广播交易。
- funding_expired：资金窗口过期后拒绝 activate，并保留可取消/退款路径。
- 短 TTL：短 TTL voucher 到期后必须重新签发，旧签名不得复用。
- Registry revision 变化：source revision 漂移时停止 settlement，要求重新取快照或人工复核。
- runner/worker 崩溃：crash 后 outbox 不丢、不重放错账，恢复后按幂等 key 继续或进入 manual recovery。
- RPC 不确定：RPC 返回 pending、reorg、finality 不确定或读写不一致时停止发布成功证据。
- DB 确认失败：链上成功但 DB confirmation 失败时进入可审计 retry/manual recovery，不把任务误报完成。
- 到期退出：Active 或 Funded 到期后按状态执行 cancel、refund 或 expiry exit，记录 tx hash、block number 和最终余额差。

每个失败用例都必须记录真实地址、operator、commit、chainId 5042002、输入摘要、预期错误、实际错误、DB 前后状态、是否产生 tx、tx hash/block number（如有）、资金影响和回滚动作。

## 授权与完成判定

14.2 只有在真实 DB expand/backfill、durable worker、监控、funding UI、小流量 `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow` 都按授权完成并保存证据后才能勾选。

14.3 只有在成功 E2E 的 prepare/quota、非零资助、activate、最多三次 intent、报告先完成、异步真实 USDC settlement、TX feed、close/refund/excess recovery 全部有公开证据后才能勾选。

14.4 只有在拒签、账户变化、错误网络、funding_expired、短 TTL、Registry revision 变化、runner/worker 崩溃、RPC 不确定、DB 确认失败和到期退出均有失败 E2E 证据后才能勾选。

本文档不替代真实 rollout/E2E；当前只完成本地准备，不执行外部写入，也不改变 tasks 状态。
