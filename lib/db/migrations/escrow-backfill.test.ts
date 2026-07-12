import { describe, expect, it } from 'vitest'
import {
  ESCROW_BACKFILL_MIGRATION,
  assertBackfillMigrationIsSafe,
} from './escrow-backfill'

function combinedSql() {
  return ESCROW_BACKFILL_MIGRATION.upSql.join('\n')
}

describe('escrow backfill migration plan', () => {
  it('backfills legacy research created_at with a stable timestamp rule', () => {
    const sql = combinedSql()

    expect(sql).toContain(
      "created_at = coalesce(created_at, started_at, completed_at, prepared_at, funding_expires_at, TIMESTAMPTZ '1970-01-01T00:00:00Z')",
    )
    expect(sql).toContain('WHERE created_at IS NULL')
  })

  it('backfills tx_log backend/version without inventing escrow facts', () => {
    const sql = combinedSql()

    expect(sql).toContain("backend = coalesce(backend, CASE WHEN tx_status = 'mock' THEN 'mock' ELSE 'arc' END)")
    expect(sql).toContain('version = coalesce(version, 0)')
    expect(sql).toContain('WHERE backend IS NULL OR version IS NULL')
  })

  it('rejects destructive or fact-forging SQL', () => {
    expect(() => assertBackfillMigrationIsSafe(ESCROW_BACKFILL_MIGRATION)).not.toThrow()

    const sql = combinedSql().toLowerCase()
    expect(sql).not.toMatch(/\bdrop\s+(table|column|index)\b/)
    expect(sql).not.toMatch(/\btruncate\b/)
    expect(sql).not.toMatch(/\bdelete\s+from\b/)
    expect(sql).not.toMatch(/\bescrow_address\s*=/)
    expect(sql).not.toMatch(/\bresearch_key\s*=/)
    expect(sql).not.toMatch(/\bfunding_tx_hash\s*=/)
    expect(sql).not.toMatch(/\bactivation_tx_hash\s*=/)
    expect(sql).not.toMatch(/\bintent_signer\s*=/)
    expect(sql).not.toMatch(/\bvoucher/)
    expect(sql).not.toMatch(/\bspent_usdc\s*=/)
    expect(sql).not.toMatch(/\bamount\s*=/)
    expect(sql).not.toMatch(/\bstatus\s*=/)
  })
})
