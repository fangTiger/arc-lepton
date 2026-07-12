# Onchain Research Escrow 7.5 — backfill

## Scope

在 7.4 expand schema 已存在后，增加 backfill migration：为旧 research/tx_log 行补齐兼容元数据，但不制造 Escrow、签名、voucher、funding 或 activation 的事实。

## RED

- `lib/db/migrations/escrow-backfill.test.ts`
  - research.created_at 必须使用稳定 `coalesce(created_at, started_at, completed_at, prepared_at, funding_expires_at, TIMESTAMPTZ '1970-01-01T00:00:00Z')`。
  - tx_log.backend/version 必须回填 legacy 兼容值。
  - SQL 不得更新 escrowAddress、researchKey、fundingTxHash、activationTxHash、intentSigner、voucher、金额或 status。
  - SQL 不得 drop/delete/truncate。
- `lib/db/research-repo-memory.test.ts`
  - list 排序使用 createdAt + id，不依赖 nullable startedAt。
- `lib/db/research-repo-pg.test.ts`
  - PG listByAddress orderBy 使用 createdAt、id，而不是 `coalesce(startedAt, createdAt)`。
- `lib/db/migrator.test.ts`
  - 默认 migrations 顺序为 expand → backfill。

## GREEN

- 增加 `20260711_escrow_backfill` migration plan 和安全断言。
- 将 backfill plan 纳入 `DB_MIGRATIONS`，排在 expand 后。
- 调整 research list 排序为 createdAt DESC、id DESC。

## Out of scope

- 不执行真实数据库迁移。
- 不开启 switch/backend flag。
- 不收紧 NOT NULL 或删除旧字段。
