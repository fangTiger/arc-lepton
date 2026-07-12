# On-chain Research Escrow：FundingVoucher RED 测试计划

## 范围

Task 4.2 只增加 FundingVoucher 校验的 RED 测试，不实现 `ResearchEscrowFactory` 或 `ResearchEscrow`。

## 测试文件

新增 `contracts/test/unit/factory/ResearchEscrowFactoryFundingVoucher.t.sol`。

测试使用 `ResearchEscrowFactoryFundingHarness is ResearchEscrowFactory` 暴露未来内部 `_consumeFundingVoucher(...)`，但 harness 从 `msg.sender` 读取 caller 后再传入内部函数，避免用测试参数绕过 `msg.sender == voucher.buyer` 语义。4.2 只覆盖 voucher 校验与 nonce 消费，不提前进入真实 `transferFrom` 或 clone 创建；真实资助路径由 4.3/4.4 继续补 RED。

## 覆盖点

- Registry 未反向绑定当前 Factory 时拒绝 FundingVoucher。
- deployment key 仍持有 Factory 或 Registry `DEFAULT_ADMIN_ROLE` 时拒绝 funding。
- deployment key 已从 Factory/Registry 均撤权后，有效 voucher 可以被消费并返回 `budgetUnits`。
- `caller` 必须等于 voucher buyer。
- Funding signer 必须持有 `FUNDING_SIGNER_ROLE`，且不能被复用为 intent signer。
- Factory grant 路径必须拒绝同一账户同时持有 `FUNDING_SIGNER_ROLE` 与 `INTENT_SIGNER_ROLE`。
- intent signer 必须是持有且只持有 `INTENT_SIGNER_ROLE` 的独立 EOA。
- `fundingDeadline` 过期时拒绝。
- `expectedExpiresAt` 必须满足 Factory `MIN_ESCROW_TTL`。
- voucher nonce 只能消费一次，重放必须回滚。

## RED 预期

当前仓库尚未提供 `contracts/src/factory/ResearchEscrowFactory.sol` 与 `contracts/src/escrow/ResearchEscrow.sol`，因此聚焦测试应失败在缺少未来目标合约/接口，而不是 Solidity 语法错误。后续 4.5/4.6 实现 Factory/Escrow 与 voucher 消费路径后，该测试应转绿。
