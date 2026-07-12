import { DB_MIGRATIONS } from './migrations'

export const JOURNAL_TABLE_NAME = 'arc_migration_journal'
export const ADVISORY_LOCK_KEY = 50_420_020_704

export type DbMigrationPhase = 'expand' | 'backfill' | 'switch' | 'contract'

export type DbMigration = {
  id: string
  phase: DbMigrationPhase
  checksum: string
  description: string
  upSql: readonly string[]
  downSql?: readonly string[]
}

export type MigrationQueryResult = {
  rows?: Array<Record<string, unknown>>
}

export type MigrationExecutor = {
  query(sqlText: string, params?: readonly unknown[]): Promise<MigrationQueryResult | void>
}

export type RunDbMigrationsOptions = {
  migrations?: readonly DbMigration[]
  lockKey?: number
  dryRun?: boolean
  direction?: 'up' | 'down'
}

export type RunDbMigrationsResult = {
  applied: string[]
  skipped: string[]
  dryRunSql?: readonly string[]
}

type JournalRow = {
  status?: unknown
  checksum?: unknown
}

export class MigrationLockUnavailableError extends Error {
  constructor(lockKey: number) {
    super(`Database migration lock ${lockKey} is already held`)
    this.name = 'MigrationLockUnavailableError'
  }
}

export async function runDbMigrations(
  executor: MigrationExecutor,
  options: RunDbMigrationsOptions = {},
): Promise<RunDbMigrationsResult> {
  const migrations = options.migrations ?? DB_MIGRATIONS
  const lockKey = options.lockKey ?? ADVISORY_LOCK_KEY
  const direction = options.direction ?? 'up'
  const applied: string[] = []
  const skipped: string[] = []

  if (options.dryRun) {
    return {
      applied,
      skipped,
      dryRunSql: plannedStatements(migrations, direction),
    }
  }
  if (direction === 'down') {
    throw new Error('Downgrade execution is disabled; run with dryRun to inspect downgrade SQL')
  }

  await executor.query(createJournalTableSql())
  const lockResult = await executor.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey])
  const locked = Boolean(lockResult?.rows?.[0]?.locked)
  if (!locked) throw new MigrationLockUnavailableError(lockKey)

  try {
    for (const migration of migrations) {
      const existing = await readJournalRow(executor, migration.id)
      if (existing?.status === 'applied') {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`Migration ${migration.id} was applied with checksum ${existing.checksum}, expected ${migration.checksum}`)
        }
        skipped.push(migration.id)
        continue
      }

      await markRunning(executor, migration)
      try {
        for (const statement of migration.upSql) {
          await executor.query(statement)
        }
        await markApplied(executor, migration.id)
        applied.push(migration.id)
      } catch (error) {
        await markFailed(executor, migration.id, error)
        throw error
      }
    }

    return { applied, skipped }
  } finally {
    await executor.query('SELECT pg_advisory_unlock($1) AS unlocked', [lockKey])
  }
}

function plannedStatements(migrations: readonly DbMigration[], direction: 'up' | 'down') {
  const ordered = direction === 'up' ? migrations : [...migrations].reverse()
  return ordered.flatMap((migration) => [...(direction === 'up' ? migration.upSql : migration.downSql ?? [])])
}

function createJournalTableSql() {
  return `CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE_NAME} (
    id text PRIMARY KEY,
    phase text NOT NULL,
    checksum text NOT NULL,
    description text NOT NULL,
    status text NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    error_message text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`
}

async function readJournalRow(executor: MigrationExecutor, id: string): Promise<JournalRow | null> {
  const result = await executor.query(
    `SELECT status, checksum FROM ${JOURNAL_TABLE_NAME} WHERE id = $1`,
    [id],
  )
  return (result?.rows?.[0] as JournalRow | undefined) ?? null
}

async function markRunning(executor: MigrationExecutor, migration: DbMigration) {
  await executor.query(
    `INSERT INTO ${JOURNAL_TABLE_NAME} (id, phase, checksum, description, status, attempts, started_at, updated_at)
     VALUES ($1, $2, $3, $4, 'running', 1, now(), now())
     ON CONFLICT (id) DO UPDATE SET
       phase = EXCLUDED.phase,
       checksum = EXCLUDED.checksum,
       description = EXCLUDED.description,
       status = 'running',
       attempts = ${JOURNAL_TABLE_NAME}.attempts + 1,
       started_at = now(),
       finished_at = NULL,
       error_message = NULL,
       updated_at = now()`,
    [migration.id, migration.phase, migration.checksum, migration.description],
  )
}

async function markApplied(executor: MigrationExecutor, id: string) {
  await executor.query(
    `UPDATE ${JOURNAL_TABLE_NAME}
     SET status = $2, finished_at = now(), error_message = NULL, updated_at = now()
     WHERE id = $1`,
    [id, 'applied'],
  )
}

async function markFailed(executor: MigrationExecutor, id: string, error: unknown) {
  await executor.query(
    `UPDATE ${JOURNAL_TABLE_NAME}
     SET status = 'failed', finished_at = now(), error_message = $2, updated_at = now()
     WHERE id = $1`,
    [id, error instanceof Error ? error.message : String(error)],
  )
}
