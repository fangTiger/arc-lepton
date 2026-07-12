# On-chain Research Escrow：Registry 敏感 payout RED 测试计划

## 范围

Task 3.4 最初只补充 `DataSourceRegistry` 配置写入的 RED 测试；随后在 root 复核中发现 tasks 已勾选但 RED 尚未闭环，因此补齐了最小生产校验。目标是把 design 中“Registry 写入时拒绝 Factory、Registry、USDC 或其他显式协议地址作为 payout”的约束固化为可执行测试，并让 Registry 聚焦回归转绿。

## 测试覆盖

- 新增 `contracts/test/unit/registry/DataSourceRegistrySensitivePayout.t.sol`。
- 对 `createSource` 和 `updateSource` 两条配置路径分别要求拒绝以下 payout：
  - Registry 自身地址；
  - 已一次性绑定的 Factory 地址；
  - Arc Testnet 官方 USDC `0x3600000000000000000000000000000000000000`；
  - Arc native USDC system emitter `0xfffffffffffffffffffffffffffffffffffffffe`。
- 每个用例在 update 拒绝后读回 source，证明既有 revision、payout、maxUnitPrice 和 active 不被错误更新。

## RED 预期

当前 `DataSourceRegistry` 仅拒绝零地址 payout，还没有敏感 payout 检查。因此聚焦测试应失败于“预期 revert，但 createSource 接受了敏感 payout”，而不是语法、导入或 fixture 错误。

## GREEN 闭环

`DataSourceRegistry` 已增加最小敏感 payout 校验，在 `createSource` 与 `updateSource` 的共享输入校验路径中拒绝 Registry 自身、已绑定 Factory、官方 USDC 与 Arc native USDC system emitter。复核时 Registry 聚焦测试 `3 suites / 14 tests` 已通过；后续由于 4.1/4.2 RED 引入缺失未来 Factory/Escrow import，完整 Foundry 编译会暂时停在未来合约缺失，待 4.5/4.6 实现后需要再次跑全量合约测试。

## 非目标

- 不修改 Factory/Escrow。
- 不提前实现后续 5.4 的“payout 为当前任一敏感角色成员时动态拒绝”规则。
- 不部署、不广播、不配置角色、不花费 test USDC。
