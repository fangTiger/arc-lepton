# On-chain Research Escrow：DataSourceRegistry 参数与 revision RED 测试计划

## 目标

Task 3.2 补齐 Registry 参数、权限和 revision 边界 RED 测试，覆盖零值、重复新建、缺失更新、越权、停用后不可删除复用，以及 revision overflow。

## 范围

- 新增 `contracts/test/unit/registry/DataSourceRegistryValidation.t.sol`。
- 不新增 `contracts/src/registry/DataSourceRegistry.sol` 实现。
- 测试内提供 `DataSourceRegistryHarness`，仅用于把 source revision 设置到 `type(uint64).max` 后验证 update fail closed。

## RED 预期

Foundry 聚焦测试应失败于缺少 `src/registry/DataSourceRegistry.sol`。Task 3.3 实现 Registry 时必须让 3.1 与 3.2 一起转绿。
