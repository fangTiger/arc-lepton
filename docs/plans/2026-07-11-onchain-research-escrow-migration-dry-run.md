# Onchain Research Escrow 7.8 — migration dry-run and mixed-version regressions

## Scope

为 migrator 增加 upgrade/downgrade dry-run 预览能力，并补混合版本服务回归，确认列表/API 不依赖 nullable `startedAt`。

## RED

- `lib/db/migrator.test.ts`
  - dry-run upgrade 不触 DB，只返回将执行的 SQL。
  - dry-run downgrade 按 migration 逆序返回 down SQL。
- `app/api/research/route.test.ts`
  - 列表可序列化 `startedAt=null` 的 funding/mixed-version research。

## GREEN

- `DbMigration` 支持 `downSql`。
- `runDbMigrations()` 支持 `{ dryRun, direction }`。
- migration plans 填充人工安全的 dry-run downgrade 说明 SQL。

## Out of scope

- 不执行真实 downgrade。
- 不删除旧字段。
- 不收紧约束。
