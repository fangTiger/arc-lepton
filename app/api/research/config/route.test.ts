import { afterEach, describe, expect, it } from 'vitest'

const originalEnv = {
  ARC_RESEARCH_SETTLEMENT_BACKEND: process.env.ARC_RESEARCH_SETTLEMENT_BACKEND,
  ARC_RESEARCH_FUNDING_UI_ENABLED: process.env.ARC_RESEARCH_FUNDING_UI_ENABLED,
  ARC_RESEARCH_DUAL_WRITE_ENABLED: process.env.ARC_RESEARCH_DUAL_WRITE_ENABLED,
  ARC_RESEARCH_READ_COMPARE_ENABLED: process.env.ARC_RESEARCH_READ_COMPARE_ENABLED,
  ARC_RESEARCH_MIGRATION_STAGE: process.env.ARC_RESEARCH_MIGRATION_STAGE,
  ARC_RESEARCH_ROLLBACK_WINDOW_CLOSED: process.env.ARC_RESEARCH_ROLLBACK_WINDOW_CLOSED,
}

const mutableEnv = process.env as Record<string, string | undefined>

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete mutableEnv[key]
    else mutableEnv[key] = value
  }
}

describe('GET /api/research/config', () => {
  afterEach(() => {
    restoreEnv()
  })

  it('returns public research backend switch flags', async () => {
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mutableEnv.ARC_RESEARCH_FUNDING_UI_ENABLED = 'true'
    mutableEnv.ARC_RESEARCH_DUAL_WRITE_ENABLED = '1'
    mutableEnv.ARC_RESEARCH_READ_COMPARE_ENABLED = 'true'
    mutableEnv.ARC_RESEARCH_MIGRATION_STAGE = 'switch'

    const { GET } = await import('./route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      settlementBackend: 'escrow',
      fundingUiEnabled: true,
      dualWriteEnabled: true,
      readCompareEnabled: true,
      migrationStage: 'switch',
      contractMigrationAllowed: false,
    })
  })

  it('fails closed on invalid public config', async () => {
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'memory'

    const { GET } = await import('./route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'INVALID_RESEARCH_BACKEND_CONFIG' })
  })
})
