# onchain-research-escrow 14.5 本地回归矩阵

## 范围

本记录覆盖 OpenSpec `onchain-research-escrow` 任务 14.5：

- direct `/api/data/*` 在 mock receipt 与 ARC receipt 两种模式下的既有路径。
- `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` legacy 回滚路径。
- mock research 单步启动、历史 research/detail/list/stream 恢复。
- completed research follow-up，包含 escrow-bound completed research 的离线问答约束。
- 统计、配额、钱包 tx-log、research 列表和 dashboard/history UI 回归。

本记录只证明本地 mock/单元/组件/API 回归；不替代 13.x 外部链上授权/部署/source verify/test USDC smoke，也不替代 14.3 成功 E2E、14.4 失败 E2E 或 14.9 回滚演练。

## 命令

```bash
npm test -- --run 'app/api/data/mock-sources.test.ts' 'lib/x402/with-payment.test.ts' 'lib/chain/arc-receipt.test.ts' 'lib/x402/payment-recorder.test.ts' 'app/api/research/start/route.test.ts' 'app/api/research/[id]/route.test.ts' 'app/api/research/[id]/stream/route.test.ts' 'app/api/research/[id]/follow-ups/route.test.ts' 'app/api/research/route.test.ts' 'app/api/quota/route.test.ts' 'app/api/stats/global/route.test.ts' 'app/api/wallet/wallet-routes.test.ts' 'app/research/ResearchPageClient.test.tsx' 'app/research/[id]/ResearchDetailClient.test.tsx' 'app/dashboard/page.test.tsx'
```

## 结果

- 运行时间：2026-07-11 17:13:02（本地 vitest 输出）。
- 结果：`Test Files 15 passed (15)`，`Tests 163 passed (163)`。
- 外部写入：无。未部署、未广播、未 source verify、未 grant/revoke、未花费 test USDC。

## 覆盖矩阵

| 14.5 项 | 证据文件 | 覆盖点 |
| --- | --- | --- |
| direct `/api/data/*` mock receipt | `app/api/data/mock-sources.test.ts`, `lib/x402/with-payment.test.ts`, `lib/x402/payment-recorder.test.ts`, `lib/chain/arc-receipt.test.ts` | 认证、未知 source 不扣费、mock tx_log、payment headers、mock receipt 不广播 |
| direct `/api/data/*` ARC receipt | `app/api/data/mock-sources.test.ts`, `lib/x402/with-payment.test.ts`, `lib/x402/payment-recorder.test.ts`, `lib/chain/arc-receipt.test.ts` | `ARC_RECEIPT_MODE=arc`、Idempotency-Key、0-value ARC receipt、confirmed tx_log、同 scope 复用、pending claim、失败不误标成功 |
| direct 路径不受 research escrow backend 影响 | `app/api/data/mock-sources.test.ts` | `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow` 时 direct data 仍调用 legacy ARC receipt，不创建 research/outbox/escrow settlement |
| `ARC_RESEARCH_SETTLEMENT_BACKEND=calldata` legacy 回滚 | `app/api/research/start/route.test.ts`, `lib/chain/arc-receipt.test.ts`, `app/research/ResearchPageClient.test.tsx` | legacy calldata 单步 start、durable DB 可用时不走 activation、production memory fallback fail closed、research settlement calldata payload 保持旧语义、funding UI disabled 时走 legacy start |
| mock research | `app/api/research/start/route.test.ts`, `app/api/research/[id]/stream/route.test.ts`, `app/research/ResearchPageClient.test.tsx` | mock 单步 running、签名 token fallback、stream route 执行/回放/取消、无钱包 mock demo |
| 历史 research/detail/list/stream | `app/api/research/route.test.ts`, `app/api/research/[id]/route.test.ts`, `app/api/research/[id]/stream/route.test.ts`, `app/research/ResearchPageClient.test.tsx`, `app/research/[id]/ResearchDetailClient.test.tsx` | research 列表按当前用户返回 completed/funding 历史、detail 只返回同 researchId tx_log、冷启动/Last-Event-ID/terminal event 回放、completed session 恢复、TX feed 由 tx_log 物化 |
| follow-up | `app/api/research/[id]/follow-ups/route.test.ts`, `app/research/ResearchPageClient.test.tsx`, `app/research/[id]/ResearchDetailClient.test.tsx` | owned follow-up list/create、非 owner forbidden、escrow-bound completed research follow-up 不创建 payment intent、不触碰 workflow outbox/tx_log/Escrow，UI 成功/失败/历史状态 |
| 统计 | `app/api/stats/global/route.test.ts`, `app/dashboard/page.test.tsx` | public stats、pending/failed 不计入花费、持久 aggregate fallback、dashboard history/stat panels |
| 配额 | `app/api/quota/route.test.ts`, `app/api/research/start/route.test.ts`, `app/research/ResearchPageClient.test.tsx`, `app/dashboard/page.test.tsx` | quota auth、consumed/reserved/used/remaining/backend、quota exceeded 429、reserved dashboard/UI 展示 |
| 钱包 tx-log 与列表 | `app/api/wallet/wallet-routes.test.ts`, `app/api/research/route.test.ts`, `app/api/research/[id]/route.test.ts`, `app/research/[id]/ResearchDetailClient.test.tsx` | tx-log auth/list、escrow operation broadcast facts 与 reconciled payment facts 分离、billable stats 不计 failed/pending、detail receipt truthfulness |

## 明确非覆盖项

- 不覆盖 Arc Testnet 真实部署、source 登记、角色 grant/revoke/移交、source verify 或 test USDC smoke；这些仍归 13.x。
- 不覆盖真实成功 E2E：prepare/quota、非零资助、激活、真实 USDC settlement、TX feed、close/refund/excess recovery；这些仍归 14.3。
- 不覆盖真实失败 E2E：拒签、账户变化、错误网络、funding_expired、短 TTL、Registry revision 变化、runner/worker 崩溃、RPC 不确定、DB 确认失败和到期退出；这些仍归 14.4。
- 不覆盖生产回滚演练和既有 Active Escrow 后台终态化演练；这些仍归 14.9。
