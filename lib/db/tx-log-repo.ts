import { keccak256, toBytes, isAddress } from 'viem'
import { parseScale8DecimalToUnits6 } from '../chain/amounts'
import { requestKey as deriveRequestKey, sourceId as deriveSourceId } from '../chain/canonical'

export type TxStatus = 'mock' | 'pending' | 'confirmed' | 'failed'
export type TxLogBackend = 'mock' | 'arc' | 'escrow'

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
  backend: TxLogBackend | null
  version: number | null
  paymentIntentId: string | null
  toolOrdinal: number | null
  requestKey: string | null
  sourceId: string | null
  amountUnits: string | null
  registryRevision: string | null
  expectedPayout: string | null
  maxUnitPrice: string | null
  registryReadBlock: string | null
  payloadHash: string | null
  escrowAddress: string | null
  researchKey: string | null
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
  backend?: TxLogBackend | null
  version?: number | null
  paymentIntentId?: string | null
  toolOrdinal?: number | null
  requestKey?: string | null
  sourceId?: string | null
  amountUnits?: string | null
  registryRevision?: string | null
  expectedPayout?: string | null
  maxUnitPrice?: string | null
  registryReadBlock?: string | null
  payloadHash?: string | null
  escrowAddress?: string | null
  researchKey?: string | null
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

export type TxLogResearchPaymentIntentInput = {
  address: string
  source: string
  amount: string
  researchId: string
  paymentIntentId: string
  toolOrdinal: number
  researchKey: string
  escrowAddress: string
  registryRevision: bigint | number | string
  expectedPayout: string
  maxUnitPrice: bigint | number | string
  registryReadBlock: bigint | number | string
  payload: unknown
}

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
  claimResearchPaymentIntent(input: TxLogResearchPaymentIntentInput): Promise<TxLogClaimResult>
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

export type CanonicalResearchPaymentIntentSnapshot = {
  address: string
  source: string
  amount: string
  researchId: string
  requestId: string
  backend: 'escrow'
  version: 1
  paymentIntentId: string
  toolOrdinal: number
  requestKey: string
  sourceId: string
  amountUnits: string
  registryRevision: string
  expectedPayout: string
  maxUnitPrice: string
  registryReadBlock: string
  payloadHash: string
  escrowAddress: string
  researchKey: string
}

export function canonicalResearchPaymentIntentSnapshot(
  input: TxLogResearchPaymentIntentInput,
): CanonicalResearchPaymentIntentSnapshot {
  const researchId = normalizeResearchId(input.researchId)
  if (!researchId) throw codedError('INVALID_RESEARCH_ID', 'researchId is required for escrow payment intent')
  if (!Number.isSafeInteger(input.toolOrdinal) || input.toolOrdinal < 0) {
    throw codedError('INVALID_TOOL_ORDINAL', 'toolOrdinal must be a non-negative safe integer')
  }
  if (!isAddress(input.escrowAddress)) throw codedError('INVALID_ESCROW_ADDRESS', 'escrowAddress is invalid')
  if (!isAddress(input.expectedPayout)) throw codedError('INVALID_EXPECTED_PAYOUT', 'expectedPayout is invalid')

  const requestKey = deriveRequestKey(input.researchKey, input.paymentIntentId)

  return {
    address: input.address,
    source: input.source,
    amount: normalizeDecimalString(input.amount),
    researchId,
    requestId: requestKey,
    backend: 'escrow',
    version: 1,
    paymentIntentId: input.paymentIntentId,
    toolOrdinal: input.toolOrdinal,
    requestKey,
    sourceId: deriveSourceId(input.source),
    amountUnits: parseScale8DecimalToUnits6(input.amount).toString(),
    registryRevision: uintString(input.registryRevision, 'registryRevision'),
    expectedPayout: input.expectedPayout.toLowerCase(),
    maxUnitPrice: uintString(input.maxUnitPrice, 'maxUnitPrice'),
    registryReadBlock: uintString(input.registryReadBlock, 'registryReadBlock'),
    payloadHash: keccak256(toBytes(stableStringify(input.payload))),
    escrowAddress: input.escrowAddress.toLowerCase(),
    researchKey: input.researchKey.toLowerCase(),
  }
}

export function sameResearchPaymentIntentScope(
  existing: TxLogEntry,
  snapshot: CanonicalResearchPaymentIntentSnapshot,
) {
  return (
    existing.address === snapshot.address
    && existing.source === snapshot.source
    && normalizeDecimalString(existing.amount) === snapshot.amount
    && normalizeResearchId(existing.researchId) === snapshot.researchId
    && existing.requestId === snapshot.requestId
    && existing.backend === snapshot.backend
    && existing.version === snapshot.version
    && existing.paymentIntentId === snapshot.paymentIntentId
    && existing.toolOrdinal === snapshot.toolOrdinal
    && existing.requestKey === snapshot.requestKey
    && existing.sourceId === snapshot.sourceId
    && existing.amountUnits === snapshot.amountUnits
    && existing.registryRevision === snapshot.registryRevision
    && lowerOrNull(existing.expectedPayout) === snapshot.expectedPayout
    && existing.maxUnitPrice === snapshot.maxUnitPrice
    && existing.registryReadBlock === snapshot.registryReadBlock
    && existing.payloadHash === snapshot.payloadHash
    && lowerOrNull(existing.escrowAddress) === snapshot.escrowAddress
    && lowerOrNull(existing.researchKey) === snapshot.researchKey
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

function uintString(value: bigint | number | string, path: string) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw codedError('INVALID_UINT', `${path} must be non-negative`)
    return value.toString()
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw codedError('INVALID_UINT', `${path} must be a safe non-negative integer`)
    return String(value)
  }
  if (!/^[0-9]+$/.test(value)) throw codedError('INVALID_UINT', `${path} must be a non-negative integer string`)
  return value
}

function stableStringify(value: unknown): string {
  if (value === undefined) throw codedError('NON_JSON_PAYLOAD', 'payload must be JSON serializable')
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

function lowerOrNull(value: string | null) {
  return value ? value.toLowerCase() : null
}

function codedError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}
