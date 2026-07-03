## Why

`ARC_RECEIPT_MODE=arc` 现在会在每次付费数据源调用时同步发送 ARC receipt 并等待链上确认。研究问答过程中多个工具调用会串行承担 RPC/出块延迟，导致答案生成速度被链上交互放大。

## What Changes

- 将 research agent 的付费工具调用改为先记录本地 payment intent，不在回答主路径等待链上 receipt。
- 同一次 research 的多个 payment intent 聚合为一笔 ARC settlement receipt，后台异步广播并确认。
- 让 `tx_log` 支持 settlement 关联：多个逻辑付费记录可共享同一个链上 txHash/status。
- 更新 SSE、详情页和 TX feed：回答可先完成，支付状态从 `pending` 异步变为 `confirmed` 或 `failed`。
- 保持直接付费数据源 API 的现有实时 receipt 语义，除非后续单独扩展为批量结算。

## Capabilities

### Modified Capabilities

- `arc-payment-receipts`: 从“每次付费调用同步等待一笔 receipt”调整为“research 内批量异步 settlement，直接付费 API 仍可实时 receipt”。
- `research-agent-engine`: Agent 工具调用可产生 pending payment intent，并在报告完成后异步结算。

## Impact

- Affected specs: `arc-payment-receipts`, `research-agent-engine`
- Affected code: `lib/x402/*`, `lib/chain/*`, `lib/agent/*`, `lib/db/*`, `lib/db/schema/*`, `components/research/*`, `app/api/research/*`, `app/api/wallet/*`
- Runtime behavior: research 回答速度不再等待 ARC receipt；每次 research 的链上交易数从每个工具调用一笔降低到最多一笔 settlement receipt。
- Runtime config: 复用现有 ARC receipt env；新增后台 settlement 可使用进程内触发和基于 DB pending 状态的补偿重试。
