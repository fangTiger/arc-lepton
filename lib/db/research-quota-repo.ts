export type ResearchQuotaConsumeInput = {
  address: string
  day: string
  resetAt: string
}

export type ResearchQuotaReleaseInput = {
  address: string
  day: string
}

export type ResearchQuotaStatusInput = {
  address: string
  day: string
  resetAt: string
}

export type ResearchQuotaUsage = {
  walletUsed: number
  globalUsed: number
}

export type ResearchQuotaBucketStatus = {
  consumed: number
  reserved: number
  used: number
  resetAt: string
}

export type ResearchQuotaStatus = {
  wallet: ResearchQuotaBucketStatus
  global: ResearchQuotaBucketStatus
}

export interface ResearchQuotaRepo {
  consume(input: ResearchQuotaConsumeInput): Promise<ResearchQuotaUsage>
  release(input: ResearchQuotaReleaseInput): Promise<void>
  status(input: ResearchQuotaStatusInput): Promise<ResearchQuotaStatus>
}
