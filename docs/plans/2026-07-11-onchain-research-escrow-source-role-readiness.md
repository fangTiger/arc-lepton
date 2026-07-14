# Onchain Research Escrow 13.4 source/roles/exact-match readiness

日期：2026-07-11

范围：OpenSpec change `onchain-research-escrow` 的 13.4：

> 对三个核心合约完成 exact-match source/ABI 验证，先一次性 bindFactory 并读回双向 wiring，再登记五个 source、完成角色移交/deployer撤权并从 finalized block 复核。

## 总结论

13.4 仍 pending。

本文档最初是一份本地 readiness 清单；当前已追加真实执行后的状态口径。`configure_sources_and_roles` 已在 chainId 5042002 获授权后广播并验证：一次性 bindFactory、五个 source 登记、角色 grant/revoke、deployer 撤权与 finalized block readback 已有公开证据。13.4 仍 pending 的原因只剩三个核心合约 Explorer exact-match source/ABI 尚未完成；不得把 runtime/hash verifier 或本地 readiness 当成 Explorer exact-match。

部署授权不得替代配置/角色移交授权。`configure_sources_and_roles` 必须在核心合约真实部署、地址和读回明确后单独请求；请求时必须展示五个 source 的 sourceId、payout、maxUnitPrice、active 状态、完整 role diff、grant/revoke 列表、deployer 撤权、预计 gas、chainId 5042002、目标 commit、目标地址和新的 requestDigest。

authorization package、handoff、briefing、requestDigest 不是授权记录。它们只能帮助整理公开确认材料，不能替代用户对 `configure_sources_and_roles` 的明确回复，也不能替代 Explorer exact-match source/ABI。现有配置/角色执行证据只覆盖 bindFactory、Registry/Factory 双向 wiring、五个 source 登记、grant/revoke、deployer 撤权与 finalized block 读回；后续 source verify 或任何新的外部写入仍需独立明确授权，用户未回应或模糊同意必须停止，request/commit/address/source/role/gas 变化必须重新授权。

`contracts/scripts/source-role-readiness-report.mjs` 是本地机器可读 report，用于在请求 `configure_sources_and_roles` 授权前校验公开输入是否足够展示给用户：change、chainId、stage、commit、requestDigest、三个核心地址、五个 source、完整 role diff、bindFactory/exact-match/finalized readback/manifest update 计划。该 report 会拒绝 secret-shaped 输入、approval-shaped 字段、accessor、symbol、非 JSON-like 数据和 sourceId canonical 路径之外的 raw bytes32；完整公开输入只会得到 `readyToRequestConfigureAuthorization=true` 和 `nextAction=request_configure_sources_and_roles_authorization`。它仍保持 `readyToExecuteExternalWrites=false`、`broadcastAllowed=false`、`sourceVerifyAllowed=false`、`roleChangeAllowed=false`、`taskCompleteAllowed=false`，因此不能替代 13.1 明确授权、13.2 preflight、13.4 真实 source/roles/exact-match 执行证据、最终 manifest 或 13.6 public verifier。

候选 manifest 或本地 readiness 不得替代 13.4 真实执行证据。13.4 只有在以下证据全部可公开复核时才能勾选：

1. 三个核心合约的 Explorer exact-match source/ABI 记录，且 compiler/settings/constructor args/ABI hash 与 clean commit artifact 和链上 runtime 一致。
2. 一次性 bindFactory 的交易、事件和 finalized block 读回；Registry.factory/USDC 与 Factory.registry/USDC 构成 Registry/Factory 双向 wiring。
3. 五个 source 的登记或更新交易、事件、revision、payout、maxUnitPrice、active 状态和 finalized block 读回。
4. Factory DEFAULT_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER，Registry DEFAULT_ADMIN、SOURCE_ADMIN 等完整 grant/revoke 事件、role-admin 图、成员数量和 finalized readback。
5. deployer 撤权证明：deployer 不再持有任何 DEFAULT_ADMIN、SOURCE_ADMIN、FUNDING_SIGNER、INTENT_SIGNER、SETTLER 或等价 runtime role。
6. 上述全部证据进入最终 `deployments/5042002.json` manifest，并由独立公开 RPC verifier 复核；任一缺失、不一致或不确定时，13.4 仍不得勾选。

## Fail-closed 执行顺序

授权后仍应按以下顺序执行，任一步失败都必须停止后续外部写入：

1. 复核 `deploy_core_contracts` 阶段输出：chainId、核心地址、deployment tx/block、runtime hash 与当前 requestDigest 范围一致。
2. 执行并确认一次性 bindFactory；若绑定交易、事件或读回与 manifest 候选不一致，不得继续 source 或角色操作。
3. 执行五个 source 配置；每个 source 必须有独立事件和 finalized block 读回，payout 不得与 buyer、deployer、Factory/Registry/USDC、admin、funding signer、intent signer、settler 或协议地址重叠。
4. 执行 role grant/revoke 与 deployer 撤权；完整事件重放必须与 AccessControlEnumerable/等价 readback 一致。
5. 对 Registry、ResearchEscrow implementation、ResearchEscrowFactory 执行 Explorer exact-match source/ABI 验证；similar/partial match、仅 ABI 上传或本地推断都不能通过。
6. 运行独立 verifier；只有 final manifest、Explorer exact-match、角色/source 读回和公开 RPC 事实一致，才可把该阶段证据交给 13.6 继续复核。

## 当前仍缺

- 三个核心合约的 Explorer exact-match source/ABI 记录。

## 已有证据

- `configure-stage-broadcast-summary.json` 与 `configure-stage-verification.json`：gas funding、五个 source 登记、Factory/Registry role grant/revoke、deployer 撤权、source readback、role readback 均成功。
- `final-deployment-manifest.json` / `deployments/5042002.json`：最终核心地址、role、source、`3 + R`、smoke clone 与 finalized block 证据。
- `final-public-verifier-report.json`：独立公开 RPC verifier `status=passed`，覆盖 runtime/wiring/roles/source/smoke/topology。

因此 `openspec/changes/onchain-research-escrow/tasks.md` 的 13.4 保持未完成，但缺口已从“source/roles/exact-match 全部缺失”收敛为“Explorer exact-match source/ABI 未完成”。
