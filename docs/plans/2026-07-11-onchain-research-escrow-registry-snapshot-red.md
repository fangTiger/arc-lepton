# Onchain Research Escrow Registry Snapshot RED Plan

## 目标

完成 OpenSpec `onchain-research-escrow` 任务 5.3：补齐 settlement 对 Registry revision/payout/max/active 原子匹配的 RED 测试。

## 范围

- 修改 `contracts/test/unit/escrow/ResearchEscrowSettlement.t.sol`。
- 新增 `.devos/tasks/onchain-research-escrow-5-3/` 记录。
- 勾选 `openspec/changes/onchain-research-escrow/tasks.md` 中 5.3。

## 验证

- 聚焦 Forge 测试保持 RED，且编译通过。
- `npm run contracts:build` 保持通过。
- `forge fmt --check`、`git diff --check`、OpenSpec strict validate 和 Graphify 重建保持通过。
