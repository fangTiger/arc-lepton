# On-chain Research Escrow：金额转换 RED 向量计划

## 背景

Task 2.5 先固定 Escrow 金额转换规则：数据库 scale-8 展示值进入链上前必须能精确转换为六位 ERC-20 USDC units；Arc 原生余额/gas 的 18 位单位与 ERC-20 六位单位比较时必须使用 `1 unit6 = 10^12 units18`。

## 范围

- 新增共享 fixture：`contracts/test/vectors/amount-conversions.json`。
- 新增 Solidity RED 测试：`contracts/test/unit/canonical/AmountConversions.t.sol`。
- 新增 TypeScript RED 测试：`lib/chain/amounts.test.ts`。
- 新增独立 Node verifier RED 测试：`contracts/scripts/amount-conversions.node-test.mjs`。
- 不新增 `AmountConversions.sol`、`lib/chain/amounts.ts` 或 `verify-amount-conversions.mjs` 实现。

## RED 预期

- Foundry 聚焦测试失败于缺少 `contracts/src/canonical/AmountConversions.sol`。
- Vitest fixture 用例通过，converter 用例失败于缺少 `lib/chain/amounts`。
- Node fixture 用例通过，verifier 用例失败于缺少 `contracts/scripts/verify-amount-conversions.mjs`。

## 2.6 转绿接口约束

- Solidity `AmountConversions` library：
  - `scale8ToUnits6(uint256)`
  - `units6ToScale8(uint256)`
  - `units6ToNative18(uint256)`
  - `native18ToUnits6(uint256)`
  - `native18AmountEqualsUnits6(uint256,uint256)`
- TypeScript `lib/chain/amounts.ts`：
  - `parseScale8DecimalToUnits6`
  - `scale8ToUnits6`
  - `units6ToScale8`
  - `units6ToNative18`
  - `native18ToUnits6`
  - `native18AmountEqualsUnits6`
- Node verifier：
  - `verifyAmountConversionVectors(vectors)`
