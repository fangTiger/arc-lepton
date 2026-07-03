export type SettlementStatus = 'pending' | 'broadcasting' | 'confirmed' | 'failed'

export const MANUAL_RECOVERY_ERROR_PREFIX = 'manual recovery required'

export type PaymentSettlement = {
  id: string
  address: string
  researchId: string
  requestIds: string[]
  totalAmount: string
  status: SettlementStatus
  txHash: string | null
  chainId: number | null
  blockNumber: string | null
  attempts: number
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
}

export type PaymentSettlementClaimInput = {
  address: string
  researchId: string
  requestIds: string[]
  totalAmount: string
}

export type PaymentSettlementClaimResult =
  | { status: 'claimed'; settlement: PaymentSettlement }
  | { status: 'existing'; settlement: PaymentSettlement }

export type PaymentSettlementReceiptPatch = {
  txHash: string
  chainId: number | null
  blockNumber: string | null
}

export type PaymentSettlementFailurePatch = {
  errorMessage: string
  txHash?: string | null
  chainId?: number | null
  blockNumber?: string | null
}

export type PaymentSettlementRetryQuery = {
  staleBroadcastingBefore?: Date
  limit?: number
}

export type PaymentSettlementRetryClaimInput = {
  staleBroadcastingBefore?: Date
}

export type PaymentSettlementConfirmedReconcileQuery = {
  limit?: number
  afterUpdatedAt?: Date
  afterId?: string
}

export interface PaymentSettlementRepo {
  claimResearchSettlement(input: PaymentSettlementClaimInput): Promise<PaymentSettlementClaimResult>
  claimRetryableSettlement(id: string, input?: PaymentSettlementRetryClaimInput): Promise<PaymentSettlementClaimResult>
  recordSettlementReceipt(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement>
  confirmSettlement(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement>
  failSettlement(id: string, patch: PaymentSettlementFailurePatch): Promise<PaymentSettlement>
  findById(id: string): Promise<PaymentSettlement | null>
  listRetryableSettlements(query?: PaymentSettlementRetryQuery): Promise<PaymentSettlement[]>
  listConfirmedSettlementsNeedingReconcile(query?: PaymentSettlementConfirmedReconcileQuery): Promise<PaymentSettlement[]>
  count(): Promise<number>
}

export function normalizeSettlementResearchId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('researchId is required for payment settlement')
  return trimmed
}

export function isManualRecoveryErrorMessage(value: string | null | undefined) {
  return Boolean(value?.startsWith(MANUAL_RECOVERY_ERROR_PREFIX))
}
