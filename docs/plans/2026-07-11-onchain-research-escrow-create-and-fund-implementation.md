# On-chain Research Escrow：FundingVoucher 与 createAndFund 实现

## 范围

Task 4.6 实现 Factory 的 FundingVoucher 验证与公开 `createAndFund` 资金路径，使 4.1–4.4 测试从 RED 转绿。

## 实现摘要

- Factory 固化 `initialDeployer()`，并在 funding 前检查 Registry 已反向绑定本 Factory，initial deployer 已从 Factory/Registry 敏感角色撤权。
- `_consumeFundingVoucher` 校验 caller、buyer、researchKey、budget、deadline、TTL、签名、intentSigner 角色隔离、buyer 非敏感身份与 nonce。
- funding signature 使用 Factory EIP-712 digest，枚举当前 `FUNDING_SIGNER_ROLE` 成员并通过 `ResearchEscrowEip712.isValidFlexibleSignature` 验证。
- `createAndFund` 使用 deterministic clone，初始化并登记 `escrowOf`，再通过官方 USDC `safeTransferFrom` 从 buyer 转入 clone。
- 转账前后分别校验 buyer 精确减少、clone 精确增加 `budgetUnits`；非标准 token、手续费 token、自转 token 或异常 token 均回滚。
- 成功交易发出 `ResearchEscrowCreated` 与 `ResearchEscrowFunded`，失败交易不留下 clone、mapping、nonce 或余额变化。

## 验证

- 4.1 CREATE2/initializer：5/5 passed。
- 4.2 FundingVoucher：12/12 passed。
- 4.3 createAndFund：7/7 passed。
- 4.4 balance delta：6/6 passed。

## 后续

4.7 开始实现 Funded→Active buyer 授权、activation nonce 与 intentSigner 固化。
