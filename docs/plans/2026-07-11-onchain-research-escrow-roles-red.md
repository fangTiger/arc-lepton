# Onchain Research Escrow 6.1 Roles RED Plan

## 目标

为 Factory/Registry 完整角色拓扑补 RED 测试，先证明当前实现仍缺少 Factory grant 方向的跨合约敏感角色互斥，再由 6.2 实现补齐。

## 范围

- 新增 `contracts/test/unit/roles/` 下的角色拓扑测试。
- 覆盖绑定后的 Factory/Registry role 查询、成员数量、role-admin 图。
- 覆盖 Factory governance 与 Registry governance 分离。
- 覆盖任意双敏感角色 grant 必须失败，尤其：
  - Registry grant 给已有 Factory 角色成员应失败。
  - Factory grant 给已有 Registry 角色成员应失败（当前预期 RED）。
  - 同一合约内 admin/runtime 双敏感角色应失败。

## RED 预期

当前 `DataSourceRegistry` 在绑定后会检查 Factory 角色成员，因此 Registry grant 方向大概率已通过；`ResearchEscrowFactory._grantRole` 目前只检查 Factory 内部角色，不检查 Registry DEFAULT_ADMIN/SOURCE_ADMIN，因此 “Factory grant 给 Registry 敏感角色成员” 测试应失败。

## 验证

- RED：`FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/roles/FactoryRegistryRoles.t.sol`
- 基础格式：`FOUNDRY_OFFLINE=true forge fmt --root contracts --check`
