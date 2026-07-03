## Context

当前 `recordPaymentReceipt()` 在 claim `tx_log` 后立即调用 `recordArcReceipt()`，而 `recordArcReceipt()` 在 arc 模式下会 `sendTransaction` 并等待 receipt。research agent 每执行一个本地数据工具都会走这条路径，因此一次研究里 3-5 个工具调用会带来 3-5 次链上等待。

追问 Q&A 本身不调用工具、不写 payment receipt，花费为 `0`。用户感知到的“问答慢”主要来自初次 research 生成过程中同步等待链上 receipt。

## Goals / Non-Goals

**Goals:**
- research agent 的回答主路径不等待链上确认。
- 同一次 research 的多个工具付费记录聚合成最多一笔 ARC settlement transaction。
- 保留每个工具调用的本地 `tx_log`，用于预算、审计和 UI 明细。
- UI 能真实展示 pending/confirmed/failed，并在确认后复用同一个 explorer txHash。
- settlement 失败不撤回已生成报告，但必须留下失败状态并支持补偿重试。

**Non-Goals:**
- 不改变 follow-up Q&A 为免费、无链上调用的现有行为。
- 不把直接 `/api/data/*` 付费 API 一起改为批量结算。
- 不实现真实 USDC 转账、permit 或完整 x402 协议。
- 不引入外部队列作为硬依赖；生产可后续接入队列，第一版使用 DB pending 状态作为 durable queue。

## Decisions

### Decision 1: 分离 payment intent 和 settlement

新增 research 专用 payment intent 路径：

1. 工具执行前或执行时创建 `tx_log`，状态为 `pending`。
2. 立即返回工具数据和 pending payment 信息。
3. research budget 继续按工具金额扣减，防止链上慢导致免费无限调用。
4. 报告完成后触发 settlement worker。

现有 `recordPaymentReceipt()` 可保留给直接 API；research agent 改用新的 `recordResearchPaymentIntent()` 或等价接口。

### Decision 2: 每个 research 聚合一笔 settlement receipt

settlement worker 查询同一 `address + researchId` 下未结算的 pending tx_log，构建批量 payload：

- `kind: "arc-lepton.research-settlement"`
- `version: 1`
- `buyer`
- `researchId`
- `totalAmount`
- `itemCount`
- `items`: `requestId`, `source`, `amount`
- `createdAt`

ARC 成功后，把这一批 tx_log 全部更新为 `confirmed`，共享同一个 `txHash`、`chainId`、`blockNumber`。失败时更新为 `failed` 并保存 `errorMessage`；补偿重试可以重新 claim failed/pending 批次并再次广播。

### Decision 3: 用 DB 状态作为 durable queue

第一版不依赖外部队列。`tx_log` 的 pending rows 就是待 settlement 队列。实现上需要避免并发 worker 对同一 research 重复广播：

- 增加 `payment_settlement` 表，唯一约束 `researchId` 或 `scope + address + researchId`。
- settlement row 记录 `status: pending | broadcasting | confirmed | failed`、attempts、txHash、lastError。
- worker 先原子 claim settlement row，再广播。
- 重试任务扫描 failed/pending 超时 settlement。

如果实现时想进一步收敛表结构，也可以在 `tx_log` 增加 `settlementId` 并通过唯一 settlement row 管理批次。

### Decision 4: UI 以逻辑调用和 settlement 状态共同展示

`tool_result.payment` 初始允许 `txStatus: "pending"` 且 `txHash: null`。报告可以正常完成。详情页、wallet tx-log 和 TX feed 后续查询到 confirmed 时显示 explorer 链接；多个工具调用可能显示同一 txHash，但 source/amount/requestId 仍保持逐条可见。

如果 settlement 失败，研究报告保持 completed，TX feed 显示 failed receipt，并提供错误文案。钱包 settled totals 只统计 `confirmed/mock`，research 自身 budget 消耗仍按工具调用金额记录。

## Risks / Trade-offs

- [报告已出但链上失败] → 不回滚报告，UI 显示 failed，并提供补偿重试入口或自动重试。
- [多条 tx_log 共享 txHash 造成困惑] → 明确展示为 settlement tx，并在详情中保留每条 source/amount/requestId。
- [进程退出导致后台任务丢失] → pending rows 可由下一次 worker/cron 补偿处理。
- [当前 specs 未归档到 `openspec/specs`] → 本 change 以现有 `changes/*/specs` 为基准，后续归档时需要合并到正式 specs。

## Open Questions

- settlement 失败后是否需要在 UI 暴露手动 retry 按钮，还是仅后台自动重试？
- 直接 `/api/data/*` API 是否也要在后续版本批量结算到会话级 receipt？
