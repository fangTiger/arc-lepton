import { paymentSettlementRepo as defaultPaymentSettlementRepo, txLogRepo as defaultTxLogRepo } from '@/lib/db'
import {
  MANUAL_RECOVERY_ERROR_PREFIX,
  isManualRecoveryErrorMessage,
  type PaymentSettlement,
  type PaymentSettlementRepo,
} from '@/lib/db/payment-settlement-repo'
import type { TxLogRepo, TxLogScopedEntry } from '@/lib/db/tx-log-repo'
import { decimalToUnits, unitsToDecimal } from '@/lib/db/tx-log-repo'
import {
  recordArcResearchSettlement,
  type ArcResearchSettlementInput,
  type ArcSettlementResult,
} from '@/lib/chain/arc-receipt'

export type ResearchSettlementInput = {
  address: string
  researchId: string
}

export type ResearchSettlementResult =
  | { status: 'skipped'; reason: 'no_pending'; settledCount: 0 }
  | { status: 'in_progress'; settlementId: string; settledCount: number }
  | { status: 'reconciled'; settlementId: string; settledCount: number }
  | { status: 'needs_manual_recovery'; settlementId: string; settledCount: number; errorMessage: string }
  | { status: 'confirmed' | 'mock'; settlementId: string; settledCount: number; txHash: string; chainId: number | null; blockNumber: string | null }
  | { status: 'failed'; settlementId: string; settledCount: number; errorMessage: string }

export type ResearchSettlementReconcileResult = {
  status: 'reconciled'
  settlementId: string
  settledCount: number
}

export type ResearchSettlementRetryResult = {
  attempted: number
  results: Array<ResearchSettlementResult | ResearchSettlementReconcileResult>
}

type PaymentSettlementDeps = {
  txLogRepo?: TxLogRepo
  paymentSettlementRepo?: PaymentSettlementRepo
  recordArcResearchSettlement?: (input: ArcResearchSettlementInput) => Promise<ArcSettlementResult>
  now?: () => Date
}

type RetryResearchSettlementsInput = PaymentSettlementDeps & {
  staleBroadcastingBefore?: Date
  limit?: number
  confirmedReconcileLimit?: number
}

const CONFIRMED_RECONCILE_SCAN_PAGE_SIZE = 50

export class PaymentSettlementReconcileError extends Error {
  readonly code = 'PAYMENT_SETTLEMENT_RECONCILE_FAILED'
  readonly settlementId: string

  constructor(settlementId: string, cause: unknown) {
    super(errorMessage(cause))
    this.name = 'PaymentSettlementReconcileError'
    this.settlementId = settlementId
  }
}

export class PaymentSettlementConfirmPersistError extends Error {
  readonly code = 'SETTLEMENT_CONFIRM_PERSIST_FAILED'
  readonly settlementId: string
  readonly txHash: string
  readonly chainId: number | null
  readonly blockNumber: string | null

  constructor(settlementId: string, receipt: ArcSettlementResult, cause: unknown) {
    super(errorMessage(cause))
    this.name = 'PaymentSettlementConfirmPersistError'
    this.settlementId = settlementId
    this.txHash = receipt.txHash
    this.chainId = receipt.chainId
    this.blockNumber = receipt.blockNumber
  }
}

function totalAmount(entries: TxLogScopedEntry[]) {
  const total = entries.reduce((sum, entry) => sum + decimalToUnits(entry.amount), 0n)
  return unitsToDecimal(total)
}

function settlementOrder(left: TxLogScopedEntry, right: TxLogScopedEntry) {
  const amountDiff = decimalToUnits(left.amount) - decimalToUnits(right.amount)
  if (amountDiff < 0n) return -1
  if (amountDiff > 0n) return 1
  return left.requestId.localeCompare(right.requestId)
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message
  return 'ARC research settlement failed'
}

function errorDetails(error: unknown) {
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

function manualRecoveryMessage(reason: string) {
  return `${MANUAL_RECOVERY_ERROR_PREFIX}: ${reason}`
}

function isManualRecoverySettlement(settlement: Pick<PaymentSettlement, 'errorMessage'>) {
  return isManualRecoveryErrorMessage(settlement.errorMessage)
}

function manualRecoveryResult(
  settlement: Pick<PaymentSettlement, 'id' | 'requestIds' | 'errorMessage'>,
  fallbackMessage: string,
): ResearchSettlementResult {
  return {
    status: 'needs_manual_recovery',
    settlementId: settlement.id,
    settledCount: settlement.requestIds.length,
    errorMessage: settlement.errorMessage ?? fallbackMessage,
  }
}

async function markSettlementNeedsManualRecovery(input: {
  settlement: PaymentSettlement
  settlementRepo: PaymentSettlementRepo
  reason: string
}): Promise<ResearchSettlementResult> {
  const message = manualRecoveryMessage(input.reason)
  const updated = await input.settlementRepo.failSettlement(input.settlement.id, {
    errorMessage: message,
    txHash: input.settlement.txHash,
    chainId: input.settlement.chainId,
    blockNumber: input.settlement.blockNumber,
  })
  return manualRecoveryResult(updated, message)
}

async function settlementEntries(
  settlement: Pick<PaymentSettlement, 'address' | 'researchId' | 'requestIds'>,
  txRepo: TxLogRepo,
) {
  const requestIds = new Set(settlement.requestIds)
  return (await txRepo.listByResearchId(settlement.address, settlement.researchId, 500))
    .filter((entry): entry is TxLogScopedEntry => Boolean(entry.requestId) && requestIds.has(entry.requestId as string))
    .sort(settlementOrder)
}

function settlementItems(entries: TxLogScopedEntry[]) {
  return entries.map((entry) => ({
    requestId: entry.requestId,
    source: entry.source,
    amount: entry.amount,
  }))
}

async function markSettlementTxLogsConfirmed(input: {
  settlement: PaymentSettlement
  entries: TxLogScopedEntry[]
  txRepo: TxLogRepo
  txHash: string
  txStatus: 'mock' | 'confirmed'
  chainId: number | null
  blockNumber: string | null
}) {
  return input.txRepo.markResearchSettlementConfirmed({
    address: input.settlement.address,
    researchId: input.settlement.researchId,
    requestIds: input.entries.map((entry) => entry.requestId),
    settlementId: input.settlement.id,
    txHash: input.txHash,
    txStatus: input.txStatus,
    chainId: input.chainId,
    blockNumber: input.blockNumber,
  })
}

async function broadcastClaimedSettlement(input: {
  settlement: PaymentSettlement
  entries: TxLogScopedEntry[]
  txRepo: TxLogRepo
  settlementRepo: PaymentSettlementRepo
  recordArcResearchSettlement: (input: ArcResearchSettlementInput) => Promise<ArcSettlementResult>
  now: () => Date
}): Promise<ResearchSettlementResult> {
  const requestIds = input.entries.map((entry) => entry.requestId)
  let receipt: ArcSettlementResult
  try {
    receipt = await input.recordArcResearchSettlement({
      buyer: input.settlement.address,
      researchId: input.settlement.researchId,
      totalAmount: input.settlement.totalAmount,
      items: settlementItems(input.entries),
      createdAt: input.now().toISOString(),
    })
  } catch (error) {
    const message = errorMessage(error)
    const details = errorDetails(error)
    const settlement = await input.settlementRepo.failSettlement(input.settlement.id, {
      errorMessage: message,
      txHash: details.txHash ?? null,
      chainId: details.chainId ?? null,
      blockNumber: details.blockNumber ?? null,
    })
    await input.txRepo.markResearchSettlementFailed({
      address: settlement.address,
      researchId: settlement.researchId,
      requestIds,
      settlementId: settlement.id,
      errorMessage: message,
      txHash: details.txHash ?? null,
      chainId: details.chainId ?? null,
      blockNumber: details.blockNumber ?? null,
    })

    return {
      status: 'failed',
      settlementId: settlement.id,
      settledCount: input.entries.length,
      errorMessage: message,
    }
  }

  const receiptPatch = {
    txHash: receipt.txHash,
    chainId: receipt.chainId,
    blockNumber: receipt.blockNumber,
  }
  try {
    await input.settlementRepo.recordSettlementReceipt(input.settlement.id, receiptPatch)
  } catch (error) {
    throw new PaymentSettlementConfirmPersistError(input.settlement.id, receipt, error)
  }

  let settlement: PaymentSettlement
  try {
    settlement = await input.settlementRepo.confirmSettlement(input.settlement.id, receiptPatch)
  } catch (error) {
    throw new PaymentSettlementConfirmPersistError(input.settlement.id, receipt, error)
  }

  try {
    await markSettlementTxLogsConfirmed({
      settlement,
      entries: input.entries,
      txRepo: input.txRepo,
      txHash: receipt.txHash,
      txStatus: receipt.txStatus,
      chainId: receipt.chainId,
      blockNumber: receipt.blockNumber,
    })
  } catch (error) {
    throw new PaymentSettlementReconcileError(input.settlement.id, error)
  }

  return {
    status: receipt.txStatus,
    settlementId: settlement.id,
    settledCount: input.entries.length,
    txHash: receipt.txHash,
    chainId: receipt.chainId,
    blockNumber: receipt.blockNumber,
  }
}

async function confirmSettlementFromPersistedReceipt(input: {
  settlement: PaymentSettlement
  entries: TxLogScopedEntry[]
  txRepo: TxLogRepo
  settlementRepo: PaymentSettlementRepo
}): Promise<ResearchSettlementResult> {
  if (!input.settlement.txHash) {
    return markSettlementNeedsManualRecovery({
      settlement: input.settlement,
      settlementRepo: input.settlementRepo,
      reason: 'stale broadcasting settlement has no persisted ARC receipt metadata',
    })
  }

  const receiptPatch = {
    txHash: input.settlement.txHash,
    chainId: input.settlement.chainId,
    blockNumber: input.settlement.blockNumber,
  }
  let settlement: PaymentSettlement
  try {
    settlement = await input.settlementRepo.confirmSettlement(input.settlement.id, receiptPatch)
  } catch (error) {
    throw new PaymentSettlementConfirmPersistError(
      input.settlement.id,
      {
        txHash: input.settlement.txHash,
        txStatus: 'confirmed',
        chainId: input.settlement.chainId,
        blockNumber: input.settlement.blockNumber,
      },
      error,
    )
  }

  try {
    await markSettlementTxLogsConfirmed({
      settlement,
      entries: input.entries,
      txRepo: input.txRepo,
      txHash: input.settlement.txHash,
      txStatus: 'confirmed',
      chainId: input.settlement.chainId,
      blockNumber: input.settlement.blockNumber,
    })
  } catch (error) {
    throw new PaymentSettlementReconcileError(input.settlement.id, error)
  }

  return {
    status: 'confirmed',
    settlementId: settlement.id,
    settledCount: input.entries.length,
    txHash: input.settlement.txHash,
    chainId: input.settlement.chainId,
    blockNumber: input.settlement.blockNumber,
  }
}

function settlementNeedsReconcile(settlement: PaymentSettlement, entries: TxLogScopedEntry[]) {
  if (!settlement.txHash || !entries.length) return false
  return entries.some((entry) => (
    entry.txStatus !== 'confirmed'
    || entry.txHash !== settlement.txHash
    || entry.chainId !== settlement.chainId
    || entry.blockNumber !== settlement.blockNumber
    || entry.settlementId !== settlement.id
  ))
}

export async function settleResearchPayments(
  input: ResearchSettlementInput,
  deps: PaymentSettlementDeps = {},
): Promise<ResearchSettlementResult> {
  const txRepo = deps.txLogRepo ?? defaultTxLogRepo
  const settlementRepo = deps.paymentSettlementRepo ?? defaultPaymentSettlementRepo
  const pending = await txRepo.listPendingByResearchId(input.address, input.researchId, 200)
  if (!pending.length) {
    return {
      status: 'skipped',
      reason: 'no_pending',
      settledCount: 0,
    }
  }

  const orderedPending = [...pending].sort(settlementOrder)
  const total = totalAmount(orderedPending)
  const claim = await settlementRepo.claimResearchSettlement({
    address: input.address,
    researchId: input.researchId,
    requestIds: orderedPending.map((entry) => entry.requestId),
    totalAmount: total,
  })

  if (claim.status === 'existing') {
    if (isManualRecoverySettlement(claim.settlement)) {
      return manualRecoveryResult(claim.settlement, manualRecoveryMessage('settlement requires manual recovery'))
    }
    if (claim.settlement.status === 'failed' && claim.settlement.txHash) {
      return markSettlementNeedsManualRecovery({
        settlement: claim.settlement,
        settlementRepo,
        reason: 'failed settlement already has an ARC txHash; automatic rebroadcast is disabled',
      })
    }
    if (claim.settlement.status === 'confirmed') {
      return reconcileResearchSettlement(claim.settlement.id, {
        txLogRepo: txRepo,
        paymentSettlementRepo: settlementRepo,
      })
    }
    if (claim.settlement.status === 'broadcasting' && claim.settlement.txHash) {
      const entries = await settlementEntries(claim.settlement, txRepo)
      return confirmSettlementFromPersistedReceipt({
        settlement: claim.settlement,
        entries,
        txRepo,
        settlementRepo,
      })
    }
    return {
      status: 'in_progress',
      settlementId: claim.settlement.id,
      settledCount: pending.length,
    }
  }

  return broadcastClaimedSettlement({
    settlement: claim.settlement,
    entries: orderedPending,
    txRepo,
    settlementRepo,
    recordArcResearchSettlement: deps.recordArcResearchSettlement ?? recordArcResearchSettlement,
    now: deps.now ?? (() => new Date()),
  })
}

export async function reconcileResearchSettlement(
  settlementId: string,
  deps: PaymentSettlementDeps = {},
): Promise<ResearchSettlementReconcileResult> {
  const txRepo = deps.txLogRepo ?? defaultTxLogRepo
  const settlementRepo = deps.paymentSettlementRepo ?? defaultPaymentSettlementRepo
  const settlement = await settlementRepo.findById(settlementId)
  if (!settlement) throw new Error(`payment_settlement ${settlementId} not found`)
  if (settlement.status !== 'confirmed' || !settlement.txHash) {
    throw new Error(`payment_settlement ${settlementId} is not confirmed`)
  }

  const entries = await settlementEntries(settlement, txRepo)
  const updated = await markSettlementTxLogsConfirmed({
    settlement,
    entries,
    txRepo,
    txHash: settlement.txHash,
    txStatus: 'confirmed',
    chainId: settlement.chainId,
    blockNumber: settlement.blockNumber,
  })

  return {
    status: 'reconciled',
    settlementId: settlement.id,
    settledCount: updated.length,
  }
}

export async function retryResearchSettlements(input: RetryResearchSettlementsInput = {}): Promise<ResearchSettlementRetryResult> {
  const txRepo = input.txLogRepo ?? defaultTxLogRepo
  const settlementRepo = input.paymentSettlementRepo ?? defaultPaymentSettlementRepo
  const retryableLimit = input.limit ?? 50
  const confirmedReconcileLimit = input.confirmedReconcileLimit ?? input.limit ?? 50
  const retryableSettlements = await settlementRepo.listRetryableSettlements({
    staleBroadcastingBefore: input.staleBroadcastingBefore,
    limit: retryableLimit,
  })
  const results: ResearchSettlementRetryResult['results'] = []

  for (const retryable of retryableSettlements) {
    if (isManualRecoverySettlement(retryable)) {
      results.push(manualRecoveryResult(retryable, retryable.errorMessage ?? manualRecoveryMessage('settlement requires manual recovery')))
      continue
    }
    if (retryable.status === 'failed' && retryable.txHash) {
      results.push(await markSettlementNeedsManualRecovery({
        settlement: retryable,
        settlementRepo,
        reason: 'failed settlement already has an ARC txHash; automatic rebroadcast is disabled',
      }))
      continue
    }

    const claim = await settlementRepo.claimRetryableSettlement(retryable.id, {
      staleBroadcastingBefore: input.staleBroadcastingBefore,
    })
    if (claim.status === 'existing') {
      if (claim.settlement.status === 'confirmed') {
        results.push(await reconcileResearchSettlement(claim.settlement.id, {
          txLogRepo: txRepo,
          paymentSettlementRepo: settlementRepo,
        }))
        continue
      }
      results.push({
        status: 'in_progress',
        settlementId: claim.settlement.id,
        settledCount: claim.settlement.requestIds.length,
      })
      continue
    }

    const entries = await settlementEntries(claim.settlement, txRepo)
    if (retryable.status === 'broadcasting') {
      results.push(await confirmSettlementFromPersistedReceipt({
        settlement: claim.settlement,
        entries,
        txRepo,
        settlementRepo,
      }))
      continue
    }

    results.push(await broadcastClaimedSettlement({
      settlement: claim.settlement,
      entries,
      txRepo,
      settlementRepo,
      recordArcResearchSettlement: input.recordArcResearchSettlement ?? recordArcResearchSettlement,
      now: input.now ?? (() => new Date()),
    }))
  }

  if (confirmedReconcileLimit > 0) {
    let afterUpdatedAt: Date | undefined
    let afterId: string | undefined
    let confirmedReconciled = 0
    while (confirmedReconciled < confirmedReconcileLimit) {
      const confirmedSettlements = await settlementRepo.listConfirmedSettlementsNeedingReconcile({
        limit: CONFIRMED_RECONCILE_SCAN_PAGE_SIZE,
        afterUpdatedAt,
        afterId,
      })
      if (!confirmedSettlements.length) break

      for (const settlement of confirmedSettlements) {
        const entries = await settlementEntries(settlement, txRepo)
        if (!settlementNeedsReconcile(settlement, entries)) continue
        results.push(await reconcileResearchSettlement(settlement.id, {
          txLogRepo: txRepo,
          paymentSettlementRepo: settlementRepo,
        }))
        confirmedReconciled += 1
        if (confirmedReconciled >= confirmedReconcileLimit) break
      }

      const last = confirmedSettlements[confirmedSettlements.length - 1]
      afterUpdatedAt = last.updatedAt
      afterId = last.id
    }
  }

  return {
    attempted: results.length,
    results,
  }
}
