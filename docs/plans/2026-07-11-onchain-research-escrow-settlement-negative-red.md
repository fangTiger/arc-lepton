# Onchain Research Escrow Settlement Negative RED Plan

## 目标

完成 OpenSpec `onchain-research-escrow` 任务 5.2：补齐 `settleBatch` 负向 RED 测试，覆盖批次、授权、角色、状态、时间窗口和预算边界。

## 范围

- 修改 `contracts/test/unit/escrow/ResearchEscrowSettlement.t.sol`。
- 新增 `.devos/tasks/onchain-research-escrow-5-2/` 记录。
- 勾选 `openspec/changes/onchain-research-escrow/tasks.md` 中 5.2。

## 验证

- 聚焦 Forge 测试保持 RED，且编译通过。
- `npm run contracts:build` 保持通过。
- `forge fmt --check`、`git diff --check`、OpenSpec strict validate 和 Graphify 重建保持通过。
