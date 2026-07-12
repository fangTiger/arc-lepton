# On-chain Research Escrow：DataSourceRegistry 绑定与 source RED 测试计划

## 目标

Task 3.1 先写 DataSourceRegistry 的 RED 测试，覆盖官方 USDC 常量、一次性 bindFactory、Factory code/wiring 校验、绑定前禁写，以及 source revision/config/event。

## 范围

- 新增 `contracts/test/unit/registry/DataSourceRegistryBinding.t.sol`。
- 不新增 `contracts/src/registry/DataSourceRegistry.sol` 实现。
- 测试内提供最小 `MockResearchEscrowFactory`，只用于验证 `registry()` 与 `usdc()` readback。

## RED 预期

Foundry 聚焦测试应失败于缺少 `src/registry/DataSourceRegistry.sol`。后续 Task 3.3 实现 Registry 后，3.1/3.2 测试应一起转绿。

## 接口草案

- constructor：`DataSourceRegistry(address initialAdmin)`，内部固定 Arc Testnet 官方 USDC `0x3600000000000000000000000000000000000000`。
- read：
  - `usdc()`
  - `factory()`
  - `getSource(bytes32 sourceId) -> (uint64 revision, address payout, uint256 maxUnitPrice, bool active)`
- write：
  - `bindFactory(address factory)`
  - `createSource(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active)`
  - `updateSource(bytes32 sourceId, address payout, uint256 maxUnitPrice, bool active)`
- roles/events：
  - `SOURCE_ADMIN_ROLE()`
  - `FactoryBound(address indexed factory)`
  - `SourceConfigured(bytes32 indexed sourceId,uint64 indexed revision,address payout,uint256 maxUnitPrice,bool active)`
