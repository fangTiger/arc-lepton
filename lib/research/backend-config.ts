export type ResearchSettlementBackend = 'calldata' | 'escrow'
export type ResearchMigrationStage = 'expand' | 'backfill' | 'switch' | 'contract'

export type ResearchBackendConfig = {
  settlementBackend: ResearchSettlementBackend
  fundingUiEnabled: boolean
  dualWriteEnabled: boolean
  readCompareEnabled: boolean
  migrationStage: ResearchMigrationStage
  contractMigrationAllowed: boolean
}

type EnvLike = Record<string, string | undefined>

export class InvalidResearchBackendConfigError extends Error {
  readonly code = 'INVALID_RESEARCH_BACKEND_CONFIG'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidResearchBackendConfigError'
  }
}

export function getResearchBackendConfig(env: EnvLike = process.env): ResearchBackendConfig {
  const settlementBackend = parseSettlementBackend(env.ARC_RESEARCH_SETTLEMENT_BACKEND)
  const migrationStage = parseMigrationStage(env.ARC_RESEARCH_MIGRATION_STAGE)
  const fundingUiEnabled = settlementBackend === 'escrow' && truthy(env.ARC_RESEARCH_FUNDING_UI_ENABLED)
  const dualWriteEnabled = settlementBackend === 'escrow' && truthy(env.ARC_RESEARCH_DUAL_WRITE_ENABLED)
  const readCompareEnabled = settlementBackend === 'escrow' && truthy(env.ARC_RESEARCH_READ_COMPARE_ENABLED)
  const contractMigrationAllowed = migrationStage === 'contract' && truthy(env.ARC_RESEARCH_ROLLBACK_WINDOW_CLOSED)

  return {
    settlementBackend,
    fundingUiEnabled,
    dualWriteEnabled,
    readCompareEnabled,
    migrationStage,
    contractMigrationAllowed,
  }
}

function parseSettlementBackend(value: string | undefined): ResearchSettlementBackend {
  const normalized = normalize(value)
  if (!normalized) return 'calldata'
  if (normalized === 'calldata' || normalized === 'escrow') return normalized
  throw new InvalidResearchBackendConfigError(`Unsupported ARC_RESEARCH_SETTLEMENT_BACKEND: ${value}`)
}

function parseMigrationStage(value: string | undefined): ResearchMigrationStage {
  const normalized = normalize(value)
  if (!normalized) return 'backfill'
  if (normalized === 'expand' || normalized === 'backfill' || normalized === 'switch' || normalized === 'contract') {
    return normalized
  }
  throw new InvalidResearchBackendConfigError(`Unsupported ARC_RESEARCH_MIGRATION_STAGE: ${value}`)
}

function truthy(value: string | undefined) {
  const normalized = normalize(value)
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === 'enabled'
}

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? ''
}
