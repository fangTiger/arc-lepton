# On-chain Research Escrow：EIP-712 共享 RED 向量计划

## 背景

Task 2.3 只负责先把 FundingVoucher、ActivationAuthorization、SettlementAuthorization、CloseAuthorization 的 EIP-712 domain、canonical type string、type hash、struct hash 与最终 digest 固化为跨语言共享 RED 测试。生产编码器、签名校验和合约执行路径由 Task 2.4 及后续任务实现。

## 范围

- 新增共享 fixture：`contracts/test/vectors/eip712-vectors.json`。
- 新增 Solidity RED 测试：`contracts/test/unit/canonical/Eip712Vectors.t.sol`。
- 新增 TypeScript RED 测试：`lib/chain/eip712.test.ts`。
- 新增独立 Node verifier RED 测试：`contracts/scripts/eip712-vectors.node-test.mjs`。
- 不新增 `ResearchEscrowEip712.sol`、`lib/chain/eip712.ts` 或 `verify-eip712-vectors.mjs` 实现。

## RED 预期

- Foundry 聚焦测试应失败于缺少 `contracts/src/canonical/ResearchEscrowEip712.sol`。
- Vitest 聚焦测试中 fixture 校验应能执行，encoder 校验应失败于缺少 `lib/chain/eip712.ts`。
- Node 聚焦测试中 fixture 校验应能执行，独立 verifier 校验应失败于缺少 `contracts/scripts/verify-eip712-vectors.mjs`。

## 2.4 转绿接口约束

2.4 实现需要同时满足以下公开接口：

- Solidity `ResearchEscrowEip712` library：
  - `factoryDomainSeparator(uint256,address)`
  - `escrowDomainSeparator(uint256,address)`
  - 四类 `*TypeHash()`
  - 四类 `hash*`
  - 四类 `*Digest(uint256,address,struct)`
- TypeScript `lib/chain/eip712.ts`：
  - `deriveEip712VectorHashes(vectors)`
- Node verifier：
  - `verifyEip712Vectors(vectors)`

这些接口仅用于锁定跨语言一致性，后续合约/服务可在其上继续封装签名校验与 nonce/deadline 规则。
