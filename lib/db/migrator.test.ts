import packageJson from '../../package.json'
import { describe, expect, it } from 'vitest'
import {
  ADVISORY_LOCK_KEY,
  JOURNAL_TABLE_NAME,
  MigrationLockUnavailableError,
  type DbMigration,
  runDbMigrations,
} from './migrator'
import { DB_MIGRATIONS } from './migrations'

type QueryCall = {
  text: string
  params: readonly unknown[]
}

class FakeMigrationClient {
  calls: QueryCall[] = []
  applied = new Map<string, string>()
  lockAvailable = true
  failOnSql?: string

  async query(text: string, params: readonly unknown[] = []) {
    this.calls.push({ text, params })

    if (text.includes('pg_try_advisory_lock')) {
      return { rows: [{ locked: this.lockAvailable }] }
    }
    if (text.includes(`FROM ${JOURNAL_TABLE_NAME}`)) {
      const id = String(params[0])
      const checksum = this.applied.get(id)
      return { rows: checksum ? [{ status: 'applied', checksum }] : [] }
    }
    if (this.failOnSql && text.includes(this.failOnSql)) {
      throw new Error('synthetic migration failure')
    }
    return { rows: [] }
  }

  texts() {
    return this.calls.map((call) => call.text)
  }
}

const migrationA: DbMigration = {
  id: '20260711_escrow_expand',
  phase: 'expand',
  checksum: 'sha256:test-a',
  description: 'test expand migration',
  upSql: [
    'ALTER TABLE research ADD COLUMN IF NOT EXISTS created_at timestamptz',
  ],
  downSql: [
    "SELECT 'manual downgrade: keep research.created_at for rollback safety'",
  ],
}

const migrationB: DbMigration = {
  id: '20260711_escrow_expand_followup',
  phase: 'expand',
  checksum: 'sha256:test-b',
  description: 'test follow-up migration',
  upSql: [
    'CREATE INDEX IF NOT EXISTS research_address_created_at_id_idx ON research(address, created_at DESC, id DESC)',
  ],
  downSql: [
    "SELECT 'manual downgrade: keep research_address_created_at_id_idx for mixed-version readers'",
  ],
}

describe('database migrator', () => {
  it('exposes a deployment command that does not use db push as the production migration path', () => {
    expect(packageJson.scripts['db:migrate']).toBe('node scripts/db-migrate.mjs')
    expect(packageJson.scripts['db:migrate']).not.toContain('drizzle-kit push')
  })

  it('wraps migrations in journal records and a single advisory lock', async () => {
    const client = new FakeMigrationClient()

    const result = await runDbMigrations(client, {
      migrations: [migrationA],
      lockKey: ADVISORY_LOCK_KEY,
    })

    expect(result.applied).toEqual(['20260711_escrow_expand'])
    expect(result.skipped).toEqual([])
    expect(client.texts()[0]).toContain(`CREATE TABLE IF NOT EXISTS ${JOURNAL_TABLE_NAME}`)
    expect(client.texts()).toContainEqual(expect.stringContaining('pg_try_advisory_lock'))
    expect(client.texts()).toContainEqual(expect.stringContaining('INSERT INTO arc_migration_journal'))
    expect(client.texts()).toContainEqual(migrationA.upSql[0])
    expect(client.texts()).toContainEqual(expect.stringContaining('status = $2'))
    expect(client.texts().at(-1)).toContain('pg_advisory_unlock')
  })

  it('skips already applied migrations when checksum matches', async () => {
    const client = new FakeMigrationClient()
    client.applied.set(migrationA.id, migrationA.checksum)

    const result = await runDbMigrations(client, {
      migrations: [migrationA],
    })

    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([migrationA.id])
    expect(client.texts()).not.toContain(migrationA.upSql[0])
  })

  it('records a failed journal entry, releases the lock, and does not continue', async () => {
    const client = new FakeMigrationClient()
    client.failOnSql = 'ALTER TABLE research'

    await expect(runDbMigrations(client, {
      migrations: [migrationA, migrationB],
    })).rejects.toThrow('synthetic migration failure')

    expect(client.texts()).toContainEqual(expect.stringContaining("status = 'failed'"))
    expect(client.texts()).not.toContain(migrationB.upSql[0])
    expect(client.texts().at(-1)).toContain('pg_advisory_unlock')
  })

  it('fails closed when another migrator owns the advisory lock', async () => {
    const client = new FakeMigrationClient()
    client.lockAvailable = false

    await expect(runDbMigrations(client, {
      migrations: [migrationA],
    })).rejects.toBeInstanceOf(MigrationLockUnavailableError)

    expect(client.texts()).not.toContain(migrationA.upSql[0])
  })

  it('runs expand migrations before backfill migrations by default', () => {
    expect(DB_MIGRATIONS.map((migration) => migration.phase)).toEqual(['expand', 'backfill'])
    expect(DB_MIGRATIONS.map((migration) => migration.id)).toEqual([
      '20260711_escrow_expand',
      '20260711_escrow_backfill',
    ])
  })

  it('dry-runs upgrades without touching the database', async () => {
    const client = new FakeMigrationClient()

    const result = await runDbMigrations(client, {
      migrations: [migrationA],
      dryRun: true,
    })

    expect(client.calls).toEqual([])
    expect(result).toMatchObject({
      applied: [],
      skipped: [],
      dryRunSql: migrationA.upSql,
    })
  })

  it('dry-runs downgrades in reverse migration order', async () => {
    const client = new FakeMigrationClient()

    const result = await runDbMigrations(client, {
      migrations: [migrationA, migrationB],
      dryRun: true,
      direction: 'down',
    })

    expect(client.calls).toEqual([])
    expect(result.dryRunSql).toEqual([
      migrationB.downSql?.[0],
      migrationA.downSql?.[0],
    ])
  })
})
