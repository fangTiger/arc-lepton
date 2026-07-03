import { randomUUID } from 'node:crypto'
import type {
  PaymentSettlement,
  PaymentSettlementClaimInput,
  PaymentSettlementClaimResult,
  PaymentSettlementConfirmedReconcileQuery,
  PaymentSettlementFailurePatch,
  PaymentSettlementReceiptPatch,
  PaymentSettlementRepo,
  PaymentSettlementRetryClaimInput,
  PaymentSettlementRetryQuery,
} from './payment-settlement-repo'
import { isManualRecoveryErrorMessage, normalizeSettlementResearchId } from './payment-settlement-repo'

function isAutomaticallyRetryableFailedSettlement(settlement: PaymentSettlement) {
  return (
    settlement.status === 'failed'
    && settlement.txHash === null
    && !isManualRecoveryErrorMessage(settlement.errorMessage)
  )
}

export class MemoryPaymentSettlementRepo implements PaymentSettlementRepo {
  private settlements = new Map<string, PaymentSettlement>()
  private scopeIndex = new Map<string, string>()

  private scopeKey(address: string, researchId: string) {
    return `${address}::${normalizeSettlementResearchId(researchId)}`
  }

  private clone(settlement: PaymentSettlement): PaymentSettlement {
    return {
      ...settlement,
      requestIds: [...settlement.requestIds],
      createdAt: new Date(settlement.createdAt),
      updatedAt: new Date(settlement.updatedAt),
    }
  }

  async claimResearchSettlement(input: PaymentSettlementClaimInput): Promise<PaymentSettlementClaimResult> {
    const researchId = normalizeSettlementResearchId(input.researchId)
    const scopeKey = this.scopeKey(input.address, researchId)
    const existingId = this.scopeIndex.get(scopeKey)
    const existing = existingId ? this.settlements.get(existingId) : undefined

    if (existing) {
      if (existing.status === 'failed') {
        if (!isAutomaticallyRetryableFailedSettlement(existing)) {
          return { status: 'existing', settlement: this.clone(existing) }
        }

        const updated: PaymentSettlement = {
          ...existing,
          requestIds: [...input.requestIds],
          totalAmount: input.totalAmount,
          status: 'broadcasting',
          txHash: null,
          chainId: null,
          blockNumber: null,
          attempts: existing.attempts + 1,
          errorMessage: null,
          updatedAt: new Date(),
        }
        this.settlements.set(updated.id, updated)
        return { status: 'claimed', settlement: this.clone(updated) }
      }

      return { status: 'existing', settlement: this.clone(existing) }
    }

    const now = new Date()
    const settlement: PaymentSettlement = {
      id: randomUUID(),
      address: input.address,
      researchId,
      requestIds: [...input.requestIds],
      totalAmount: input.totalAmount,
      status: 'broadcasting',
      txHash: null,
      chainId: null,
      blockNumber: null,
      attempts: 1,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    }

    this.settlements.set(settlement.id, settlement)
    this.scopeIndex.set(scopeKey, settlement.id)
    return { status: 'claimed', settlement: this.clone(settlement) }
  }

  async claimRetryableSettlement(
    id: string,
    input: PaymentSettlementRetryClaimInput = {},
  ): Promise<PaymentSettlementClaimResult> {
    const existing = this.settlements.get(id)
    if (!existing) throw new Error(`payment_settlement ${id} not found`)
    if (existing.status === 'failed' && !isAutomaticallyRetryableFailedSettlement(existing)) {
      return { status: 'existing', settlement: this.clone(existing) }
    }

    const isStaleBroadcasting = (
      existing.status === 'broadcasting'
      && Boolean(input.staleBroadcastingBefore)
      && existing.updatedAt <= (input.staleBroadcastingBefore as Date)
    )
    if (existing.status !== 'failed' && !isStaleBroadcasting) {
      return { status: 'existing', settlement: this.clone(existing) }
    }

    const updated: PaymentSettlement = existing.status === 'failed'
      ? {
          ...existing,
          status: 'broadcasting',
          txHash: null,
          chainId: null,
          blockNumber: null,
          attempts: existing.attempts + 1,
          errorMessage: null,
          updatedAt: new Date(),
        }
      : {
          ...existing,
          status: 'broadcasting',
          attempts: existing.attempts + 1,
          errorMessage: null,
          updatedAt: new Date(),
        }
    this.settlements.set(id, updated)
    return { status: 'claimed', settlement: this.clone(updated) }
  }

  async recordSettlementReceipt(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement> {
    const existing = this.settlements.get(id)
    if (!existing) throw new Error(`payment_settlement ${id} not found`)

    const updated: PaymentSettlement = {
      ...existing,
      txHash: patch.txHash,
      chainId: patch.chainId,
      blockNumber: patch.blockNumber,
      errorMessage: null,
      updatedAt: new Date(),
    }
    this.settlements.set(id, updated)
    return this.clone(updated)
  }

  async confirmSettlement(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement> {
    const existing = this.settlements.get(id)
    if (!existing) throw new Error(`payment_settlement ${id} not found`)

    const updated: PaymentSettlement = {
      ...existing,
      status: 'confirmed',
      txHash: patch.txHash,
      chainId: patch.chainId,
      blockNumber: patch.blockNumber,
      errorMessage: null,
      updatedAt: new Date(),
    }
    this.settlements.set(id, updated)
    return this.clone(updated)
  }

  async failSettlement(id: string, patch: PaymentSettlementFailurePatch): Promise<PaymentSettlement> {
    const existing = this.settlements.get(id)
    if (!existing) throw new Error(`payment_settlement ${id} not found`)

    const updated: PaymentSettlement = {
      ...existing,
      status: 'failed',
      txHash: patch.txHash ?? null,
      chainId: patch.chainId ?? null,
      blockNumber: patch.blockNumber ?? null,
      errorMessage: patch.errorMessage,
      updatedAt: new Date(),
    }
    this.settlements.set(id, updated)
    return this.clone(updated)
  }

  async findById(id: string): Promise<PaymentSettlement | null> {
    const settlement = this.settlements.get(id)
    return settlement ? this.clone(settlement) : null
  }

  async listRetryableSettlements(query: PaymentSettlementRetryQuery = {}): Promise<PaymentSettlement[]> {
    const limit = query.limit ?? 50
    return [...this.settlements.values()]
      .filter((settlement) => (
        isAutomaticallyRetryableFailedSettlement(settlement)
        || (
          settlement.status === 'broadcasting'
          && Boolean(query.staleBroadcastingBefore)
          && settlement.updatedAt <= (query.staleBroadcastingBefore as Date)
        )
      ))
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit)
      .map((settlement) => this.clone(settlement))
  }

  async listConfirmedSettlementsNeedingReconcile(query: PaymentSettlementConfirmedReconcileQuery = {}): Promise<PaymentSettlement[]> {
    const limit = query.limit ?? 50
    return [...this.settlements.values()]
      .filter((settlement) => settlement.status === 'confirmed')
      .sort((a, b) => {
        const timeDiff = a.updatedAt.getTime() - b.updatedAt.getTime()
        if (timeDiff !== 0) return timeDiff
        return a.id.localeCompare(b.id)
      })
      .filter((settlement) => {
        if (!query.afterUpdatedAt || !query.afterId) return true
        const timeDiff = settlement.updatedAt.getTime() - query.afterUpdatedAt.getTime()
        return timeDiff > 0 || (timeDiff === 0 && settlement.id.localeCompare(query.afterId) > 0)
      })
      .slice(0, limit)
      .map((settlement) => this.clone(settlement))
  }

  async count(): Promise<number> {
    return this.settlements.size
  }
}
