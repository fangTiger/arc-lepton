# Onchain Research Escrow 13.6 final public RPC verifier readiness

日期：2026-07-13

范围：OpenSpec change `onchain-research-escrow` 的 13.6：

> 独立 verifier 仅凭公开 RPC、权威 USDC 配置和 manifest 复核全部地址、角色、`3 + R`、settled 数量与 smoke；任一不一致不得发布证据。

## 总结论

13.6 已通过。

最终 manifest、公开 RPC verifier 报告和 digest 已生成并互相对齐：

- manifest：`deployments/5042002.json`
- manifest cache copy：`cache/deployment-candidates/2026-07-13T01-18-06-735Z/final-deployment-manifest.json`
- verifier report：`cache/deployment-candidates/2026-07-13T01-18-06-735Z/final-public-verifier-report.json`
- digest：`cache/deployment-candidates/2026-07-13T01-18-06-735Z/final-deployment-manifest-digest.json`
- manifestDigest：`2b403150a6564bdf1b754f194de1512a1867e6e3590d5cef54487edac07ddf2d`
- blockTag：`0x313a284`
- finalizedBlockNumber：`51618436`
- verifierStatus：`passed`

## 13.6 verifier 已复核的公开事实

独立公开 RPC verifier 仅凭公开 RPC、权威 USDC 配置和 manifest 复核：

1. chainId `5042002`、权威 USDC `0x3600000000000000000000000000000000000000`、native emitter `0xfffffffffffffffffffffffffffffffffffffffe` 和 decimals=6。
2. 三个核心合约：Registry `0x98C9ff2110843186F5fa55F5B0af010ECa0bF0d3`、ResearchEscrow implementation `0x0995d09B27681B02651De3936f46245832c5d712`、ResearchEscrowFactory `0x352B064d831f1eE8a6005A186971011fa0c5f8Dd` 的 code/runtime hash。
3. Registry/Factory wiring：Factory implementation/registry/USDC/initialDeployer，Registry factory/USDC。
4. 角色 members/count/admin graph：Factory/Registry DEFAULT_ADMIN、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER，deployer 零权限，intentSigner 为 EOA 且角色互斥。
5. source revision/payout/maxUnitPrice/active 与 role graph grant/revoke replay。
6. `3 + R` 拓扑：coreContracts=3、researchCloneR=1、totalProjectContracts=4、settledResearchClones=1。
7. cloneCounts：fundedCloneCount=1、settledCloneCount=1，且 `settledCloneCount <= fundedCloneCount`。
8. `smoke_usdc_spend`：Escrow `0x00457075A5989Da633410B1F7A92851313177A85` 已 closed，spent=100、budgetRefund=900、escrow USDC=0、payout received 100。

## 发布边界

- 13.6 通过只证明最终 manifest 与公开 RPC verifier 在 fixed finalized block 上一致；它不授权新的 source verify、role grant/revoke、production rollout、live E2E 或 rollback。
- 候选 briefing、authorization package、handoff、requestDigest 仍不是授权记录，也不能替代本次保存的 final manifest/verifier 证据。
- 后续若 README、`docs/contracts/`、Graphify final evidence 或 rollout 文档引用最终地址/commit，必须引用上述 manifest/report/digest，并保持 chainId、地址、clone count、role graph、source 配置和 smoke 证据一致。
- 14.2–14.4、14.7–14.9 仍需各自的 production rollout/E2E/spec audit/final docs/rollback 证据；13.6 不替代这些任务。

## 已满足的 13.6 勾选条件

- `deployments/5042002.json` 与 cache manifest 对齐。
- public verifier report status 为 `passed`。
- manifestDigest 为 `2b403150a6564bdf1b754f194de1512a1867e6e3590d5cef54487edac07ddf2d`。
- fixed finalized block 为 `0x313a284` / `51618436`。
- topology、roles、source、official USDC、clone count 与 smoke readback 均已复核。
- `openspec/changes/onchain-research-escrow/tasks.md` 中 13.6 已勾选。
