import { randomBytes, randomUUID } from 'node:crypto'
import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { txLog } from './schema/tx-log'
import type {
  TxLogClaimInput,
  TxLogClaimResult,
  TxLogEntry,
  TxLogReceiptPatch,
  TxLogRecordInput,
  TxLogResearchPaymentIntentInput,
  TxLogRepo,
  TxLogScopedEntry,
  TxLogSettlementConfirmInput,
  TxLogSettlementFailInput,
  TxLogBackend,
  TxStatus,
} from './tx-log-repo'
import {
  BILLABLE_TX_STATUSES,
  PaymentIdempotencyConflictError,
  canonicalResearchPaymentIntentSnapshot,
  normalizeDecimalString,
  normalizeResearchId,
  sameRequestScope,
  sameResearchPaymentIntentScope,
} from './tx-log-repo'

type DbClient = VercelPgDatabase<typeof schema>

function mockTxHash() {
  return `0x${randomBytes(32).toString('hex')}`
}

function resolveTxHash(entry: TxLogRecordInput) {
  if (entry.txHash !== undefined) return entry.txHash
  if ((entry.txStatus ?? 'mock') === 'failed' || (entry.txStatus ?? 'mock') === 'pending') return null
  return mockTxHash()
}

function toTxLogEntry(row: typeof txLog.$inferSelect): TxLogEntry {
  return {
    ...row,
    requestId: row.requestId ?? null,
    backend: row.backend as TxLogBackend | null,
    txStatus: row.txStatus as TxStatus,
  }
}

function toTxLogScopedEntry(row: typeof txLog.$inferSelect): TxLogScopedEntry {
  const entry = toTxLogEntry(row)
  if (!entry.requestId) throw new Error(`tx_log ${entry.id} is missing request_id`)
  return entry as TxLogScopedEntry
}

export class PgTxLogRepo implements TxLogRepo {
  constructor(private readonly database: DbClient) {}

  async record(entry: TxLogRecordInput): Promise<TxLogEntry> {
    const [row] = await this.database
      .insert(txLog)
      .values({
        address: entry.address,
        source: entry.source,
        amount: entry.amount,
        researchId: normalizeResearchId(entry.researchId),
        txHash: resolveTxHash(entry),
        txStatus: entry.txStatus ?? 'mock',
        chainId: entry.chainId ?? null,
        blockNumber: entry.blockNumber ?? null,
        settlementId: entry.settlementId ?? null,
        requestId: entry.requestId ?? randomUUID(),
        backend: entry.backend ?? null,
        version: entry.version ?? null,
        paymentIntentId: entry.paymentIntentId ?? null,
        toolOrdinal: entry.toolOrdinal ?? null,
        requestKey: entry.requestKey ?? null,
        sourceId: entry.sourceId ?? null,
        amountUnits: entry.amountUnits ?? null,
        registryRevision: entry.registryRevision ?? null,
        expectedPayout: entry.expectedPayout ?? null,
        maxUnitPrice: entry.maxUnitPrice ?? null,
        registryReadBlock: entry.registryReadBlock ?? null,
        payloadHash: entry.payloadHash ?? null,
        escrowAddress: entry.escrowAddress ?? null,
        researchKey: entry.researchKey ?? null,
        errorMessage: entry.errorMessage ?? null,
      })
      .returning()

    if (!row) throw new Error('Failed to record tx_log')
    return toTxLogEntry(row)
  }

  async claimRequest(input: TxLogClaimInput): Promise<TxLogClaimResult> {
    const [claimed] = await this.database
      .insert(txLog)
      .values({
        address: input.address,
        source: input.source,
        amount: input.amount,
        researchId: normalizeResearchId(input.researchId),
        txHash: null,
        txStatus: 'pending',
        chainId: null,
        blockNumber: null,
        settlementId: null,
        requestId: input.requestId,
        backend: null,
        version: null,
        paymentIntentId: null,
        toolOrdinal: null,
        requestKey: null,
        sourceId: null,
        amountUnits: null,
        registryRevision: null,
        expectedPayout: null,
        maxUnitPrice: null,
        registryReadBlock: null,
        payloadHash: null,
        escrowAddress: null,
        researchKey: null,
        errorMessage: null,
      })
      .onConflictDoNothing({ target: [txLog.address, txLog.requestId] })
      .returning()

    if (claimed) return { status: 'claimed', entry: toTxLogScopedEntry(claimed) }

    const existing = await this.findByRequestId(input.address, input.requestId)
    if (!existing) throw new Error(`Failed to resolve tx_log claim for ${input.address}:${input.requestId}`)
    if (existing.backend === 'escrow') {
      throw new PaymentIdempotencyConflictError(input.requestId, existing)
    }
    if (!sameRequestScope(existing, input)) {
      throw new PaymentIdempotencyConflictError(input.requestId, existing)
    }
    if (existing.txStatus === 'pending') return { status: 'pending', entry: existing }
    if (existing.txStatus === 'failed') return { status: 'failed', entry: existing }
    return { status: 'existing', entry: existing }
  }

  async claimResearchPaymentIntent(input: TxLogResearchPaymentIntentInput): Promise<TxLogClaimResult> {
    const snapshot = canonicalResearchPaymentIntentSnapshot(input)
    const existingForToolOrdinal = await this.findByResearchToolOrdinal(
      snapshot.address,
      snapshot.researchId,
      snapshot.toolOrdinal,
    )
    if (existingForToolOrdinal) return this.resolveExistingResearchPaymentIntent(existingForToolOrdinal, snapshot)

    const [claimed] = await this.database
      .insert(txLog)
      .values({
        address: snapshot.address,
        source: snapshot.source,
        amount: snapshot.amount,
        researchId: snapshot.researchId,
        txHash: null,
        txStatus: 'pending',
        chainId: null,
        blockNumber: null,
        settlementId: null,
        requestId: snapshot.requestId,
        backend: snapshot.backend,
        version: snapshot.version,
        paymentIntentId: snapshot.paymentIntentId,
        toolOrdinal: snapshot.toolOrdinal,
        requestKey: snapshot.requestKey,
        sourceId: snapshot.sourceId,
        amountUnits: snapshot.amountUnits,
        registryRevision: snapshot.registryRevision,
        expectedPayout: snapshot.expectedPayout,
        maxUnitPrice: snapshot.maxUnitPrice,
        registryReadBlock: snapshot.registryReadBlock,
        payloadHash: snapshot.payloadHash,
        escrowAddress: snapshot.escrowAddress,
        researchKey: snapshot.researchKey,
        errorMessage: null,
      })
      .onConflictDoNothing()
      .returning()

    if (claimed) return { status: 'claimed', entry: toTxLogScopedEntry(claimed) }

    const existing = await this.findByRequestId(snapshot.address, snapshot.requestId)
    if (existing) return this.resolveExistingResearchPaymentIntent(existing, snapshot)

    const existingToolOrdinal = await this.findByResearchToolOrdinal(
      snapshot.address,
      snapshot.researchId,
      snapshot.toolOrdinal,
    )
    if (existingToolOrdinal) return this.resolveExistingResearchPaymentIntent(existingToolOrdinal, snapshot)

    throw new Error(`Failed to resolve payment intent claim for ${snapshot.address}:${snapshot.requestId}`)
  }

  private async findByResearchToolOrdinal(
    address: string,
    researchId: string,
    toolOrdinal: number,
  ): Promise<TxLogScopedEntry | null> {
    const [row] = await this.database
      .select()
      .from(txLog)
      .where(and(
        eq(txLog.address, address),
        eq(txLog.researchId, researchId),
        eq(txLog.toolOrdinal, toolOrdinal),
        isNotNull(txLog.requestId),
      ))
      .orderBy(desc(txLog.createdAt))
      .limit(1)

    return row ? toTxLogScopedEntry(row) : null
  }

  private resolveExistingResearchPaymentIntent(
    existing: TxLogScopedEntry,
    snapshot: ReturnType<typeof canonicalResearchPaymentIntentSnapshot>,
  ): TxLogClaimResult {
    if (!sameResearchPaymentIntentScope(existing, snapshot)) {
      throw new PaymentIdempotencyConflictError(snapshot.requestId, existing)
    }
    if (existing.txStatus === 'pending') return { status: 'pending', entry: existing }
    if (existing.txStatus === 'failed') return { status: 'failed', entry: existing }
    return { status: 'existing', entry: existing }
  }

  async updateReceipt(id: string, patch: TxLogReceiptPatch): Promise<TxLogEntry> {
    const [row] = await this.database
      .update(txLog)
      .set({
        txHash: patch.txHash,
        txStatus: patch.txStatus,
        chainId: patch.chainId,
        blockNumber: patch.blockNumber,
        settlementId: patch.settlementId,
        errorMessage: patch.errorMessage,
      })
      .where(eq(txLog.id, id))
      .returning()

    if (!row) throw new Error(`Failed to update tx_log ${id}`)
    return toTxLogEntry(row)
  }

  async findByRequestId(address: string, requestId: string): Promise<TxLogScopedEntry | null> {
    const [row] = await this.database
      .select()
      .from(txLog)
      .where(and(eq(txLog.address, address), eq(txLog.requestId, requestId)))
      .orderBy(desc(txLog.createdAt))
      .limit(1)

    return row ? toTxLogScopedEntry(row) : null
  }

  async listByAddress(address: string, limit = 50): Promise<TxLogEntry[]> {
    const rows = await this.database
      .select()
      .from(txLog)
      .where(eq(txLog.address, address))
      .orderBy(desc(txLog.createdAt))
      .limit(limit)

    return rows.map(toTxLogEntry)
  }

  async listByResearchId(address: string, researchId: string, limit = 50): Promise<TxLogEntry[]> {
    const normalizedResearchId = normalizeResearchId(researchId)
    if (!normalizedResearchId) return []

    const rows = await this.database
      .select()
      .from(txLog)
      .where(and(eq(txLog.address, address), eq(txLog.researchId, normalizedResearchId)))
      .orderBy(desc(txLog.createdAt))
      .limit(limit)

    return rows.map(toTxLogEntry)
  }

  async listPendingByResearchId(address: string, researchId: string, limit = 50): Promise<TxLogScopedEntry[]> {
    const normalizedResearchId = normalizeResearchId(researchId)
    if (!normalizedResearchId) return []

    const rows = await this.database
      .select()
      .from(txLog)
      .where(and(
        eq(txLog.address, address),
        eq(txLog.researchId, normalizedResearchId),
        eq(txLog.txStatus, 'pending'),
        isNotNull(txLog.requestId),
      ))
      .orderBy(desc(txLog.createdAt))
      .limit(limit)

    return rows.map(toTxLogScopedEntry)
  }

  async markResearchSettlementConfirmed(input: TxLogSettlementConfirmInput): Promise<TxLogScopedEntry[]> {
    const normalizedResearchId = normalizeResearchId(input.researchId)
    if (!normalizedResearchId || input.requestIds.length === 0) return []

    const rows = await this.database
      .update(txLog)
      .set({
        txHash: input.txHash,
        txStatus: input.txStatus ?? 'confirmed',
        chainId: input.chainId,
        blockNumber: input.blockNumber,
        settlementId: input.settlementId,
        errorMessage: null,
      })
      .where(and(
        eq(txLog.address, input.address),
        eq(txLog.researchId, normalizedResearchId),
        inArray(txLog.requestId, input.requestIds),
      ))
      .returning()

    return rows.map(toTxLogScopedEntry)
  }

  async markResearchSettlementFailed(input: TxLogSettlementFailInput): Promise<TxLogScopedEntry[]> {
    const normalizedResearchId = normalizeResearchId(input.researchId)
    if (!normalizedResearchId || input.requestIds.length === 0) return []

    const rows = await this.database
      .update(txLog)
      .set({
        txHash: input.txHash ?? null,
        txStatus: 'failed',
        chainId: input.chainId ?? null,
        blockNumber: input.blockNumber ?? null,
        settlementId: input.settlementId,
        errorMessage: input.errorMessage,
      })
      .where(and(
        eq(txLog.address, input.address),
        eq(txLog.researchId, normalizedResearchId),
        inArray(txLog.requestId, input.requestIds),
      ))
      .returning()

    return rows.map(toTxLogScopedEntry)
  }

  async totalSpentByAddress(address: string): Promise<string> {
    const [row] = await this.database
      .select({ value: sql<string>`coalesce(sum(${txLog.amount}), 0)` })
      .from(txLog)
      .where(and(eq(txLog.address, address), inArray(txLog.txStatus, [...BILLABLE_TX_STATUSES])))

    return normalizeDecimalString(row?.value ?? '0')
  }

  async count(): Promise<number> {
    const [row] = await this.database
      .select({ value: count() })
      .from(txLog)
      .where(inArray(txLog.txStatus, [...BILLABLE_TX_STATUSES]))
    return Number(row?.value ?? 0)
  }

  async totalSpent(): Promise<string> {
    const [row] = await this.database
      .select({ value: sql<string>`coalesce(sum(${txLog.amount}), 0)` })
      .from(txLog)
      .where(inArray(txLog.txStatus, [...BILLABLE_TX_STATUSES]))
    return normalizeDecimalString(row?.value ?? '0')
  }
}
