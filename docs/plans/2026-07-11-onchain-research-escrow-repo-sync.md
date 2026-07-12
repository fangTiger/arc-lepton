# Onchain Research Escrow 7.6 — repo sync and durable DB guard

## Scope

同步 Postgres 与 memory repo 在 `lib/db/index.ts` 的暴露面，并为 Escrow backend 增加 durable DB guard。Memory repo 仍可服务 mock/test/dev fallback，但生产 Escrow 路径不得在缺少 Postgres 时继续执行。

## RED

- `lib/db/index.test.ts`
  - workflow outbox memory fallback 跨 module reload 共享。
  - research event/checkpoint memory fallback 跨 module reload 共享。
  - `ARC_RESEARCH_SETTLEMENT_BACKEND=escrow` 且无 DB、非 test 环境时，durable DB guard 抛 `DURABLE_DB_REQUIRED`。
  - `calldata` 或 test 环境不触发该 guard。

## GREEN

- 更新 index fallback global 清理与测试覆盖。
- 增加 `DurableDbRequiredError`、`isEscrowSettlementBackend()`、`assertDurableDbAvailableForEscrow()`。
- 保留生产 mock/calldata fallback 的既有签名 token 兼容，实际 Escrow prepare/start 后续调用 guard。

## Out of scope

- 不实现 prepare/start escrow flow。
- 不执行真实 DB 连接或迁移。
