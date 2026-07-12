import { randomUUID } from 'node:crypto'
import type {
  BeginActivationInput,
  CompleteFundingExpiryInput,
  CreateFundingQuotaReservationInput,
  CreateFundingResearchInput,
  CreateFundingWithQuotaReservationResult,
  RequestCancellationInput,
  RequestFinalizationInput,
  Research,
  ResearchLifecycle,
  ResearchLifecyclePatch,
  ResearchRepo,
  ResearchStatus,
} from './research-repo'
import { nextResearchLifecycle } from './research-repo'
import { MemoryResearchQuotaStore } from './research-quota-repo-memory'
import { decimalToUnits, unitsToDecimal } from './tx-log-repo'

export class MemoryResearchRepo implements ResearchRepo {
  private records = new Map<string, Research>()

  constructor(private readonly quotaStore = new MemoryResearchQuotaStore()) {}

  private clone(record: Research): Research {
    return {
      ...record,
      createdAt: new Date(record.createdAt),
      preparedAt: record.preparedAt ? new Date(record.preparedAt) : null,
      fundingExpiresAt: record.fundingExpiresAt ? new Date(record.fundingExpiresAt) : null,
      expectedExpiresAt: record.expectedExpiresAt ? new Date(record.expectedExpiresAt) : null,
      fundingDeadline: record.fundingDeadline ? new Date(record.fundingDeadline) : null,
      cancelRequestedAt: record.cancelRequestedAt ? new Date(record.cancelRequestedAt) : null,
      startedAt: record.startedAt ? new Date(record.startedAt) : null,
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
    }
  }

  async create(input: { address: string; topic: string; budgetUsdc: string }): Promise<Research> {
    const now = new Date()
    const record: Research = {
      id: randomUUID(),
      address: input.address,
      prepareRequestId: null,
      buyer: null,
      topic: input.topic,
      budgetUsdc: input.budgetUsdc,
      budgetUnits: null,
      spentUsdc: '0',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
      researchKey: null,
      expectedEscrowAddress: null,
      escrowAddress: null,
      reportMd: null,
      errorMessage: null,
      createdAt: now,
      preparedAt: null,
      fundingExpiresAt: null,
      expectedExpiresAt: null,
      fundingDeadline: null,
      intentSigner: null,
      voucherNonce: null,
      quotaDate: null,
      cancelRequestedAt: null,
      chainId: null,
      startedAt: now,
      completedAt: null,
    }
    this.records.set(record.id, record)
    return this.clone(record)
  }

  async createFunding(input: CreateFundingResearchInput): Promise<Research> {
    const now = new Date()
    const record: Research = {
      id: input.id ?? randomUUID(),
      address: input.address,
      prepareRequestId: input.prepareRequestId ?? null,
      buyer: input.buyer ?? input.address,
      topic: input.topic,
      budgetUsdc: input.budgetUsdc,
      budgetUnits: input.budgetUnits ?? null,
      spentUsdc: '0',
      status: 'funding',
      activationPhase: 'none',
      finalizationState: 'none',
      quotaReservationState: 'reserved',
      researchKey: input.researchKey ?? null,
      expectedEscrowAddress: input.expectedEscrowAddress ?? null,
      escrowAddress: input.escrowAddress ?? null,
      reportMd: null,
      errorMessage: null,
      createdAt: now,
      preparedAt: now,
      fundingExpiresAt: new Date(input.fundingExpiresAt),
      expectedExpiresAt: input.expectedExpiresAt ? new Date(input.expectedExpiresAt) : null,
      fundingDeadline: input.fundingDeadline ? new Date(input.fundingDeadline) : null,
      intentSigner: input.intentSigner ?? null,
      voucherNonce: input.voucherNonce ?? null,
      quotaDate: input.quotaDate ?? null,
      cancelRequestedAt: input.cancelRequestedAt ? new Date(input.cancelRequestedAt) : null,
      chainId: input.chainId ?? null,
      startedAt: null,
      completedAt: null,
    }
    this.records.set(record.id, record)
    return this.clone(record)
  }

  async createFundingWithQuotaReservation(
    input: CreateFundingResearchInput,
    quota: CreateFundingQuotaReservationInput,
  ): Promise<CreateFundingWithQuotaReservationResult> {
    if (input.prepareRequestId) {
      const existing = await this.findByPrepareRequestId(input.prepareRequestId)
      if (existing) return { ok: true, research: existing }
    }

    const address = input.address.toLowerCase()
    const reserved = this.quotaStore.reserve({
      address,
      day: quota.day,
      resetAt: quota.resetAt,
      walletLimit: quota.walletLimit,
      globalLimit: quota.globalLimit,
    })
    if (!reserved.ok) return { ok: false, reason: reserved.reason }

    const research = await this.createFunding({
      ...input,
      address,
      quotaDate: input.quotaDate ?? quota.day,
    })
    return { ok: true, research }
  }

  async consumeQuotaReservation(id: string): Promise<boolean> {
    return this.finishQuotaReservation(id, 'consumed')
  }

  async releaseQuotaReservation(id: string): Promise<boolean> {
    return this.finishQuotaReservation(id, 'released')
  }

  async beginActivation(input: BeginActivationInput): Promise<boolean> {
    const record = this.records.get(input.id)
    if (!record) return false

    const current = lifecycleOf(record)
    if (!sameLifecycle(current, input.expected)) return false
    const next = nextResearchLifecycle(current, input.next)
    if (!next || next.quotaReservationState !== 'activating') return false

    const recordsSnapshot = new Map(this.records)
    try {
      this.records.set(input.id, {
        ...record,
        ...next,
        errorMessage: input.next.status && input.next.status !== 'failed' ? null : record.errorMessage,
      })
      if (!input.workflowOutboxRepo) throw new Error('workflowOutboxRepo is required')
      const operation = await input.workflowOutboxRepo.claimOperation(input.activateOperation)
      if (operation.status !== 'claimed') throw new Error('ACTIVATE operation already exists')
      return true
    } catch {
      this.records = recordsSnapshot
      return false
    }
  }

  async completeFundingExpiry(input: CompleteFundingExpiryInput): Promise<boolean> {
    const record = this.records.get(input.id)
    if (!record || !record.quotaDate) return false

    const current = lifecycleOf(record)
    if (!sameLifecycle(current, input.expected)) return false
    const next = nextResearchLifecycle(current, input.next)
    if (!next || !isQuotaTerminal(next.quotaReservationState)) return false
    if (record.quotaReservationState !== 'reserved' && record.quotaReservationState !== 'activating') return false

    const recordsSnapshot = new Map(this.records)
    const quotaSnapshot = this.quotaStore.snapshot()

    try {
      this.applyQuotaReservation(record, next.quotaReservationState)
      const now = new Date()
      this.records.set(input.id, {
        ...record,
        ...next,
        errorMessage: input.next.status && input.next.status !== 'failed' ? null : record.errorMessage,
        startedAt: record.startedAt ?? (next.status === 'running' ? now : null),
        completedAt: next.status === 'running' || next.status === 'funding' ? null : record.completedAt ?? now,
      })
      if (input.runOperation) {
        if (!input.workflowOutboxRepo) throw new Error('workflowOutboxRepo is required')
        await input.workflowOutboxRepo.claimOperation(input.runOperation)
      }
      return true
    } catch {
      this.records = recordsSnapshot
      this.quotaStore.restore(quotaSnapshot)
      return false
    }
  }

  async requestCancellation(input: RequestCancellationInput): Promise<boolean> {
    return this.requestFinalization({
      ...input,
      errorMessage: 'Research cancelled',
    })
  }

  async requestFinalization(input: RequestFinalizationInput): Promise<boolean> {
    const record = this.records.get(input.id)
    if (!record) return false

    const current = lifecycleOf(record)
    if (!sameLifecycle(current, input.expected)) return false
    const next = nextResearchLifecycle(current, input.next)
    if (!next || next.status === 'running' || next.finalizationState !== 'closing') return false

    const recordsSnapshot = new Map(this.records)
    try {
      const now = new Date()
      this.records.set(input.id, {
        ...record,
        ...next,
        cancelRequestedAt: next.status === 'cancelled' ? record.cancelRequestedAt ?? now : record.cancelRequestedAt,
        reportMd: input.reportMd !== undefined ? input.reportMd : record.reportMd,
        errorMessage: input.errorMessage,
        completedAt: record.completedAt ?? now,
      })
      if (!input.workflowOutboxRepo) throw new Error('workflowOutboxRepo is required')
      if (input.settleOperation) {
        const operation = await input.workflowOutboxRepo.claimOperation(input.settleOperation)
        if (operation.status !== 'claimed') throw new Error('SETTLE operation already exists')
      }
      if (input.reconcileOperation) {
        const operation = await input.workflowOutboxRepo.claimOperation(input.reconcileOperation)
        if (operation.status !== 'claimed') throw new Error('RECONCILE operation already exists')
      }
      const operation = await input.workflowOutboxRepo.claimOperation(input.closeOperation)
      if (operation.status !== 'claimed') throw new Error('CLOSE operation already exists')
      return true
    } catch {
      this.records = recordsSnapshot
      return false
    }
  }

  async findByPrepareRequestId(prepareRequestId: string): Promise<Research | null> {
    for (const record of this.records.values()) {
      if (record.prepareRequestId === prepareRequestId) return this.clone(record)
    }
    return null
  }

  async findById(id: string): Promise<Research | null> {
    const record = this.records.get(id)
    return record ? this.clone(record) : null
  }

  async updateStatus(id: string, status: ResearchStatus, errorMessage?: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return

    this.records.set(id, {
      ...record,
      status,
      finalizationState: status === 'running' ? record.finalizationState : 'closing',
      errorMessage: errorMessage ?? (status === 'failed' ? record.errorMessage : null),
      completedAt: status === 'running' ? null : new Date(),
    })
  }

  async updateStatusIfCurrent(
    id: string,
    expectedStatus: ResearchStatus,
    status: ResearchStatus,
    errorMessage?: string,
  ): Promise<boolean> {
    const record = this.records.get(id)
    if (!record || record.status !== expectedStatus) return false

    this.records.set(id, {
      ...record,
      status,
      finalizationState: status === 'running' ? record.finalizationState : 'closing',
      errorMessage: errorMessage ?? (status === 'failed' ? record.errorMessage : null),
      completedAt: status === 'running' ? null : new Date(),
    })
    return true
  }

  async transitionLifecycle(id: string, expected: ResearchLifecycle, patch: ResearchLifecyclePatch): Promise<boolean> {
    const record = this.records.get(id)
    if (!record) return false

    const current: ResearchLifecycle = {
      status: record.status,
      activationPhase: record.activationPhase,
      finalizationState: record.finalizationState,
      quotaReservationState: record.quotaReservationState,
    }
    if (
      current.status !== expected.status
      || current.activationPhase !== expected.activationPhase
      || current.finalizationState !== expected.finalizationState
      || current.quotaReservationState !== expected.quotaReservationState
    ) {
      return false
    }

    const next = nextResearchLifecycle(current, patch)
    if (!next) return false

    const now = new Date()
    this.records.set(id, {
      ...record,
      ...next,
      errorMessage: patch.status && patch.status !== 'failed' ? null : record.errorMessage,
      startedAt: record.startedAt ?? (next.status === 'running' ? now : null),
      completedAt: next.status === 'running' || next.status === 'funding' ? null : record.completedAt ?? now,
    })
    return true
  }

  async completeIfRunning(id: string, reportMd: string): Promise<boolean> {
    const record = this.records.get(id)
    if (!record || record.status !== 'running') return false

    this.records.set(id, {
      ...record,
      status: 'completed',
      finalizationState: 'closing',
      reportMd,
      errorMessage: null,
      completedAt: new Date(),
    })
    return true
  }

  async appendSpent(id: string, deltaUsdc: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return

    const nextSpent = unitsToDecimal(decimalToUnits(record.spentUsdc) + decimalToUnits(deltaUsdc))
    this.records.set(id, { ...record, spentUsdc: nextSpent })
  }

  async setReport(id: string, reportMd: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return

    this.records.set(id, { ...record, reportMd })
  }

  async listByAddress(address: string, limit = 50): Promise<Research[]> {
    return [...this.records.values()]
      .filter((record) => record.address === address)
      .sort((a, b) => {
        const timeDiff = b.createdAt.getTime() - a.createdAt.getTime()
        if (timeDiff !== 0) return timeDiff
        return b.id.localeCompare(a.id)
      })
      .slice(0, limit)
      .map((record) => this.clone(record))
  }

  async countAll(): Promise<number> {
    return this.records.size
  }

  async countRunning(): Promise<number> {
    return [...this.records.values()].filter((record) => record.status === 'running').length
  }

  private finishQuotaReservation(id: string, target: 'consumed' | 'released') {
    const record = this.records.get(id)
    if (!record || !record.quotaDate) return false
    if (record.quotaReservationState !== 'reserved' && record.quotaReservationState !== 'activating') {
      return false
    }

    this.applyQuotaReservation(record, target)
    this.records.set(id, { ...record, quotaReservationState: target })
    return true
  }

  private applyQuotaReservation(record: Research, target: 'consumed' | 'released') {
    if (!record.quotaDate) return
    if (target === 'consumed') {
      this.quotaStore.consumeReservation({ address: record.address, day: record.quotaDate })
      return
    }
    this.quotaStore.releaseReservation({ address: record.address, day: record.quotaDate })
  }
}

function lifecycleOf(record: Research): ResearchLifecycle {
  return {
    status: record.status,
    activationPhase: record.activationPhase,
    finalizationState: record.finalizationState,
    quotaReservationState: record.quotaReservationState,
  }
}

function sameLifecycle(left: ResearchLifecycle, right: ResearchLifecycle) {
  return left.status === right.status
    && left.activationPhase === right.activationPhase
    && left.finalizationState === right.finalizationState
    && left.quotaReservationState === right.quotaReservationState
}

function isQuotaTerminal(value: ResearchLifecycle['quotaReservationState']): value is 'consumed' | 'released' {
  return value === 'consumed' || value === 'released'
}
