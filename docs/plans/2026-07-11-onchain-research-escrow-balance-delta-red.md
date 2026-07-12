# On-chain Research Escrow：balance delta RED 测试计划

## 范围

Task 4.4 只新增 `createAndFund` 资金差额精确性的 RED 测试，不实现 Factory/Escrow。

本轮 worker 子任务未在合理时间内落文件，root 为避免 loop 卡死接管实现，并在后续交给 reviewer 审查。

## 测试文件

新增 `contracts/test/unit/factory/ResearchEscrowFactoryBalanceDelta.t.sol`。

测试沿用 4.3 的公开 `createAndFund(voucher, signature)` 入口，但只聚焦 sender 与 clone balance delta：

- 正常 MockUSDC 成功时，buyer balance decrease 必须精确等于 voucher `budgetUnits`，clone balance increase 也必须精确等于 voucher `budgetUnits`。
- 有效低预算与高预算 voucher 均必须按各自签名 budget 精确转移，补足 4.3 reviewer 指出的 partial/over 语义边界。
- fee-on-transfer token、false-return token、reverting token 和 self-transfer-like token 均必须回滚，不留下 clone、mapping、余额或 allowance 半状态。
- 异常 token 失败后切回 MockUSDC runtime，并要求同一 voucher 成功，证明失败路径未消耗 nonce。

## RED 预期

当前仓库尚未提供未来 `ResearchEscrowFactory` 与 `ResearchEscrow`，聚焦测试应失败在缺少目标合约。后续 4.5/4.6 实现后，本测试应转绿。
