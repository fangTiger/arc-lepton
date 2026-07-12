import { describe, expect, it } from 'vitest'
import {
  ESCROW_EXPAND_MIGRATION,
  assertExpandMigrationIsSafe,
} from './escrow-expand'

function combinedSql() {
  return ESCROW_EXPAND_MIGRATION.upSql.join('\n')
}

describe('escrow expand migration plan', () => {
  it('adds only non-breaking nullable Escrow columns to legacy tables', () => {
    const sql = combinedSql()

    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS created_at timestamptz')
    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS prepared_at timestamptz')
    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS funding_expires_at timestamptz')
    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS started_at timestamptz')
    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS research_key text')
    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS expected_escrow_address text')
    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS escrow_address text')
    expect(sql).toContain('ALTER TABLE research ADD COLUMN IF NOT EXISTS runner_fencing_token integer')

    expect(sql).toContain('ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS payment_intent_id text')
    expect(sql).toContain('ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS tool_ordinal integer')
    expect(sql).toContain('ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS request_key text')
    expect(sql).toContain('ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS registry_revision text')
    expect(sql).toContain('ALTER TABLE tx_log ADD COLUMN IF NOT EXISTS escrow_address text')
  })

  it('creates durable workflow tables and idempotent indexes', () => {
    const sql = combinedSql()

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workflow_outbox')
    expect(sql).toContain('protected_payload text')
    expect(sql).toContain('ALTER TABLE workflow_outbox ADD COLUMN IF NOT EXISTS protected_payload text')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS research_event')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS research_checkpoint')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS research_quota_usage')
    expect(sql).toContain('ALTER TABLE research_quota_usage ADD COLUMN IF NOT EXISTS consumed integer NOT NULL DEFAULT 0')
    expect(sql).toContain('ALTER TABLE research_quota_usage ADD COLUMN IF NOT EXISTS reserved integer NOT NULL DEFAULT 0')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS workflow_outbox_operation_key_uidx')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS tx_log_address_research_tool_ordinal_uidx')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS research_event_research_dedupe_uidx')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS research_checkpoint_research_dedupe_uidx')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS research_address_created_at_id_idx')
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS research_quota_usage_bucket_idx')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS research_prepare_request_uidx ON research(prepare_request_id)')
  })

  it('rejects destructive SQL in expand migrations', () => {
    expect(() => assertExpandMigrationIsSafe(ESCROW_EXPAND_MIGRATION)).not.toThrow()

    const sql = combinedSql().toLowerCase()
    expect(sql).not.toMatch(/\bdrop\s+(table|column|index)\b/)
    expect(sql).not.toMatch(/\btruncate\b/)
    expect(sql).not.toMatch(/\bdelete\s+from\b/)
    expect(sql).not.toMatch(/\balter\s+column\b[\s\S]*\bset\s+not\s+null\b/)
  })
})
