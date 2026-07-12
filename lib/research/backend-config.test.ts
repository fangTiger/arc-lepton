import { describe, expect, it } from 'vitest'
import {
  InvalidResearchBackendConfigError,
  getResearchBackendConfig,
} from './backend-config'

describe('research backend config', () => {
  it('defaults to calldata and keeps funding UI disabled', () => {
    expect(getResearchBackendConfig({})).toMatchObject({
      settlementBackend: 'calldata',
      fundingUiEnabled: false,
      dualWriteEnabled: false,
      contractMigrationAllowed: false,
    })
  })

  it('requires explicit escrow backend before enabling funding UI', () => {
    expect(getResearchBackendConfig({
      ARC_RESEARCH_SETTLEMENT_BACKEND: 'calldata',
      ARC_RESEARCH_FUNDING_UI_ENABLED: 'true',
    }).fundingUiEnabled).toBe(false)

    expect(getResearchBackendConfig({
      ARC_RESEARCH_SETTLEMENT_BACKEND: 'escrow',
      ARC_RESEARCH_FUNDING_UI_ENABLED: 'true',
    })).toMatchObject({
      settlementBackend: 'escrow',
      fundingUiEnabled: true,
    })
  })

  it('parses dual write/read compare flags explicitly', () => {
    expect(getResearchBackendConfig({
      ARC_RESEARCH_SETTLEMENT_BACKEND: 'escrow',
      ARC_RESEARCH_DUAL_WRITE_ENABLED: '1',
      ARC_RESEARCH_READ_COMPARE_ENABLED: 'true',
    })).toMatchObject({
      dualWriteEnabled: true,
      readCompareEnabled: true,
    })
  })

  it('allows contract migration only after the rollback window is closed', () => {
    expect(getResearchBackendConfig({
      ARC_RESEARCH_MIGRATION_STAGE: 'contract',
      ARC_RESEARCH_ROLLBACK_WINDOW_CLOSED: 'false',
    }).contractMigrationAllowed).toBe(false)

    expect(getResearchBackendConfig({
      ARC_RESEARCH_MIGRATION_STAGE: 'contract',
      ARC_RESEARCH_ROLLBACK_WINDOW_CLOSED: 'true',
    }).contractMigrationAllowed).toBe(true)
  })

  it('rejects invalid backend and migration stage values', () => {
    expect(() => getResearchBackendConfig({
      ARC_RESEARCH_SETTLEMENT_BACKEND: 'memory',
    })).toThrow(InvalidResearchBackendConfigError)

    expect(() => getResearchBackendConfig({
      ARC_RESEARCH_MIGRATION_STAGE: 'drop-old-fields',
    })).toThrow(InvalidResearchBackendConfigError)
  })
})
