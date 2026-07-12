# On-chain Research Escrow：createAndFund RED 测试计划

## 范围

Task 4.3 只新增真实 `createAndFund(voucher, signature)` 外层调用的 RED 测试，不实现 `ResearchEscrowFactory` 或 `ResearchEscrow`。

本轮由 root 接管实现：连续三个 worker 子任务未在合理时间内落文件，为避免 loop 卡死，root 按既定计划完成 RED，并交给 reviewer 继续审查。

## 测试文件

新增 `contracts/test/unit/factory/ResearchEscrowFactoryCreateAndFund.t.sol`。

测试不再使用内部 voucher harness，而是直接期待未来公开 Factory API：

- `createAndFund(ResearchEscrowEip712.FundingVoucher calldata voucher, bytes calldata signature) returns (address escrow)`
- `predictEscrow(buyer, researchKey)`
- `escrowOf(buyer, researchKey)`

为保持 Factory 固定官方 USDC 地址的设计，测试用 Foundry `etch` 将 Mock/异常 token runtime 放到 `0x3600000000000000000000000000000000000000`，从而在本地检查 allowance、balance delta、false/revert `transferFrom` 行为。

## 覆盖点

- 成功路径：buyer 通过 `msg.sender` 调用公开 `createAndFund` 后，返回地址等于预测 clone，映射登记成功，clone 有 code，初始化字段与 voucher 一致，状态为 `Funded`。
- 成功路径必须发出 lineage/funding 事件，并在同一调用中使 buyer 与 clone 的 USDC balance delta 精确等于 `budgetUnits`。
- allowance 不足、余额不足时全交易回滚，不留下 clone code、映射、nonce 消费或余额变化；修正 allowance/balance 后同一 voucher 可成功，证明失败不消耗 nonce。
- 篡改 budget 的 voucher 必须回滚，不创建 clone 或转账；有效低/高预算的精确 sender/clone delta 由 4.4 专项覆盖。
- 已创建 clone 后，同一 voucher 重放和同 `(buyer,researchKey)` 的 top-up voucher 均回滚，不能移动更多资金。
- `transferFrom` 返回 false 或直接 revert 时，全交易回滚，不留下 clone、映射或余额变化。

## RED 预期

当前仓库尚未提供 `contracts/src/factory/ResearchEscrowFactory.sol` 与 `contracts/src/escrow/ResearchEscrow.sol`。聚焦测试应失败在缺少未来目标合约，而不是测试文件语法错误。后续 4.5/4.6 实现 Factory/Escrow 后，本测试应转绿。
