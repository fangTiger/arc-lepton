# Onchain Research Escrow Event Indexing Plan

## 目标

完成 OpenSpec `onchain-research-escrow` 任务 5.8：验证 processed key、settlement summary 和事件索引恢复能力。

## 范围

- 修改 `contracts/test/unit/escrow/ResearchEscrowSettlement.t.sol`。
- 新增 `.devos/tasks/onchain-research-escrow-5-8/` 记录。
- 勾选 `openspec/changes/onchain-research-escrow/tasks.md` 中 5.8。
- 专用测试 `testDeploymentBlockLogScanRecoversSettlementSummaryFromIndexedEvents` 从创建/资助/激活之前开始记录日志，模拟从部署区块扫描混杂日志后按 Escrow emitter、batch/item indexed topics 和 data 恢复 settlement。

## 验证

- focused settlement Forge 测试通过。
- full Forge、build、fmt、diff、OpenSpec validate 和 Graphify 重建通过。
