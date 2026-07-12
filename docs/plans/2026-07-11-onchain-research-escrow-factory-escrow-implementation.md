# On-chain Research Escrow：Factory/Escrow 最小骨架实现

## 范围

Task 4.5 实现 `ResearchEscrow` implementation 与 `ResearchEscrowFactory` 的最小生产骨架，使 4.1 的 CREATE2、EIP-1167、initializer 锁和固定依赖测试转绿。

不在本任务内实现完整 FundingVoucher 校验、USDC `transferFrom` 或 `createAndFund` 资金路径；这些留给 4.6。

## 已实现

- `contracts/src/escrow/ResearchEscrow.sol`
  - constructor 锁定 implementation initializer。
  - clone `initialize(...)` 只能调用一次。
  - 固化 `factory/registry/usdc/buyer/researchKey/initialBudget/expectedExpiresAt/activationCutoff`。
  - create 后状态为 `EscrowState.Funded`。
- `contracts/src/factory/ResearchEscrowFactory.sol`
  - 固定 implementation、Registry、Arc Testnet 官方 USDC。
  - `saltFor` / `predictEscrow` / `escrowOf`。
  - internal `_createEscrow(...)` 使用 OpenZeppelin `Clones.cloneDeterministic` 并初始化 clone。
  - AccessControlEnumerable 运行角色与最小 creation pause。
  - Factory 内部敏感角色 grant 互斥。
  - `createAndFund(...)` 与 `_consumeFundingVoucher(...)` 仅保留明确 revert 的 ABI/stub，供 4.6 继续实现。

## 当前测试边界

- 4.1 应通过。
- 4.2 中非法 voucher/角色/时间用例大多通过；有效 voucher 消费仍因 `_consumeFundingVoucher` stub 失败，留给 4.6。
- 4.3/4.4 应编译通过并失败在 `CREATE_AND_FUND_NOT_IMPLEMENTED`，留给 4.6。
