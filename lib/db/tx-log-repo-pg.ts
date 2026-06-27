import { randomBytes, randomUUID } from 'node:crypto'
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { txLog } from './schema/tx-log'
import type { TxLogClaimInput, TxLogClaimResult, TxLogEntry, TxLogReceiptPatch, TxLogRecordInput, TxLogRepo, TxLogScopedEntry, TxStatus } from './tx-log-repo'
import {
  BILLABLE_TX_STATUSES,
  PaymentIdempotencyConflictError,
  normalizeDecimalString,
  normalizeResearchId,
  sameRequestScope,
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
        requestId: entry.requestId ?? randomUUID(),
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
        requestId: input.requestId,
        errorMessage: null,
      })
      .onConflictDoNothing({ target: [txLog.address, txLog.requestId] })
      .returning()

    if (claimed) return { status: 'claimed', entry: toTxLogScopedEntry(claimed) }

    const existing = await this.findByRequestId(input.address, input.requestId)
    if (!existing) throw new Error(`Failed to resolve tx_log claim for ${input.address}:${input.requestId}`)
    if (!sameRequestScope(existing, input)) {
      throw new PaymentIdempotencyConflictError(input.requestId, existing)
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
