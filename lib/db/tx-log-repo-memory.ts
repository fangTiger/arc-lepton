import { randomBytes, randomUUID } from 'node:crypto'
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
} from './tx-log-repo'
import {
  PaymentIdempotencyConflictError,
  canonicalResearchPaymentIntentSnapshot,
  decimalToUnits,
  isBillableTxStatus,
  normalizeResearchId,
  sameRequestScope,
  sameResearchPaymentIntentScope,
  unitsToDecimal,
} from './tx-log-repo'

function mockTxHash() {
  return `0x${randomBytes(32).toString('hex')}`
}

function resolveTxHash(entry: TxLogRecordInput) {
  if (entry.txHash !== undefined) return entry.txHash
  if ((entry.txStatus ?? 'mock') === 'failed' || (entry.txStatus ?? 'mock') === 'pending') return null
  return mockTxHash()
}

export class MemoryTxLogRepo implements TxLogRepo {
  private entries = new Map<string, TxLogEntry>()
  private requestIndex = new Map<string, string>()
  private researchToolOrdinalIndex = new Map<string, string>()

  private requestKey(address: string, requestId: string) {
    return `${address}::${requestId}`
  }

  private researchToolOrdinalKey(address: string, researchId: string, toolOrdinal: number) {
    return `${address}::${researchId}::${toolOrdinal}`
  }

  private cloneEntry<T extends TxLogEntry>(entry: T): T {
    return { ...entry, createdAt: new Date(entry.createdAt) } as T
  }

  private entryForRequest(address: string, requestId: string): TxLogScopedEntry | null {
    const id = this.requestIndex.get(this.requestKey(address, requestId))
    if (!id) return null
    return (this.entries.get(id) as TxLogScopedEntry | undefined) ?? null
  }

  private assertUniqueRequest(address: string, requestId: string) {
    const existing = this.entryForRequest(address, requestId)
    if (existing) throw new PaymentIdempotencyConflictError(requestId, this.cloneEntry(existing))
  }

  async record(entry: TxLogRecordInput): Promise<TxLogEntry> {
    const id = randomUUID()
    const requestId = entry.requestId ?? randomUUID()
    this.assertUniqueRequest(entry.address, requestId)
    const record: TxLogEntry = {
      id,
      address: entry.address,
      source: entry.source,
      amount: entry.amount,
      researchId: normalizeResearchId(entry.researchId),
      txHash: resolveTxHash(entry),
      txStatus: entry.txStatus ?? 'mock',
      chainId: entry.chainId ?? null,
      blockNumber: entry.blockNumber ?? null,
      settlementId: entry.settlementId ?? null,
      requestId,
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
      createdAt: new Date(),
    }

    this.entries.set(id, record)
    this.requestIndex.set(this.requestKey(record.address, requestId), id)
    return this.cloneEntry(record)
  }

  async claimRequest(input: TxLogClaimInput): Promise<TxLogClaimResult> {
    const researchId = normalizeResearchId(input.researchId)
    const existing = this.entryForRequest(input.address, input.requestId)
    if (existing) {
      if (existing.backend === 'escrow') {
        throw new PaymentIdempotencyConflictError(input.requestId, this.cloneEntry(existing))
      }
      if (!sameRequestScope(existing, { ...input, researchId })) {
        throw new PaymentIdempotencyConflictError(input.requestId, this.cloneEntry(existing))
      }
      if (existing.txStatus === 'pending') return { status: 'pending', entry: this.cloneEntry(existing) }
      if (existing.txStatus === 'failed') return { status: 'failed', entry: this.cloneEntry(existing) }
      return { status: 'existing', entry: this.cloneEntry(existing) }
    }

    const entry = await this.record({
      address: input.address,
      source: input.source,
      amount: input.amount,
      researchId,
      requestId: input.requestId,
      txHash: null,
      txStatus: 'pending',
      chainId: null,
      blockNumber: null,
      settlementId: null,
      errorMessage: null,
    })
    if (!entry.requestId) throw new Error(`tx_log ${entry.id} is missing requestId`)

    return { status: 'claimed', entry: entry as TxLogScopedEntry }
  }

  async claimResearchPaymentIntent(input: TxLogResearchPaymentIntentInput): Promise<TxLogClaimResult> {
    const snapshot = canonicalResearchPaymentIntentSnapshot(input)
    const toolOrdinalKey = this.researchToolOrdinalKey(snapshot.address, snapshot.researchId, snapshot.toolOrdinal)
    const existingToolOrdinalId = this.researchToolOrdinalIndex.get(toolOrdinalKey)
    if (existingToolOrdinalId) {
      const existing = this.entries.get(existingToolOrdinalId) as TxLogScopedEntry | undefined
      if (existing) return this.resolveExistingResearchPaymentIntent(existing, snapshot)
    }

    const existing = this.entryForRequest(snapshot.address, snapshot.requestId)
    if (existing) {
      this.researchToolOrdinalIndex.set(toolOrdinalKey, existing.id)
      return this.resolveExistingResearchPaymentIntent(existing, snapshot)
    }

    const entry = await this.record({
      address: snapshot.address,
      source: snapshot.source,
      amount: snapshot.amount,
      researchId: snapshot.researchId,
      requestId: snapshot.requestId,
      txHash: null,
      txStatus: 'pending',
      chainId: null,
      blockNumber: null,
      settlementId: null,
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
    this.researchToolOrdinalIndex.set(toolOrdinalKey, entry.id)
    return { status: 'claimed', entry: entry as TxLogScopedEntry }
  }

  private resolveExistingResearchPaymentIntent(
    existing: TxLogScopedEntry,
    snapshot: ReturnType<typeof canonicalResearchPaymentIntentSnapshot>,
  ): TxLogClaimResult {
    if (!sameResearchPaymentIntentScope(existing, snapshot)) {
      throw new PaymentIdempotencyConflictError(snapshot.requestId, this.cloneEntry(existing))
    }
    if (existing.txStatus === 'pending') return { status: 'pending', entry: this.cloneEntry(existing) }
    if (existing.txStatus === 'failed') return { status: 'failed', entry: this.cloneEntry(existing) }
    return { status: 'existing', entry: this.cloneEntry(existing) }
  }

  async updateReceipt(id: string, patch: TxLogReceiptPatch): Promise<TxLogEntry> {
    const existing = this.entries.get(id)
    if (!existing) throw new Error(`tx_log ${id} not found`)

    const updated: TxLogEntry = {
      ...existing,
      txHash: patch.txHash !== undefined ? patch.txHash : existing.txHash,
      txStatus: patch.txStatus ?? existing.txStatus,
      chainId: patch.chainId !== undefined ? patch.chainId : existing.chainId,
      blockNumber: patch.blockNumber !== undefined ? patch.blockNumber : existing.blockNumber,
      settlementId: patch.settlementId !== undefined ? patch.settlementId : existing.settlementId,
      errorMessage: patch.errorMessage !== undefined ? patch.errorMessage : existing.errorMessage,
    }

    this.entries.set(id, updated)
    return this.cloneEntry(updated)
  }

  async findByRequestId(address: string, requestId: string): Promise<TxLogScopedEntry | null> {
    const entry = this.entryForRequest(address, requestId)
    return entry ? this.cloneEntry(entry) : null
  }

  async listByAddress(address: string, limit = 50): Promise<TxLogEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.address === address)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((entry) => this.cloneEntry(entry))
  }

  async listByResearchId(address: string, researchId: string, limit = 50): Promise<TxLogEntry[]> {
    const normalizedResearchId = normalizeResearchId(researchId)
    if (!normalizedResearchId) return []

    return [...this.entries.values()]
      .filter((entry) => entry.address === address && entry.researchId === normalizedResearchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((entry) => this.cloneEntry(entry))
  }

  async listPendingByResearchId(address: string, researchId: string, limit = 50): Promise<TxLogScopedEntry[]> {
    const normalizedResearchId = normalizeResearchId(researchId)
    if (!normalizedResearchId) return []

    return [...this.entries.values()]
      .filter((entry): entry is TxLogScopedEntry => (
        entry.address === address
        && entry.researchId === normalizedResearchId
        && entry.txStatus === 'pending'
        && Boolean(entry.requestId)
      ))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((entry) => this.cloneEntry(entry))
  }

  async markResearchSettlementConfirmed(input: TxLogSettlementConfirmInput): Promise<TxLogScopedEntry[]> {
    const requestIds = new Set(input.requestIds)
    const normalizedResearchId = normalizeResearchId(input.researchId)
    if (!normalizedResearchId || requestIds.size === 0) return []

    const updated: TxLogScopedEntry[] = []
    for (const entry of this.entries.values()) {
      if (
        entry.address !== input.address
        || entry.researchId !== normalizedResearchId
        || !entry.requestId
        || !requestIds.has(entry.requestId)
      ) {
        continue
      }

      const next: TxLogScopedEntry = {
        ...entry,
        txHash: input.txHash,
        txStatus: input.txStatus ?? 'confirmed',
        chainId: input.chainId,
        blockNumber: input.blockNumber,
        settlementId: input.settlementId,
        errorMessage: null,
        requestId: entry.requestId,
      }
      this.entries.set(entry.id, next)
      updated.push(this.cloneEntry(next))
    }

    return updated
  }

  async markResearchSettlementFailed(input: TxLogSettlementFailInput): Promise<TxLogScopedEntry[]> {
    const requestIds = new Set(input.requestIds)
    const normalizedResearchId = normalizeResearchId(input.researchId)
    if (!normalizedResearchId || requestIds.size === 0) return []

    const updated: TxLogScopedEntry[] = []
    for (const entry of this.entries.values()) {
      if (
        entry.address !== input.address
        || entry.researchId !== normalizedResearchId
        || !entry.requestId
        || !requestIds.has(entry.requestId)
      ) {
        continue
      }

      const next: TxLogScopedEntry = {
        ...entry,
        txHash: input.txHash ?? null,
        txStatus: 'failed',
        chainId: input.chainId ?? null,
        blockNumber: input.blockNumber ?? null,
        settlementId: input.settlementId,
        errorMessage: input.errorMessage,
        requestId: entry.requestId,
      }
      this.entries.set(entry.id, next)
      updated.push(this.cloneEntry(next))
    }

    return updated
  }

  async totalSpentByAddress(address: string): Promise<string> {
    const total = [...this.entries.values()]
      .filter((entry) => entry.address === address && isBillableTxStatus(entry.txStatus))
      .reduce((sum, entry) => sum + decimalToUnits(entry.amount), 0n)

    return unitsToDecimal(total)
  }

  async count(): Promise<number> {
    return [...this.entries.values()].filter((entry) => isBillableTxStatus(entry.txStatus)).length
  }

  async totalSpent(): Promise<string> {
    const total = [...this.entries.values()]
      .filter((entry) => isBillableTxStatus(entry.txStatus))
      .reduce((sum, entry) => sum + decimalToUnits(entry.amount), 0n)
    return unitsToDecimal(total)
  }
}
