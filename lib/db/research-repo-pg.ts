import { and, count, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { research } from './schema/research'
import { researchQuotaUsage } from './schema/research-quota'
import { workflowOutbox } from './schema/workflow-outbox'
import type {
  BeginActivationInput,
  CompleteFundingExpiryInput,
  CreateFundingQuotaReservationInput,
  CreateFundingResearchInput,
  CreateFundingWithQuotaReservationResult,
  QuotaLimitFailureReason,
  RequestCancellationInput,
  RequestFinalizationInput,
  Research,
  ResearchLifecycle,
  ResearchLifecyclePatch,
  ResearchRepo,
  ResearchStatus,
} from './research-repo'
import { nextResearchLifecycle } from './research-repo'
import { normalizeWorkflowOperationKey } from './workflow-outbox-repo'

type DbClient = VercelPgDatabase<typeof schema>

class QuotaLimitError extends Error {
  constructor(readonly reason: QuotaLimitFailureReason) {
    super(reason)
    this.name = 'QuotaLimitError'
  }
}

export class PgResearchRepo implements ResearchRepo {
  constructor(private readonly database: DbClient) {}

  async create(input: { address: string; topic: string; budgetUsdc: string }): Promise<Research> {
    const [row] = await this.database.insert(research).values(input).returning()
    if (!row) throw new Error('Failed to create research')
    return row
  }

  async createFunding(input: CreateFundingResearchInput): Promise<Research> {
    const now = new Date()
    const [row] = await this.database
      .insert(research)
      .values({
        id: input.id,
        address: input.address,
        prepareRequestId: input.prepareRequestId ?? null,
        buyer: input.buyer ?? input.address,
        topic: input.topic,
        budgetUsdc: input.budgetUsdc,
        budgetUnits: input.budgetUnits ?? null,
        status: 'funding',
        activationPhase: 'none',
        finalizationState: 'none',
        quotaReservationState: 'reserved',
        researchKey: input.researchKey ?? null,
        expectedEscrowAddress: input.expectedEscrowAddress ?? null,
        escrowAddress: input.escrowAddress ?? null,
        preparedAt: now,
        fundingExpiresAt: input.fundingExpiresAt,
        expectedExpiresAt: input.expectedExpiresAt ?? null,
        fundingDeadline: input.fundingDeadline ?? null,
        intentSigner: input.intentSigner ?? null,
        voucherNonce: input.voucherNonce ?? null,
        quotaDate: input.quotaDate ?? null,
        cancelRequestedAt: input.cancelRequestedAt ?? null,
        chainId: input.chainId ?? null,
        startedAt: null,
      })
      .returning()
    if (!row) throw new Error('Failed to create funding research')
    return row
  }

  async createFundingWithQuotaReservation(
    input: CreateFundingResearchInput,
    quota: CreateFundingQuotaReservationInput,
  ): Promise<CreateFundingWithQuotaReservationResult> {
    try {
      const researchRecord = await this.database.transaction(async (tx) => {
        if (input.prepareRequestId) {
          const existing = await new PgResearchRepo(tx as DbClient).findByPrepareRequestId(input.prepareRequestId)
          if (existing) return existing
        }

        await this.reserveQuotaBucket(tx as DbClient, {
          id: this.walletQuotaId(input.address, quota.day),
          bucketType: 'wallet',
          bucketKey: input.address.toLowerCase(),
          day: quota.day,
          resetAt: quota.resetAt,
          limit: quota.walletLimit,
          reason: 'WALLET_LIMIT',
        })
        await this.reserveQuotaBucket(tx as DbClient, {
          id: this.globalQuotaId(quota.day),
          bucketType: 'global',
          bucketKey: 'global',
          day: quota.day,
          resetAt: quota.resetAt,
          limit: quota.globalLimit,
          reason: 'GLOBAL_LIMIT',
        })

        const repo = new PgResearchRepo(tx as DbClient)
        return repo.createFunding({
          ...input,
          address: input.address.toLowerCase(),
          quotaDate: input.quotaDate ?? quota.day,
        })
      })
      return { ok: true, research: researchRecord }
    } catch (error) {
      if (error instanceof QuotaLimitError) {
        return { ok: false, reason: error.reason }
      }
      if (input.prepareRequestId && isUniqueViolation(error)) {
        const existing = await this.findByPrepareRequestId(input.prepareRequestId)
        if (existing) return { ok: true, research: existing }
      }
      throw error
    }
  }

  async consumeQuotaReservation(id: string): Promise<boolean> {
    return this.finishQuotaReservation(id, 'consumed')
  }

  async releaseQuotaReservation(id: string): Promise<boolean> {
    return this.finishQuotaReservation(id, 'released')
  }

  async beginActivation(input: BeginActivationInput): Promise<boolean> {
    const next = nextResearchLifecycle(input.expected, input.next)
    if (!next || next.quotaReservationState !== 'activating') return false

    return this.database.transaction(async (tx) => {
      const [row] = await tx
        .update(research)
        .set({
          status: next.status,
          activationPhase: next.activationPhase,
          finalizationState: next.finalizationState,
          quotaReservationState: next.quotaReservationState,
          errorMessage: input.next.status && input.next.status !== 'failed' ? null : undefined,
        })
        .where(and(
          eq(research.id, input.id),
          eq(research.status, input.expected.status),
          eq(research.activationPhase, input.expected.activationPhase),
          eq(research.finalizationState, input.expected.finalizationState),
          eq(research.quotaReservationState, input.expected.quotaReservationState),
        ))
        .returning({ id: research.id })
      if (!row) return false

      const inserted = await this.insertWorkflowOperation(tx as DbClient, input.activateOperation, new Date())
      if (!inserted) throw new Error(`ACTIVATE operation already exists: ${input.activateOperation.operationKey}`)
      return true
    })
  }

  async completeFundingExpiry(input: CompleteFundingExpiryInput): Promise<boolean> {
    const next = nextResearchLifecycle(input.expected, input.next)
    if (!next || !isQuotaTerminal(next.quotaReservationState)) return false

    return this.database.transaction(async (tx) => {
      const now = new Date()
      const [row] = await tx
        .update(research)
        .set({
          status: next.status,
          activationPhase: next.activationPhase,
          finalizationState: next.finalizationState,
          quotaReservationState: next.quotaReservationState,
          errorMessage: input.next.status && input.next.status !== 'failed' ? null : undefined,
          startedAt: next.status === 'running' ? now : undefined,
          completedAt: next.status === 'running' || next.status === 'funding' ? null : now,
        })
        .where(and(
          eq(research.id, input.id),
          eq(research.status, input.expected.status),
          eq(research.activationPhase, input.expected.activationPhase),
          eq(research.finalizationState, input.expected.finalizationState),
          eq(research.quotaReservationState, input.expected.quotaReservationState),
          inArray(research.quotaReservationState, ['reserved', 'activating']),
          isNotNull(research.quotaDate),
        ))
        .returning({
          id: research.id,
          address: research.address,
          quotaDate: research.quotaDate,
        })
      if (!row?.quotaDate) return false

      if (next.quotaReservationState === 'consumed') {
        await Promise.all([
          this.consumeReservedQuotaBucket(tx as DbClient, this.walletQuotaId(row.address, row.quotaDate)),
          this.consumeReservedQuotaBucket(tx as DbClient, this.globalQuotaId(row.quotaDate)),
        ])
      } else {
        await Promise.all([
          this.releaseReservedQuotaBucket(tx as DbClient, this.walletQuotaId(row.address, row.quotaDate)),
          this.releaseReservedQuotaBucket(tx as DbClient, this.globalQuotaId(row.quotaDate)),
        ])
      }

      if (input.runOperation) {
        await this.insertWorkflowOperation(tx as DbClient, input.runOperation, now)
      }
      return true
    })
  }

  async requestCancellation(input: RequestCancellationInput): Promise<boolean> {
    return this.requestFinalization({
      ...input,
      errorMessage: 'Research cancelled',
    })
  }

  async requestFinalization(input: RequestFinalizationInput): Promise<boolean> {
    const next = nextResearchLifecycle(input.expected, input.next)
    if (!next || next.status === 'running' || next.finalizationState !== 'closing') return false

    return this.database.transaction(async (tx) => {
      const now = new Date()
      const [row] = await tx
        .update(research)
        .set({
          status: next.status,
          activationPhase: next.activationPhase,
          finalizationState: next.finalizationState,
          quotaReservationState: next.quotaReservationState,
          cancelRequestedAt: next.status === 'cancelled' ? now : undefined,
          reportMd: input.reportMd === undefined ? undefined : input.reportMd,
          errorMessage: input.errorMessage,
          completedAt: now,
        })
        .where(and(
          eq(research.id, input.id),
          eq(research.status, input.expected.status),
          eq(research.activationPhase, input.expected.activationPhase),
          eq(research.finalizationState, input.expected.finalizationState),
          eq(research.quotaReservationState, input.expected.quotaReservationState),
        ))
        .returning({ id: research.id })
      if (!row) return false

      if (input.settleOperation) {
        const inserted = await this.insertWorkflowOperation(tx as DbClient, input.settleOperation, now)
        if (!inserted) throw new Error(`SETTLE operation already exists: ${input.settleOperation.operationKey}`)
      }
      if (input.reconcileOperation) {
        const inserted = await this.insertWorkflowOperation(tx as DbClient, input.reconcileOperation, now)
        if (!inserted) throw new Error(`RECONCILE operation already exists: ${input.reconcileOperation.operationKey}`)
      }
      const inserted = await this.insertWorkflowOperation(tx as DbClient, input.closeOperation, now)
      if (!inserted) throw new Error(`CLOSE operation already exists: ${input.closeOperation.operationKey}`)
      return true
    })
  }

  async findByPrepareRequestId(prepareRequestId: string): Promise<Research | null> {
    const [row] = await this.database
      .select()
      .from(research)
      .where(eq(research.prepareRequestId, prepareRequestId))
      .limit(1)
    return row ?? null
  }

  async findById(id: string): Promise<Research | null> {
    const [row] = await this.database.select().from(research).where(eq(research.id, id)).limit(1)
    return row ?? null
  }

  async updateStatus(id: string, status: ResearchStatus, errorMessage?: string): Promise<void> {
    await this.database
      .update(research)
      .set({
        status,
        finalizationState: status === 'running' ? undefined : 'closing',
        errorMessage: errorMessage ?? null,
        completedAt: status === 'running' ? null : new Date(),
      })
      .where(eq(research.id, id))
  }

  async updateStatusIfCurrent(
    id: string,
    expectedStatus: ResearchStatus,
    status: ResearchStatus,
    errorMessage?: string,
  ): Promise<boolean> {
    const rows = await this.database
      .update(research)
      .set({
        status,
        finalizationState: status === 'running' ? undefined : 'closing',
        errorMessage: errorMessage ?? null,
        completedAt: status === 'running' ? null : new Date(),
      })
      .where(and(eq(research.id, id), eq(research.status, expectedStatus)))
      .returning({ id: research.id })
    return rows.length > 0
  }

  async transitionLifecycle(id: string, expected: ResearchLifecycle, patch: ResearchLifecyclePatch): Promise<boolean> {
    const current = await this.findById(id)
    if (!current) return false
    if (
      current.status !== expected.status
      || current.activationPhase !== expected.activationPhase
      || current.finalizationState !== expected.finalizationState
      || current.quotaReservationState !== expected.quotaReservationState
    ) {
      return false
    }

    const next = nextResearchLifecycle(expected, patch)
    if (!next) return false

    const rows = await this.database
      .update(research)
      .set({
        status: next.status,
        activationPhase: next.activationPhase,
        finalizationState: next.finalizationState,
        quotaReservationState: next.quotaReservationState,
        errorMessage: patch.status && patch.status !== 'failed' ? null : undefined,
        startedAt: current.startedAt ?? (next.status === 'running' ? new Date() : null),
        completedAt: next.status === 'running' || next.status === 'funding' ? null : current.completedAt ?? new Date(),
      })
      .where(and(
        eq(research.id, id),
        eq(research.status, expected.status),
        eq(research.activationPhase, expected.activationPhase),
        eq(research.finalizationState, expected.finalizationState),
        eq(research.quotaReservationState, expected.quotaReservationState),
      ))
      .returning({ id: research.id })
    return rows.length > 0
  }

  async completeIfRunning(id: string, reportMd: string): Promise<boolean> {
    const rows = await this.database
      .update(research)
      .set({
        status: 'completed',
        finalizationState: 'closing',
        reportMd,
        errorMessage: null,
        completedAt: new Date(),
      })
      .where(and(eq(research.id, id), eq(research.status, 'running')))
      .returning({ id: research.id })
    return rows.length > 0
  }

  async appendSpent(id: string, deltaUsdc: string): Promise<void> {
    await this.database
      .update(research)
      .set({ spentUsdc: sql`${research.spentUsdc} + ${deltaUsdc}` })
      .where(eq(research.id, id))
  }

  async setReport(id: string, reportMd: string): Promise<void> {
    await this.database.update(research).set({ reportMd }).where(eq(research.id, id))
  }

  async listByAddress(address: string, limit = 50): Promise<Research[]> {
    return this.database
      .select()
      .from(research)
      .where(eq(research.address, address))
      .orderBy(desc(research.createdAt), desc(research.id))
      .limit(limit)
  }

  async countAll(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(research)
    return Number(row?.value ?? 0)
  }

  async countRunning(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(research).where(eq(research.status, 'running'))
    return Number(row?.value ?? 0)
  }

  private async finishQuotaReservation(id: string, target: 'consumed' | 'released'): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const [row] = await tx
        .update(research)
        .set({ quotaReservationState: target })
        .where(and(
          eq(research.id, id),
          inArray(research.quotaReservationState, ['reserved', 'activating']),
          isNotNull(research.quotaDate),
        ))
        .returning({
          id: research.id,
          address: research.address,
          quotaDate: research.quotaDate,
        })
      if (!row?.quotaDate) return false

      if (target === 'consumed') {
        await Promise.all([
          this.consumeReservedQuotaBucket(tx as DbClient, this.walletQuotaId(row.address, row.quotaDate)),
          this.consumeReservedQuotaBucket(tx as DbClient, this.globalQuotaId(row.quotaDate)),
        ])
      } else {
        await Promise.all([
          this.releaseReservedQuotaBucket(tx as DbClient, this.walletQuotaId(row.address, row.quotaDate)),
          this.releaseReservedQuotaBucket(tx as DbClient, this.globalQuotaId(row.quotaDate)),
        ])
      }
      return true
    })
  }

  private async reserveQuotaBucket(
    database: DbClient,
    input: {
      id: string
      bucketType: 'wallet' | 'global'
      bucketKey: string
      day: string
      resetAt: Date
      limit: number
      reason: QuotaLimitFailureReason
    },
  ) {
    const [row] = await database
      .insert(researchQuotaUsage)
      .values({
        id: input.id,
        bucketType: input.bucketType,
        bucketKey: input.bucketKey,
        day: input.day,
        consumed: 0,
        reserved: 1,
        used: 1,
        resetAt: input.resetAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: researchQuotaUsage.id,
        set: {
          reserved: sql`${researchQuotaUsage.reserved} + 1`,
          used: sql`${researchQuotaUsage.used} + 1`,
          resetAt: input.resetAt,
          updatedAt: new Date(),
        },
      })
      .returning({ used: researchQuotaUsage.used })
    if (Number(row?.used ?? 0) > input.limit) {
      throw new QuotaLimitError(input.reason)
    }
  }

  private async consumeReservedQuotaBucket(database: DbClient, id: string) {
    await database
      .update(researchQuotaUsage)
      .set({
        reserved: sql`greatest(${researchQuotaUsage.reserved} - 1, 0)`,
        consumed: sql`${researchQuotaUsage.consumed} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(researchQuotaUsage.id, id))
  }

  private async releaseReservedQuotaBucket(database: DbClient, id: string) {
    await database
      .update(researchQuotaUsage)
      .set({
        reserved: sql`greatest(${researchQuotaUsage.reserved} - 1, 0)`,
        used: sql`greatest(${researchQuotaUsage.used} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(researchQuotaUsage.id, id))
  }

  private async insertWorkflowOperation(
    database: DbClient,
    input: NonNullable<CompleteFundingExpiryInput['runOperation']>,
    now: Date,
  ): Promise<boolean> {
    const rows = await database
      .insert(workflowOutbox)
      .values({
        operationKey: normalizeWorkflowOperationKey(input.operationKey),
        type: input.type,
        researchId: input.researchId,
        escrowAddress: input.escrowAddress ?? null,
        phase: input.phase ?? 'queued',
        payloadHash: input.payloadHash,
        protectedPayloadDigest: input.protectedPayloadDigest,
        protectedPayload: input.protectedPayload ?? null,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
        fencingToken: 1,
        attempts: 1,
        nextAttemptAt: input.nextAttemptAt ?? now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: workflowOutbox.operationKey })
      .returning({ id: workflowOutbox.id })
    return rows.length > 0
  }

  private walletQuotaId(address: string, day: string) {
    return `wallet:${address.toLowerCase()}:${day}`
  }

  private globalQuotaId(day: string) {
    return `global:${day}`
  }
}

function isQuotaTerminal(value: ResearchLifecycle['quotaReservationState']): value is 'consumed' | 'released' {
  return value === 'consumed' || value === 'released'
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as Record<string, unknown>
  if (record.code === '23505') return true
  const cause = record.cause
  return Boolean(cause && typeof cause === 'object' && (cause as Record<string, unknown>).code === '23505')
}
