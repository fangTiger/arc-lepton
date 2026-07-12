# On-chain Research Escrow：Factory CREATE2 RED 测试计划

## 目标

Task 4.1 为 `ResearchEscrowFactory` 和 `ResearchEscrow` 的基础拓扑写 RED 测试，锁定后续实现的 clone/address/initializer 形状。

## 覆盖范围

- 固定 implementation、Registry、官方 USDC。
- `salt = keccak256(abi.encode(buyer, researchKey))`。
- `predictEscrow` 与 `_createEscrow` 后的实际 clone 地址一致。
- EIP-1167 runtime 指向固定 implementation。
- `escrowOf(buyer,researchKey)` 映射。
- 跨 buyer 同 researchKey 独立。
- 零 researchKey 拒绝。
- implementation initializer 锁。

## RED 结果

- `FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/factory/ResearchEscrowFactoryCreate2.t.sol`：失败，缺少 `ResearchEscrow.sol` 与 `ResearchEscrowFactory.sol`，符合预期。
- `FOUNDRY_OFFLINE=true forge fmt --root contracts --check`：通过。
- `git diff --check`：通过。
- `openspec validate onchain-research-escrow --strict --no-interactive`：通过。
- `openspec instructions apply --change onchain-research-escrow --json`：进度 16/107。
- Graphify 重建：316 nodes、391 edges、61 communities。

## 后续

4.2/4.3 将继续补 FundingVoucher 与 createAndFund RED；4.5/4.6 再实现 Factory/Escrow 最小逻辑并让 4.1–4.4 转绿。
