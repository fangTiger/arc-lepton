# On-chain Research Escrow：金额转换实现计划

## 目标

Task 2.6 将 Task 2.5 的金额转换 RED 测试转绿，并保持 legacy mock/direct 支付路径兼容。

## 实现

- Solidity `AmountConversions`：
  - `scale8ToUnits6`
  - `units6ToScale8`
  - `units6ToNative18`
  - `native18ToUnits6`
  - `native18AmountEqualsUnits6`
- TypeScript `lib/chain/amounts.ts`：
  - strict decimal parser，只接受 canonical decimal string。
  - 禁止 number/float、指数、负数、截断、四舍五入。
  - uint256 overflow 在乘法前 fail closed。
- Node verifier `verify-amount-conversions.mjs`：
  - 复核共享 fixture 的合法和非法向量。

## 兼容性

不修改 `lib/db/tx-log-repo.ts` 的 legacy `decimalToUnits/unitsToDecimal`。旧 mock/direct 路径继续使用原展示/统计规则；Escrow 路径后续必须显式接入新的 strict converter。
