# Onchain Research Escrow Settlement Keys and Recovery Plan

## 目标

完成 OpenSpec `onchain-research-escrow` 任务 5.7–5.8：锁住 settlementKey/requestKey 双层防重、失败不消耗 key、成功批次摘要和基于 indexed event + 只读接口的恢复语义。

## 范围

- 扩展 `contracts/test/unit/escrow/ResearchEscrowSettlement.t.sol`。
- 复用 5.6 已实现的 `processedSettlementKey`、`processedRequestKey` 和 `settlementResult()`。
- 新增 `.devos/tasks/onchain-research-escrow-5-8/` 记录。
- 勾选 OpenSpec task 5.8。

## 验证标准

- settlement focused Forge 测试通过，且覆盖：
  - settlementKey 成功后重放失败且余额/状态不变；
  - requestKey 跨 settlementKey 重放失败；
  - Registry snapshot 失败不消耗 settlementKey/requestKey，修正 snapshot 后可重试成功；
  - 从 clone 创建/资助/激活之前开始录制日志，校验批次/逐项事件的 indexed topics，并通过只读接口恢复摘要。
- 后续需跑 full Forge、build、fmt、diff check、OpenSpec strict validate 和 Graphify 重建。
