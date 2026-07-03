## 1. Payment Intent And Settlement Model

- [x] 1.1 编写 RED 测试：research payment intent 创建 pending tx_log，不调用 ARC RPC，不要求 txHash
- [x] 1.2 扩展 tx_log 类型、memory repo、Postgres schema，支持 settlementId 或等价 settlement 关联
- [x] 1.3 新增 payment settlement repo/schema，支持按 researchId 原子 claim、确认、失败和重试扫描
- [x] 1.4 实现 research 专用 payment intent recorder，保持现有 direct API payment recorder 不破坏

## 2. Batched ARC Settlement

- [x] 2.1 编写 RED 测试：多个 pending tx_log 聚合为一笔 ARC settlement payload
- [x] 2.2 扩展 `lib/chain/arc-receipt.ts` 或新增 settlement service，支持 `arc-lepton.research-settlement` payload
- [x] 2.3 实现 settlement worker：成功后批量更新 tx_log 为 confirmed 并共享 txHash
- [x] 2.4 实现失败路径：批量更新 failed/errorMessage，并允许后续补偿重试

## 3. Research Agent Integration

- [x] 3.1 编写 RED 测试：research agent 工具调用返回 pending payment 且不等待链上 receipt
- [x] 3.2 修改 `runResearchAgent()` 使用 payment intent recorder，预算仍按工具金额扣减
- [x] 3.3 在 research 完成后触发异步 settlement，不阻塞 `final` 事件和报告保存
- [x] 3.4 补充取消/失败场景：已产生的 pending intent 应可 settlement 或按规则标记 failed

## 4. API And UI Status

- [x] 4.1 编写 RED 测试：detail/wallet API 序列化 settlement 状态和共享 txHash
- [x] 4.2 修改 `components/research/types.ts`、TX feed、detail page，展示 pending settlement、confirmed settlement、failed settlement
- [x] 4.3 确认 follow-up Q&A 不创建 payment intent、不触发 settlement，并补充回归测试
- [x] 4.4 更新 README，说明 research settlement 降频语义、pending 状态和补偿重试

## 5. Verification

- [x] 5.1 运行针对性 vitest：payment intent、settlement repo、arc settlement、research agent、follow-up、TX feed/API
- [x] 5.2 运行 `pnpm typecheck`
- [x] 5.3 运行 `pnpm build`
- [x] 5.4 运行 `openspec validate async-batched-payment-receipts --strict`
- [x] 5.5 修改代码后运行 graphify rebuild，保持项目图谱同步

## 6. Feedback Follow-up

- [x] 6.1 编写 RED 测试：模型请求超过 3 个付费工具时仅创建 3 个 pending payment intent，并为后续 tool calls 写入 `tool_call_limit_reached`
- [x] 6.2 在 system prompt 与代码层强制每次 research 默认最多 3 个付费数据源调用
- [x] 6.3 编写 RED 测试：txLog 按 requestId 覆盖 pending payment 的 settlement 终态
- [x] 6.4 在 research 页面初始加载和终态 pending 后低频同步 `/api/research/[id]` txLog
- [x] 6.5 编写 RED 测试并修复：取消后已创建 pending intent 会触发异步 settlement
- [x] 6.6 编写 RED 测试并修复：冷启动时从 txLog 物化 TX feed rows 且不重复追加 requestId
- [x] 6.7 更新创建页 estimated calls、详情页 pending 文案和 README/OpenSpec 说明
