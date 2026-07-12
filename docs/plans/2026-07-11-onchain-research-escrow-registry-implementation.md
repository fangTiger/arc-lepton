# On-chain Research Escrow：DataSourceRegistry 实现计划与结果

## 背景

Task 3.1 与 3.2 已先写 Registry RED 测试，覆盖 Factory 一次性绑定、官方 USDC、source revision、权限、零值、重复创建、停用复用和 revision overflow。Task 3.3 的目标是用最小生产实现让这些测试转绿，并修复 reviewer 发现的规范缺口。

## 实现范围

- 新增 `contracts/src/registry/DataSourceRegistry.sol`。
- 固定 Arc Testnet 官方 USDC。
- 使用 `AccessControlEnumerable` 支持完整 role 成员枚举。
- 通过 `bindFactory` 建立 Registry↔Factory/USDC 双向 wiring。
- 绑定前禁止配置 `SOURCE_ADMIN_ROLE`。
- 维护 versioned source 配置并发出 `FactoryBound`、`SourceConfigured` 事件。
- 新 source 必须以 active 状态创建；停用只能通过 update 产生新 revision。
- 提供 `getSource` 只读恢复接口与 internal test harness hook。
- 绑定后授予 Registry 敏感角色时探测 Factory `hasRole`，为后续跨合约角色互斥提供基础。

## 非范围

- 不执行任何链上部署、广播或角色移交。
- 不提前实现 Factory、Escrow、FundingVoucher 或 settlement。
- 不提前实现 3.4 的 payout 协议地址拒绝。

## 验证

- `FOUNDRY_OFFLINE=true forge test --root contracts --match-path 'test/unit/registry/*.t.sol'`：10/10 通过。
- `FOUNDRY_OFFLINE=true forge fmt --root contracts --check`：通过。
- `npm run contracts:build`：通过；仅保留前序 canonical `abi.encode` lint note 与沙箱签名缓存 warning。
- `npm run contracts:test:unit`：48/48 通过。
- `npm run contracts:tooling:test`：219/219 通过。
- `npm run contracts:artifacts:check`：通过，digest `f7f8a3d43d7102603162d6e1597424638ab65a62c7a9fbd29bae79d561b643cb`。
- `git diff --check`：通过。
- `openspec validate onchain-research-escrow --strict --no-interactive`：通过。
- `openspec instructions apply --change onchain-research-escrow --json`：进度 14/107。
- Graphify 重建：316 nodes、391 edges、61 communities。

## 后续

Task 3.4 将补充 payout 为 Registry/Factory/USDC/已知协议地址时的拒绝测试和配置校验；本任务刻意不提前实现。
