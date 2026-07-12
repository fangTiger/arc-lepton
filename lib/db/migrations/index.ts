import { ESCROW_EXPAND_MIGRATION, assertExpandMigrationIsSafe } from './escrow-expand'
import { ESCROW_BACKFILL_MIGRATION, assertBackfillMigrationIsSafe } from './escrow-backfill'

assertExpandMigrationIsSafe(ESCROW_EXPAND_MIGRATION)
assertBackfillMigrationIsSafe(ESCROW_BACKFILL_MIGRATION)

export const DB_MIGRATIONS = [
  ESCROW_EXPAND_MIGRATION,
  ESCROW_BACKFILL_MIGRATION,
] as const

export { ESCROW_EXPAND_MIGRATION, assertExpandMigrationIsSafe }
export { ESCROW_BACKFILL_MIGRATION, assertBackfillMigrationIsSafe }
