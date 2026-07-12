# Onchain Research Escrow Processed Key RED Plan

## 目标

完成 OpenSpec `onchain-research-escrow` 任务 5.7：补齐 settlementKey/requestKey 双层防重与失败不消耗 key 的测试。

## 范围

- 修改 `contracts/test/unit/escrow/ResearchEscrowSettlement.t.sol`。
- 新增 `.devos/tasks/onchain-research-escrow-5-7/` 记录。
- 勾选 `openspec/changes/onchain-research-escrow/tasks.md` 中 5.7。

## 验证

- focused settlement Forge 测试通过。
- full Forge、build、fmt、diff、OpenSpec validate 和 Graphify 重建通过。
