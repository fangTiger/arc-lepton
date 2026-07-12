#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from '@vercel/postgres'

const JOURNAL_TABLE_NAME = 'arc_migration_journal'
const ADVISORY_LOCK_KEY = 50_420_020_704

const scriptDir = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(scriptDir, '..')
const planPaths = [
  resolve(rootDir, 'lib/db/migrations/escrow-expand-plan.json'),
  resolve(rootDir, 'lib/db/migrations/escrow-backfill-plan.json'),
]
const plans = await Promise.all(planPaths.map(async (planPath) => JSON.parse(await readFile(planPath, 'utf8'))))
const dryRun = process.argv.includes('--dry-run')
const direction = process.argv.includes('--down') ? 'down' : 'up'

syncVercelPostgresEnv()

if (dryRun) {
  for (const statement of plannedStatements(plans, direction)) {
    console.log(statement)
  }
  process.exit(0)
}
if (direction === 'down') {
  throw new Error('Downgrade execution is disabled; rerun with --down --dry-run to inspect the downgrade plan')
}

const executor = {
  query(text, params = []) {
    return sql.query(text, params)
  },
}

await runDbMigrations(executor, plans, ADVISORY_LOCK_KEY)

function plannedStatements(migrations, direction) {
  const ordered = direction === 'up' ? migrations : [...migrations].reverse()
  return ordered.flatMap((migration) => direction === 'up' ? migration.upSql : (migration.downSql ?? []))
}

async function runDbMigrations(client, migrations, lockKey) {
  await client.query(createJournalTableSql())
  const lockResult = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [lockKey])
  if (!lockResult.rows?.[0]?.locked) {
    throw new Error(`Database migration lock ${lockKey} is already held`)
  }

  try {
    for (const migration of migrations) {
      const existing = await client.query(
        `SELECT status, checksum FROM ${JOURNAL_TABLE_NAME} WHERE id = $1`,
        [migration.id],
      )
      const row = existing.rows?.[0]
      if (row?.status === 'applied') {
        if (row.checksum !== migration.checksum) {
          throw new Error(`Migration ${migration.id} checksum mismatch`)
        }
        console.log(`skip ${migration.id}`)
        continue
      }

      await client.query(
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

      try {
        for (const statement of migration.upSql) {
          await client.query(statement)
        }
        await client.query(
          `UPDATE ${JOURNAL_TABLE_NAME}
           SET status = $2, finished_at = now(), error_message = NULL, updated_at = now()
           WHERE id = $1`,
          [migration.id, 'applied'],
        )
        console.log(`applied ${migration.id}`)
      } catch (error) {
        await client.query(
          `UPDATE ${JOURNAL_TABLE_NAME}
           SET status = 'failed', finished_at = now(), error_message = $2, updated_at = now()
           WHERE id = $1`,
          [migration.id, error instanceof Error ? error.message : String(error)],
        )
        throw error
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1) AS unlocked', [lockKey])
  }
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

function syncVercelPostgresEnv() {
  if (!process.env.POSTGRES_URL?.trim() && process.env.DATABASE_URL?.trim()) {
    process.env.POSTGRES_URL = process.env.DATABASE_URL
  }
}
