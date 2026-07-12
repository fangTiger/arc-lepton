# Onchain Research Escrow 6.2 Roles GREEN Plan

## 目标

让 6.1 RED 角色测试转绿，同时不扩大权限模型。

## 实现点

- 在 `ResearchEscrowFactory._grantRole` 的敏感角色冲突检查中增加 Registry 侧敏感角色检查：
  - Registry `DEFAULT_ADMIN_ROLE`
  - Registry `SOURCE_ADMIN_ROLE`
- 保留 constructor bootstrap 例外：deployment key 可在 Factory/Registry constructor 阶段临时同时持有两份 `DEFAULT_ADMIN_ROLE`。
- 不修改 Registry 已有检查；Registry grant 方向已经会拒绝 Factory 敏感角色成员。

## 验证

- `FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/roles/FactoryRegistryRoles.t.sol`
- `FOUNDRY_OFFLINE=true forge test --root contracts`
- `FOUNDRY_OFFLINE=true forge fmt --root contracts --check`
- `openspec validate onchain-research-escrow --strict --no-interactive`
- 修改 Solidity 后重建 Graphify。
