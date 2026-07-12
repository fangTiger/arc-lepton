# Task 1.4：部署配置 fail-closed 测试计划

## 目标

为部署工具建立一个纯本地、可注入观测值的配置校验边界，先用 Node 测试制造 RED，再实现最小纯函数使其 GREEN。测试覆盖错误 chainId、零/非法地址、核心地址无 code、官方 USDC decimals 错误、可升级 implementation 和替代 token。此任务不连接 RPC、不部署合约、不生成最终 manifest。

## 设计选择

- 新增 `contracts/scripts/validate-deployment-config.node-test.mjs`，由现有 `contracts:tooling:test` glob 自动纳入。
- 新增 `contracts/scripts/validate-deployment-config.mjs`，只接收已收集的快照，不读取环境、文件、网络或 RPC。
- 快照包含：`chainId`；`deployer/registry/implementation/factory/usdc` 地址；Registry/implementation/Factory/USDC code；USDC decimals；implementation upgradeability 分类。
- chainId `5042002` 的 USDC 期望值在模块内固定为 `0x3600000000000000000000000000000000000000`，不能由输入覆盖。
- upgradeability 只接受明确的 `none`；`transparent`、`uups`、`beacon`、`erc1967` 和 `unknown` 全部 fail closed。实际 RPC slot/probe 分类属于后续 verifier 任务。
- 使用稳定的 `DeploymentConfigValidationError`、错误 code 与 path，使部署 CLI/机器报告后续可复用。

## RED

先写测试并在校验模块不存在时运行，记录 import 失败。测试表至少覆盖：

1. 错误、字符串化、缺失 chainId。
2. 五个地址字段逐个为零或非法格式。
3. Registry、implementation、Factory、USDC 的 code 逐个为空/缺失/不可判定。
4. 权威 USDC decimals 非 6、缺失或非整数。
5. implementation upgradeability 为每种可升级/unknown 分类。
6. 另一个有 code 且 decimals=6 的 token 仍因不是权威地址被拒绝。
7. 一份完整有效快照通过并返回规范化只读摘要，输入不被修改。

## GREEN 与重构

实现最小严格 schema/值校验；任一缺失、类型错误或未知状态均抛稳定错误。完成目标 Node 测试后，运行 tooling 56+、Foundry fmt/build/unit/fuzz/invariant/coverage、Slither、artifact 和 Web 回归。

## 非目标

- 不读取真实链、不判断 finalized block、不实现 manifest schema。
- 不实现 EIP-1967 storage 读取、UUPS probe、runtime hash 或 Explorer 验证；这里只验证可信读取层产出的分类。
- 不创建部署脚本、不请求授权、不广播、不配置角色、不花费 test USDC。

## 验收

- 负向用例全部精确命中预期 error code/path，正向用例通过。
- 模块无副作用、无隐式环境覆盖、无网络依赖。
- 原有合约/Web 门禁通过，锁文件和用户暂存内容不变。
- spec reviewer PASS、quality reviewer APPROVED、根代理新鲜回归后才勾选 1.4。
