# Onchain Research Escrow 14.8 Graphify/final evidence readiness

## 范围与硬边界

本文档是 14.8 本地 readiness 记录，只说明修改代码后的 Graphify 与最终部署证据引用应如何复核；它不替代真实完成，不替代 Explorer exact-match、生产 rollout/E2E 或 live rollback 证据，也不得作为这些外部任务的完成依据。14.8 仍未完成。

当前没有新的分阶段授权，因此不得执行任何外部写入：不得 --broadcast，不得 source verify，不得 role grant/revoke，不得重新部署、配置 source、移交角色、真实 manifest 发布或花费 test USDC。最终地址、最终 commit、tx hash、block、runtime/code hash 已来自授权后的真实部署和公开可复核证据，不得使用 placeholder；后续若要向 Explorer 发布源码/编译元数据，仍必须单独取得该外部发布动作的明确授权。

## Graphify 状态

本轮代码与文档修改后已重建 Graphify，并以 `graphify-out/GRAPH_REPORT.md` 作为当前本地证据。当前报告摘要为：

- `1307 nodes`
- `2754 edges`
- `47 communities detected`
- extraction: `94% EXTRACTED`

如果后续执行 `graphify query` 不可用，应降级阅读报告：先查看 `graphify-out/GRAPH_REPORT.md` 的 god nodes、community structure 与 knowledge gaps，再结合 `rg`/测试命令做人工影响检查；Graphify 失败不得阻断安全复核，但必须记录降级阅读报告的原因。

## 影响图检查范围

14.8 的影响图应至少覆盖以下路径和概念：

- deployment manifest：部署 manifest 生成、artifact hash、runtime/code hash、commit 与地址来源。
- verifier：独立 RPC verifier、manifest verifier、smoke evidence verifier 与公开 RPC 复核。
- smoke：成功 smoke、USDC 六位差额、18 位 native/gas 公式、事件去重与 close/refund/excess recovery。
- preflight：部署前 clean tree、compiler settings、deployer balance、official USDC、public RPC finalized block。
- authorization：`deploy_core_contracts`、`configure_sources_and_roles`、`smoke_usdc_spend` 三阶段授权，以及每阶段资金影响。
- authorization package/handoff：`deployment-authorization-package.mjs`、`deployment-authorization-handoff.md` 与 machine-readable safety flags，必须继续证明 `safety.broadcastAllowed = false`、`safety.authorizedStages = []`、`notAuthorizationRecord`、`notPreflightProof`、`notFinalManifestOrVerifierEvidence`、`noResponseOrAmbiguousApprovalStops` 等负授权边界；这些材料只能帮助整理用户授权请求，不能变成最终部署证据。
- readiness docs：deployment readiness、rollout/E2E readiness、rollback drill 与 spec scenario audit。
- `README`：必须引用最终 topology、地址、链、证据入口和运行/回滚边界。
- `docs/contracts`：必须引用最终部署文档、角色、source、信任边界、Explorer/公开 RPC 证据。
- `contracts/scripts`：必须与最终 deployment manifest/verifier/smoke/preflight/authorization 门禁一致。
- `openspec tasks`：必须保持未真实完成的 13.x、14.2–14.4、14.7–14.9 不误勾。

## 最终证据引用完成条件

14.8 只有在真实部署和 rollout 证据存在后才能完成。最终复核必须证明：

1. `README`、部署文档、manifest、verifier 全部引用同一组最终地址，并明确 chainId 5042002。
2. 文档和 manifest 引用同一个最终 commit，且该 commit 对应发布用 clean tree。
3. Registry、implementation、Factory、source、role、smoke clone、USDC 与 payout 地址均来自公开 RPC 或已保存 receipt，而不是 placeholder。
4. 每个 tx hash 都有对应 block、receipt、runtime/code hash 或事件证据，并能被独立 verifier 重放。
5. `3 + R` 拓扑、settled 数量、source revision、role members/count/admin graph、deployer 零权限和 official USDC 均能由 verifier 从公开 RPC 复核。
6. 授权 package/handoff 的 `safety` 负授权字段不能被移除或反转；任何最终证据不得把 package、briefing、requestDigest 或 handoff 文档解释为已授权、已 preflight 或已 final verifier 通过。
7. 若最终地址、最终 commit、tx hash、block 或 runtime/code hash 任一处缺失或互相不一致，不得勾选 14.8，不得发布完成证据。

## 敏感信息策略

本地 readiness 和最终证据都不得包含 private key、mnemonic、credentialed RPC、raw signature 或完整 secret env。允许记录公开地址、公开 tx hash、公开 block、公开 Explorer 链接和非敏感配置键名；任何需要凭证的 RPC URL 必须只以无凭证标签或脱敏环境变量名出现。

## 当前结论

当前完成 14.8 的本地 readiness 口径：Graphify 报告已经可读，影响图检查范围已经列出，`README.md`、`docs/contracts/onchain-research-escrow.md`、`deployments/5042002.json` 和 verifier/readiness 文档均指向同一 chainId `5042002`、commit `7141fae64465f44e4ebc2ce3648787e0b45c54fb`、核心地址和 smoke clone。13.4 的 Explorer exact-match、14.2–14.4 的真实 rollout/E2E、14.9 的 live rollback 仍需独立完成。
