# Onchain Research Escrow 6.3 Two-Key Boundary Test Plan

## 目标

补齐双钥边界显式测试，证明 governance 后续配置不能把已激活 Escrow 的 intent signer 替换成新 signer，也不能通过错误授权把 `intentSigner == msg.sender` 或持有其他敏感角色的 signer 变成有效付款/关闭路径。

## 范围

- 优先补测试，不预设生产代码一定需要改动。
- settlement 路径：
  - intent signer 直接广播 settlement 时失败；
  - mock/错误 governance 让 intent signer 同时具备 SETTLER_ROLE 时仍失败；
  - 单独 settler 泄漏没有 intent signature 时失败。
- close 路径：
  - intent signer 直接广播 close 时失败；
  - mock/错误 governance 让 intent signer 持有 Factory/Registry 敏感角色时失败；
  - 单独 settler 泄漏没有 valid close signature 时失败。
- activation freeze 已有测试，保留并引用。

## 验证

- `FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/escrow/ResearchEscrowSettlement.t.sol`
- `FOUNDRY_OFFLINE=true forge test --root contracts --match-path test/unit/escrow/ResearchEscrowClose.t.sol`
- 如测试暴露缺口，再进入 GREEN 修复。

## 执行结果

- 新增 settlement/close 双钥边界测试后，focused settlement、close、activation 测试均通过。
- 全量 `FOUNDRY_OFFLINE=true forge test --root contracts` 通过：20 suites，172 passed，0 failed。
- 新增测试已由既有合约逻辑满足，本任务不需要生产合约 GREEN 修改。
