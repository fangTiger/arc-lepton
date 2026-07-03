export type TxStatus = 'mock' | 'pending' | 'confirmed' | 'failed'

export const BILLABLE_TX_STATUSES = ['mock', 'confirmed'] as const

export type TxLogEntry = {
  id: string
  address: string
  source: string
  amount: string
  researchId: string | null
  txHash: string | null
  txStatus: TxStatus
  chainId: number | null
  blockNumber: string | null
  settlementId: string | null
  requestId: string | null
  errorMessage: string | null
  createdAt: Date
}

export type TxLogScopedEntry = TxLogEntry & {
  requestId: string
}

export type TxLogRecordInput = {
  address: string
  source: string
  amount: string
  researchId?: string | null
  txHash?: string | null
  txStatus?: TxStatus
  chainId?: number | null
  blockNumber?: string | null
  settlementId?: string | null
  requestId?: string
  errorMessage?: string | null
}

export type TxLogClaimInput = {
  address: string
  source: string
  amount: string
  requestId: string
  researchId?: string | null
}

export type TxLogClaimResult =
  | { status: 'claimed'; entry: TxLogScopedEntry }
  | { status: 'existing'; entry: TxLogScopedEntry }
  | { status: 'pending'; entry: TxLogScopedEntry }
  | { status: 'failed'; entry: TxLogScopedEntry }

export type TxLogReceiptPatch = {
  txHash?: string | null
  txStatus?: TxStatus
  chainId?: number | null
  blockNumber?: string | null
  settlementId?: string | null
  errorMessage?: string | null
}

export type TxLogSettlementConfirmInput = {
  address: string
  researchId: string
  requestIds: string[]
  settlementId: string
  txHash: string
  txStatus?: Extract<TxStatus, 'mock' | 'confirmed'>
  chainId: number | null
  blockNumber: string | null
}

export type TxLogSettlementFailInput = {
  address: string
  researchId: string
  requestIds: string[]
  settlementId: string
  errorMessage: string
  txHash?: string | null
  chainId?: number | null
  blockNumber?: string | null
}

export class PaymentIdempotencyConflictError extends Error {
  readonly code = 'PAYMENT_IDEMPOTENCY_CONFLICT'
  readonly requestId: string
  readonly txLogEntry: TxLogScopedEntry

  constructor(requestId: string, txLogEntry: TxLogScopedEntry) {
    super('Idempotency key already belongs to another payment request')
    this.name = 'PaymentIdempotencyConflictError'
    this.requestId = requestId
    this.txLogEntry = txLogEntry
  }
}

export interface TxLogRepo {
  record(entry: TxLogRecordInput): Promise<TxLogEntry>
  claimRequest(input: TxLogClaimInput): Promise<TxLogClaimResult>
  updateReceipt(id: string, patch: TxLogReceiptPatch): Promise<TxLogEntry>
  findByRequestId(address: string, requestId: string): Promise<TxLogScopedEntry | null>
  listByAddress(address: string, limit?: number): Promise<TxLogEntry[]>
  listByResearchId(address: string, researchId: string, limit?: number): Promise<TxLogEntry[]>
  listPendingByResearchId(address: string, researchId: string, limit?: number): Promise<TxLogScopedEntry[]>
  markResearchSettlementConfirmed(input: TxLogSettlementConfirmInput): Promise<TxLogScopedEntry[]>
  markResearchSettlementFailed(input: TxLogSettlementFailInput): Promise<TxLogScopedEntry[]>
  totalSpentByAddress(address: string): Promise<string>
  count(): Promise<number>
  totalSpent(): Promise<string>
}

export function isBillableTxStatus(status: TxStatus) {
  return BILLABLE_TX_STATUSES.includes(status as (typeof BILLABLE_TX_STATUSES)[number])
}

export function normalizeResearchId(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function sameRequestScope(
  existing: Pick<TxLogEntry, 'source' | 'amount' | 'researchId'>,
  input: Pick<TxLogClaimInput, 'source' | 'amount' | 'researchId'>,
) {
  return (
    existing.source === input.source
    && normalizeDecimalString(existing.amount) === normalizeDecimalString(input.amount)
    && normalizeResearchId(existing.researchId) === normalizeResearchId(input.researchId)
  )
}

const DECIMAL_SCALE = 8n
const DECIMAL_BASE = 10n ** DECIMAL_SCALE

export function decimalToUnits(value: string): bigint {
  const [wholePart, fractionPart = ''] = value.split('.')
  const whole = BigInt(wholePart || '0')
  const fraction = BigInt(fractionPart.padEnd(Number(DECIMAL_SCALE), '0').slice(0, Number(DECIMAL_SCALE)) || '0')
  return whole * DECIMAL_BASE + fraction
}

export function unitsToDecimal(value: bigint): string {
  const whole = value / DECIMAL_BASE
  const fraction = (value % DECIMAL_BASE).toString().padStart(Number(DECIMAL_SCALE), '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function normalizeDecimalString(value: string): string {
  return unitsToDecimal(decimalToUnits(value))
}
