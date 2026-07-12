import type { DbMigration, DbMigrationPhase } from '../migrator'
import plan from './escrow-expand-plan.json'

export const ESCROW_EXPAND_MIGRATION: DbMigration = {
  ...plan,
  phase: parsePhase(plan.phase),
}

const destructivePatterns = [
  /\bdrop\s+(table|column|index)\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+column\b[\s\S]*\bset\s+not\s+null\b/i,
]

export function assertExpandMigrationIsSafe(migration: DbMigration) {
  const sql = migration.upSql.join('\n')
  const matched = destructivePatterns.find((pattern) => pattern.test(sql))
  if (matched) {
    throw new Error(`Expand migration ${migration.id} contains destructive SQL matching ${matched}`)
  }
}

function parsePhase(value: string): DbMigrationPhase {
  if (value === 'expand' || value === 'backfill' || value === 'switch' || value === 'contract') return value
  throw new Error(`Unsupported migration phase: ${value}`)
}
