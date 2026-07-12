import type { DbMigration, DbMigrationPhase } from '../migrator'
import plan from './escrow-backfill-plan.json'

export const ESCROW_BACKFILL_MIGRATION: DbMigration = {
  ...plan,
  phase: parsePhase(plan.phase),
}

const forbiddenPatterns = [
  /\bdrop\s+(table|column|index)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\bescrow_address\s*=/i,
  /\bresearch_key\s*=/i,
  /\bfunding_tx_hash\s*=/i,
  /\bactivation_tx_hash\s*=/i,
  /\bintent_signer\s*=/i,
  /\bvoucher/i,
  /\bspent_usdc\s*=/i,
  /\bamount\s*=/i,
  /\bstatus\s*=/i,
]

export function assertBackfillMigrationIsSafe(migration: DbMigration) {
  const sql = migration.upSql.join('\n')
  const matched = forbiddenPatterns.find((pattern) => pattern.test(sql))
  if (matched) {
    throw new Error(`Backfill migration ${migration.id} contains forbidden SQL matching ${matched}`)
  }
}

function parsePhase(value: string): DbMigrationPhase {
  if (value === 'expand' || value === 'backfill' || value === 'switch' || value === 'contract') return value
  throw new Error(`Unsupported migration phase: ${value}`)
}
