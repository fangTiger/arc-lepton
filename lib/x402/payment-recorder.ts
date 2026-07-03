import { randomUUID } from 'node:crypto'
import { txLogRepo as defaultTxLogRepo } from '@/lib/db'
import type { TxLogEntry, TxLogRepo, TxLogScopedEntry } from '@/lib/db/tx-log-repo'
import { recordArcReceipt, type ArcReceiptInput, type ArcReceiptMode } from '@/lib/chain/arc-receipt'
import { isValidIdempotencyKey } from './idempotency-key'

export type PaymentReceiptInput = {
  address: string
  source: string
  amount: string
  requestId?: string
  researchId?: string
  mode?: ArcReceiptMode
  signal?: AbortSignal
}

type PaymentRecorderDeps = {
  txLogRepo?: TxLogRepo
  recordArcReceipt?: (input: ArcReceiptInput) => Promise<{
    txHash: string
    txStatus: 'mock' | 'confirmed'
    chainId: number | null
    blockNumber: string | null
    requestId: string
  }>
  createRequestId?: () => string
  now?: () => Date
}

type FailedReceiptDetails = {
  txHash?: string
  chainId?: number | null
  blockNumber?: string | null
}

export class PaymentReceiptError extends Error {
  readonly code = 'PAYMENT_RECEIPT_FAILED'
  readonly requestId: string
  readonly txLogEntry: TxLogEntry

  constructor(message: string, requestId: string, txLogEntry: TxLogEntry) {
    super(message)
    this.name = 'PaymentReceiptError'
    this.requestId = requestId
    this.txLogEntry = txLogEntry
  }
}

export class PaymentReceiptPendingError extends Error {
  readonly code = 'PAYMENT_RECEIPT_PENDING'
  readonly requestId: string
  readonly txLogEntry: TxLogEntry

  constructor(message: string, requestId: string, txLogEntry: TxLogEntry) {
    super(message)
    this.name = 'PaymentReceiptPendingError'
    this.requestId = requestId
    this.txLogEntry = txLogEntry
  }
}

export class PaymentIdempotencyKeyInvalidError extends Error {
  readonly code = 'PAYMENT_IDEMPOTENCY_KEY_INVALID'
  readonly requestId: string

  constructor(requestId: string) {
    super('幂等 key 必须为 1-128 个字符，且仅允许 [A-Za-z0-9._:-]')
    this.name = 'PaymentIdempotencyKeyInvalidError'
    this.requestId = requestId
  }
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return 'ARC receipt recording failed'
}

function failedDetails(error: unknown): FailedReceiptDetails {
  if (!error || typeof error !== 'object') return {}
  const value = error as {
    txHash?: unknown
    chainId?: unknown
    blockNumber?: unknown
  }

  return {
    txHash: typeof value.txHash === 'string' ? value.txHash : undefined,
    chainId: typeof value.chainId === 'number' ? value.chainId : value.chainId === null ? null : undefined,
    blockNumber: typeof value.blockNumber === 'string' ? value.blockNumber : value.blockNumber === null ? null : undefined,
  }
}

function assertScopedEntry(entry: TxLogEntry): TxLogScopedEntry {
  if (!entry.requestId) throw new Error(`tx_log ${entry.id} is missing requestId`)
  return entry as TxLogScopedEntry
}

function assertValidRequestId(requestId: string) {
  if (!isValidIdempotencyKey(requestId)) {
    throw new PaymentIdempotencyKeyInvalidError(requestId)
  }
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Research cancelled')
}

export async function recordPaymentReceipt(input: PaymentReceiptInput, deps: PaymentRecorderDeps = {}): Promise<TxLogScopedEntry> {
  assertNotAborted(input.signal)
  const repo = deps.txLogRepo ?? defaultTxLogRepo
  const requestId = input.requestId === undefined ? (deps.createRequestId ?? randomUUID)() : input.requestId
  assertValidRequestId(requestId)
  const createdAt = (deps.now ?? (() => new Date()))().toISOString()
  const claim = await repo.claimRequest({
    address: input.address,
    source: input.source,
    amount: input.amount,
    requestId,
    researchId: input.researchId,
  })
  assertNotAborted(input.signal)

  if (claim.status === 'existing') return claim.entry
  if (claim.status === 'pending') {
    throw new PaymentReceiptPendingError('ARC receipt recording is still pending', claim.entry.requestId, claim.entry)
  }
  if (claim.status === 'failed') {
    throw new PaymentReceiptError(claim.entry.errorMessage ?? 'ARC receipt recording failed', claim.entry.requestId, claim.entry)
  }

  const arcInput: ArcReceiptInput = {
    buyer: input.address,
    source: input.source,
    amount: input.amount,
    requestId,
    researchId: input.researchId,
    mode: input.mode,
    createdAt,
  }

  try {
    assertNotAborted(input.signal)
    const receipt = await (deps.recordArcReceipt ?? recordArcReceipt)(arcInput)
    assertNotAborted(input.signal)
    return assertScopedEntry(await repo.updateReceipt(claim.entry.id, {
      txHash: receipt.txHash,
      txStatus: receipt.txStatus,
      chainId: receipt.chainId,
      blockNumber: receipt.blockNumber,
      errorMessage: null,
    }))
  } catch (error) {
    if (input.signal?.aborted) throw new Error('Research cancelled')
    const details = failedDetails(error)
    const message = errorMessage(error)
    const failed = assertScopedEntry(await repo.updateReceipt(claim.entry.id, {
      txHash: details.txHash ?? null,
      txStatus: 'failed',
      chainId: details.chainId ?? null,
      blockNumber: details.blockNumber ?? null,
      errorMessage: message,
    }))
    throw new PaymentReceiptError(message, requestId, failed)
  }
}

export async function recordResearchPaymentIntent(input: PaymentReceiptInput, deps: PaymentRecorderDeps = {}): Promise<TxLogScopedEntry> {
  assertNotAborted(input.signal)
  const repo = deps.txLogRepo ?? defaultTxLogRepo
  const requestId = input.requestId === undefined ? (deps.createRequestId ?? randomUUID)() : input.requestId
  assertValidRequestId(requestId)

  const claim = await repo.claimRequest({
    address: input.address,
    source: input.source,
    amount: input.amount,
    requestId,
    researchId: input.researchId,
  })
  assertNotAborted(input.signal)

  return claim.entry
}
