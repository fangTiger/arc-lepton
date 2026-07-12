# Onchain Research Escrow 13.5 smoke_usdc_spend readiness

日期：2026-07-11

范围：OpenSpec change `onchain-research-escrow` 的 13.5：

> 经独立 test USDC 授权后，用 direct EOA buyer（无 AA/paymaster）执行 smoke；记录六位合约差额、18 位 native/gas/`*10^12` 公式、两类 emitter Transfer 去重、摘要和退款。

## 总结论

13.5 仍 pending。

本文档只是一份本地 readiness 清单，用于把 `smoke_usdc_spend` 阶段的授权范围、资金影响、执行顺序和证据边界整理清楚。当前没有执行任何外部写入：未执行 approve、createAndFund、activate、settleBatch 或 close/refund；未广播交易；未读取私钥；未花费 test USDC。

`smoke_usdc_spend` 必须在 13.3 核心合约真实部署、13.4 source/roles/exact-match 真实配置与移交完成并从 finalized block 复核后，另行取得独立 test USDC 授权。部署授权或配置/角色授权不得替代 test USDC 花费授权。授权请求必须展示 chainId 5042002、目标 commit、buyer、payout、Factory、USDC、Escrow、approve → createAndFund → activate → settleBatch → close 的交易顺序、每步预计 gas、每步最大 test USDC 影响、总 `maxUsdcUnits`、requestDigest 与失败/重试后需要重新授权的条件。

authorization package、handoff、briefing、requestDigest 不是授权记录。它们只能帮助整理公开确认材料，不能替代用户对 `smoke_usdc_spend` 的明确回复，不能替代 13.5 真实 test USDC smoke，不能替代最终 manifest、Explorer 证据、公开 RPC verifier 或 finalized block 读回。用户未回应或模糊同意必须停止；request/commit/address/buyer/payout/gas/maxUsdcUnits 变化必须重新授权。

## 必须展示给用户的授权范围

请求 `smoke_usdc_spend` 授权前，至少列出：

1. chainId `5042002`、当前 clean commit、最终 `deployments/5042002.json` 候选 digest、13.6 verifier 输入路径和当前 finalized block 取证计划。
2. buyer、payout、Factory、USDC、Escrow、Registry、implementation，以及 deployer、Factory governance、Registry governance、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER 的公开地址摘要。
3. direct EOA buyer 边界：`tx.from == buyer`，buyer 是实际 gas payer，无 AA/paymaster、无 sponsorship、无代付。
4. 交易顺序：approve → createAndFund → activate → settleBatch → close；每一步的目标合约、calldata 摘要、预计 gas、最大 USDC units 影响和失败后是否需要重新授权。
5. 资金上限：总 `maxUsdcUnits`、funding budgetUnits、settlement amountUnits、expected refund/excess 规则，以及 close/refund 只能把余额退给 buyer。
6. 证据要求：六位合约差额、18 位 native/gas、`nativeDelta18-gas18=budgetUnits6*10^12`、两类 emitter Transfer 去重、settlementResultDigest、finalLiabilityHash、close/refund 摘要、Factory child lineage、Registry revision/payout/maxUnitPrice。

## 真实 13.5 smoke 执行后才可勾选的证据

13.5 只有在独立授权后真实执行并保存以下公开可复核证据时才能勾选：

1. approve receipt 与 allowance/balance 读回，证明 buyer 授权范围不超过本次授权。
2. createAndFund receipt、Factory event、USDC Transfer、clone runtime、Funded 状态、spent=0、initialBudget=budgetUnits。
3. direct EOA buyer 的外部 native balance 证据：`nativeDelta18-gas18=budgetUnits6*10^12`，且 gas 仅来自 receipt `gasUsed*effectiveGasPrice`。
4. buyer-signed activation 的 EIP-712 digest、恢复地址、nonce/deadline、Active 状态和固化 intent signer。
5. intent-signed + settler-submitted settlement 的 Registry revision/config、result summary、六位合约差额、payout 精确入账和 requestKey/settlementKey 防重证据。
6. close/refund 的 CloseAuthorization、finalLiabilityHash、budgetRefund/excessRefund、Escrow 余额清零、buyer 精确收款。
7. 官方 USDC 6 位 emitter 与 Arc native system emitter 18 位 Transfer 的两类 emitter Transfer 去重报告；不得双计，也不得直接混比 6 位与 18 位。
8. 全部 txHash、blockNumber、blockHash、logIndex、finalized block 读回、manifest smoke 定位和 13.6 独立公开 RPC verifier 成功结果。

## 当前仍缺

- 未取得 `smoke_usdc_spend` 的独立 test USDC 授权。
- 13.3 与 13.4 仍未完成，尚无真实核心地址、source/roles/exact-match、role graph 或 finalized source readback。
- 没有真实 approve、createAndFund、activate、settleBatch、close/refund 交易。
- 没有 direct EOA buyer 的 native gas 公式、六位合约差额、18 位 native/gas、两类 emitter Transfer 去重、settlement 摘要或退款证据。
- 没有最终 `deployments/5042002.json` manifest 和 13.6 public RPC verifier 成功结果。

因此本文件不改变 `openspec/changes/onchain-research-escrow/tasks.md`；13.5 保持未完成。
