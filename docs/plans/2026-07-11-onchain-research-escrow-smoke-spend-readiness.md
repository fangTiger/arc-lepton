# Onchain Research Escrow 13.5 smoke_usdc_spend readiness

日期：2026-07-13

范围：OpenSpec change `onchain-research-escrow` 的 13.5：

> 经独立 test USDC 授权后，用 direct EOA buyer（无 AA/paymaster）执行 smoke；记录六位合约差额、18 位 native/gas/`*10^12` 公式、两类 emitter Transfer 去重、摘要和退款。

## 总结论

13.5 已完成。

用户已明确授权 `stage=smoke_usdc_spend`，授权边界为 chainId `5042002`、commit `7141fae64465f44e4ebc2ce3648787e0b45c54fb`、requestDigest `sha256:2e16a8bab60e776a8ae04f7509878143950418f1429e66c8587bb60df8962553`、estimatedGas `10000000`、maxUsdcUnits `500000`、nativeTokenTransferWei `350000000000000000`。本次 smoke 使用 direct EOA buyer，无 AA/paymaster，真实执行 approve → createAndFund → activate → settleBatch → close。

已保存的公开可复核证据：

- `cache/deployment-candidates/2026-07-13T01-18-06-735Z/smoke-stage-broadcast-summary.json`
- `cache/deployment-candidates/2026-07-13T01-18-06-735Z/smoke-stage-verification.json`
- `cache/deployment-candidates/2026-07-13T01-18-06-735Z/smoke-stage-broadcast-receipts.json`

## 已完成 smoke 结果

- Escrow：`0x00457075A5989Da633410B1F7A92851313177A85`
- identities：buyer/payout/Factory/USDC/Escrow 均由 smoke summary/verifier 记录并复核
- lifecycle：approve、createAndFund、activate、settleBatch、close/refund 全部 receipt success
- final state：closed
- spent：`100`
- budgetRefund：`900`
- escrow USDC：`0`
- payout received：`100`
- verifier `failed=[]`
- verifier checks：receipt facts、predicted escrow、escrowOf、clone code、closed state、initial budget、spent、refund、escrow empty、buyer、researchKey、active intent signer、payout settlement、source 和 roles 均为 true

## 授权与边界保留

本次完成不改变后续阶段的权限边界：

1. `smoke_usdc_spend` 授权只覆盖本次 direct EOA buyer smoke，不授权新的部署、source verify、role grant/revoke、production rollout、live E2E 或 rollback。
2. authorization package、handoff、briefing、requestDigest 不是授权记录；它们只能帮助整理公开确认材料，仍不是通用授权记录，不能跨阶段复用。
3. request/commit/address/buyer/payout/gas/maxUsdcUnits 变化必须重新授权；如发生变化，必须重新生成 requestDigest。
4. 13.5 证据可作为 13.6 final public verifier 的 smoke 输入，但不能替代 14.2–14.4 生产 rollout/E2E 或 14.9 rollback 证据。

## 已满足的 13.5 勾选条件

- 独立 test USDC 授权已记录。
- direct EOA buyer、无 AA/paymaster 边界已记录。
- approve → createAndFund → activate → settleBatch → close 真实广播并保存 receipt。
- 六位合约差额、18 位 native/gas、`nativeDelta18-gas18=budgetUnits6*10^12`、两类 emitter Transfer 去重、settlementResultDigest、finalLiabilityHash、close/refund 摘要、Factory child lineage、Registry revision/payout/maxUnitPrice 已由 smoke summary/verifier 复核。
- `openspec/changes/onchain-research-escrow/tasks.md` 中 13.5 已勾选。
