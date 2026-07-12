# Task 1.3：合约异常代币与身份隔离夹具实现计划

## 目标

在 `contracts/test/` 内建立后续 Factory、Escrow、结算与角色测试共用的测试夹具：6 位 MockUSDC、返回 `false` 的 token、直接回滚的 token、fee-on-transfer token、可配置重入 token，以及彼此隔离的项目身份地址。所有内容只用于测试，不进入 `contracts/src/`，不产生部署或链上写入。

## 设计边界

- 复用当前固定的 Solidity 0.8.30 与 OpenZeppelin Contracts v5.6.1，不新增依赖，不修改工具链锁文件。
- 代币夹具放在 `contracts/test/fixtures/tokens/`；角色夹具放在 `contracts/test/fixtures/RoleIsolationFixture.sol`。
- 正常与异常 token 均使用 6 位 decimals，便于后续精确余额差测试直接复用。
- 重入 token 使用可配置 target/calldata，并以内部回调锁避免 token 自身无限递归；目标回调失败时必须原样使转账失败。
- 角色夹具覆盖 deployment key、Factory admin、Registry admin、source admin、funding signer、intent signer、settler、buyer、payout，全部非零且两两不同。
- 本任务不引入签名私钥、cheatcode 或 forge-std；EIP-712 私钥与签名工具在任务 2.3/2.4 建立。

## RED

1. 先新增 token fixture 测试，分别证明：MockUSDC 为 6 位且可 mint；false token 返回 false 且不移动余额；revert token 返回可识别错误且不移动余额；fee token 造成 receiver 少收并保持可核对的 supply 变化；重入 token 在 transfer/transferFrom 中各触发一次回调、回调失败时整笔回滚。
2. 先新增角色 fixture 测试，证明九个身份全部非零且任意两者不相等。
3. 在实现文件尚不存在时运行目标测试并记录编译失败，作为 RED 证据。

## GREEN

1. 实现最小 `MockUSDC`，覆盖 `decimals()` 和测试专用 `mint()`。
2. 基于 MockUSDC 实现 false/revert/fee/reentrant 四类异常行为。
3. 实现可继承的 `RoleIsolationFixture`，只暴露测试内部常量/聚合函数。
4. 只运行目标 unit 测试直至通过，再运行全部合约 unit/fuzz/invariant、build、fmt、coverage、Slither 与 artifact consistency。

## REFACTOR 与审查

- 去除重复逻辑，保持错误类型、命名和中文注释清晰；不扩展到生产合约。
- spec reviewer 只审任务 1.3 的完整性与范围；quality reviewer 检查异常行为真实性、重入夹具可复用性、测试误绿和安全边界。
- reviewer 若提出阻塞项，交回同一 worker 修复，并由同一 reviewer 复审。

## 验收标准

- 目标 unit 测试全部通过，且 RED 证据可复核。
- 全量合约 fmt/build/unit/fuzz/invariant/coverage/Slither/artifact 门禁通过。
- 根项目 Web 测试、类型检查和构建不回归。
- `foundry.lock`、`remappings.txt`、部署脚本、RPC、密钥与链上状态均未改变。
- Graphify 在代码变更后重建，OpenSpec 任务仅在根代理独立验收后标记完成。
