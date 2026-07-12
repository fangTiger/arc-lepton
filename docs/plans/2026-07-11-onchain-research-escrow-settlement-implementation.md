# Onchain Research Escrow Settlement Implementation Plan

## 目标

完成 OpenSpec `onchain-research-escrow` 任务 5.6：实现 `settleBatch` 并让 5.1–5.5 的 settlement 测试全部通过。

## 范围

- 修改 `contracts/src/escrow/ResearchEscrow.sol`。
- 修正 `contracts/test/unit/escrow/ResearchEscrowSettlement.t.sol` 中 selector 断言和 role drift 测试细节。
- 新增 `.devos/tasks/onchain-research-escrow-5-6/` 记录。
- 勾选 `openspec/changes/onchain-research-escrow/tasks.md` 中 5.6。

## 验证

- focused settlement Forge 测试通过。
- full Forge 测试通过。
- `npm run contracts:build`、`forge fmt --check`、`git diff --check`、OpenSpec strict validate 和 Graphify 重建通过。
