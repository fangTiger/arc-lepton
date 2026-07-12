# Onchain Research Escrow 7.4 — migrator / journal / advisory lock / expand migration

## Scope

为 Escrow 数据模型建立正式数据库迁移入口，不再把生产迁移依赖在 `drizzle-kit push`。本任务只做 expand 阶段：新增可空字段、表、唯一约束和索引，保持旧行可读、旧服务可写，不做 backfill/switch/contract。

## RED

- `drizzle.config.test.ts` 必须覆盖 `workflow-outbox` 与 `research-event` schema 已纳入 Drizzle migration 输入。
- `lib/db/migrator.test.ts` 必须覆盖：
  - migration journal 初始化。
  - 单实例 `pg_try_advisory_lock`。
  - 已 applied migration 可跳过。
  - migration 失败写 failed journal、释放 lock，且不继续后续 migration。
  - `package.json` 暴露 `db:migrate`，且不把 `drizzle-kit push` 当正式迁移命令。
- `lib/db/migrations/escrow-expand.test.ts` 必须覆盖：
  - expand migration 包含 research/tx_log Escrow 可空字段、workflow_outbox、research_event、research_checkpoint。
  - 包含幂等 unique/index。
  - 不包含 DROP/TRUNCATE/DELETE，不把 legacy 字段改成 NOT NULL。

## GREEN

- 增加 `DbMigration`/`runDbMigrations()`。
- 增加 `arc_migration_journal` schema SQL 与 advisory lock 常量。
- 增加 `20260711_escrow_expand` migration plan。
- 增加 `scripts/db-migrate.mjs` 作为部署命令入口。

## Out of scope

- 不执行真实数据库迁移。
- 不做 backfill/switch/contract 收紧。
- 不触链、不部署、不广播。
