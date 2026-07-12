## 1. Payment Model And Storage

- [x] 1.1 扩展 `TxLogEntry`、memory repo、Postgres schema 和 wallet/research serializers，支持 txStatus、chainId、blockNumber、requestId、errorMessage
- [x] 1.2 先写并运行 tx_log repo RED 测试，覆盖 mock 默认状态、confirmed 字段保存、failed 字段保存
- [x] 1.3 实现 tx_log 扩展并更新相关测试 mock

## 2. ARC Receipt Service

- [x] 2.1 新增 `lib/chain/arc-receipt.test.ts` RED 测试，覆盖 payload 编码、mock 模式、arc 配置缺失、arc 成功和 arc 失败
- [x] 2.2 实现 `lib/chain/arc-receipt.ts`，复用现有 ARC chainId/RPC 配置和 `viem`，发送带 calldata 的真实交易并等待 receipt
- [x] 2.3 新增统一 payment recorder，使 `withPayment` 和 research agent 共用同一套 mock/arc/failed 语义

## 3. Payment Flow Integration

- [x] 3.1 先扩展 `withPayment` RED 测试，验证 payment ctx/headers 带 txStatus，arc 失败返回非 confirmed 错误
- [x] 3.2 修改 `lib/x402/with-payment.ts` 调用 payment recorder，并保持未登录不记账
- [x] 3.3 先扩展 `research-agent` RED 测试，验证 tool_result.payment 带 txStatus、chainId、blockNumber
- [x] 3.4 修改 `lib/agent/research-agent.ts` 使用 payment recorder，并在链上失败时标记 research failed
- [x] 3.5 先扩展 RED 测试，覆盖 `address+requestId` 原子 claim、pending 复用、跨 `source/amount/researchId` 冲突和 `withPayment` 的 409 返回
- [x] 3.6 修改 tx_log repo 和 payment recorder，要求先 claim `pending` 再广播，并把同一条记录 update 为 `confirmed/mock/failed`

## 4. UI And API Truthfulness

- [x] 4.1 先扩展 `TxFeed` 或相关 UI RED 测试，验证 confirmed/mock/failed 三种状态展示
- [x] 4.2 修改 `components/research/types.ts`、`TxFeed.tsx` 和 detail/wallet API 序列化，只有 confirmed 才展示 explorer confirmed 链接
- [x] 4.3 更新 `.env.example` 和 README，说明 `ARC_RECEIPT_MODE`、`ARC_RECORDER_PRIVATE_KEY`、`ARC_RECEIPT_TO_ADDRESS`
- [x] 4.4 补充全局 stats 混合状态回归测试，确认 pending/failed 不会污染总 calls / 总花费

## 5. Verification

- [x] 5.1 运行针对性 vitest：tx_log、arc-receipt、with-payment、research-agent、TxFeed/API tests
- [x] 5.2 运行 `pnpm typecheck`
- [x] 5.3 运行 `pnpm build`
- [x] 5.4 运行 `openspec validate real-arc-payment-receipts --strict`
- [x] 5.5 如配置了 `ARC_RECEIPT_MODE=arc` 和 recorder 私钥，运行一次 smoke 并把 explorer 可查 txHash 记录到最终说明；否则明确说明缺少私钥无法实际广播
- [x] 5.6 修改代码后运行 graphify rebuild 命令，保持项目图谱同步
