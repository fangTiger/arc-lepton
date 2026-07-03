import { and, asc, count, eq, gt, isNull, like, lte, not, or, sql } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { paymentSettlement } from './schema/payment-settlement'
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
  SettlementStatus,
} from './payment-settlement-repo'
import {
  MANUAL_RECOVERY_ERROR_PREFIX,
  isManualRecoveryErrorMessage,
  normalizeSettlementResearchId,
} from './payment-settlement-repo'

type DbClient = VercelPgDatabase<typeof schema>

function toPaymentSettlement(row: typeof paymentSettlement.$inferSelect): PaymentSettlement {
  return {
    ...row,
    requestIds: [...row.requestIds],
    status: row.status as SettlementStatus,
  }
}

function autoRetryableFailedCondition() {
  return and(
    eq(paymentSettlement.status, 'failed'),
    isNull(paymentSettlement.txHash),
    or(
      isNull(paymentSettlement.errorMessage),
      not(like(paymentSettlement.errorMessage, `${MANUAL_RECOVERY_ERROR_PREFIX}%`)),
    ),
  )
}

export class PgPaymentSettlementRepo implements PaymentSettlementRepo {
  constructor(private readonly database: DbClient) {}

  async claimResearchSettlement(input: PaymentSettlementClaimInput): Promise<PaymentSettlementClaimResult> {
    const researchId = normalizeSettlementResearchId(input.researchId)
    const [claimed] = await this.database
      .insert(paymentSettlement)
      .values({
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
      })
      .onConflictDoNothing({ target: [paymentSettlement.address, paymentSettlement.researchId] })
      .returning()

    if (claimed) return { status: 'claimed', settlement: toPaymentSettlement(claimed) }

    const existing = await this.findByScope(input.address, researchId)
    if (!existing) throw new Error(`Failed to resolve payment settlement claim for ${input.address}:${researchId}`)

    if (existing.status === 'failed') {
      if (existing.txHash || isManualRecoveryErrorMessage(existing.errorMessage)) {
        return { status: 'existing', settlement: existing }
      }

      const [retryClaim] = await this.database
        .update(paymentSettlement)
        .set({
          requestIds: [...input.requestIds],
          totalAmount: input.totalAmount,
          status: 'broadcasting',
          txHash: null,
          chainId: null,
          blockNumber: null,
          attempts: sql<number>`${paymentSettlement.attempts} + 1`,
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(and(eq(paymentSettlement.id, existing.id), autoRetryableFailedCondition()))
        .returning()

      if (retryClaim) return { status: 'claimed', settlement: toPaymentSettlement(retryClaim) }
    }

    return { status: 'existing', settlement: existing }
  }

  async claimRetryableSettlement(
    id: string,
    input: PaymentSettlementRetryClaimInput = {},
  ): Promise<PaymentSettlementClaimResult> {
    const existing = await this.findById(id)
    if (!existing) throw new Error(`payment_settlement ${id} not found`)
    if (
      existing.status === 'failed'
      && (existing.txHash || isManualRecoveryErrorMessage(existing.errorMessage))
    ) {
      return { status: 'existing', settlement: existing }
    }

    const retryableCondition = input.staleBroadcastingBefore
      ? or(
          autoRetryableFailedCondition(),
          and(
            eq(paymentSettlement.status, 'broadcasting'),
            lte(paymentSettlement.updatedAt, input.staleBroadcastingBefore),
          ),
        )
      : autoRetryableFailedCondition()

    const retryPatch = existing.status === 'failed'
      ? {
          status: 'broadcasting',
          txHash: null,
          chainId: null,
          blockNumber: null,
          attempts: sql<number>`${paymentSettlement.attempts} + 1`,
          errorMessage: null,
          updatedAt: new Date(),
        }
      : {
          status: 'broadcasting',
          attempts: sql<number>`${paymentSettlement.attempts} + 1`,
          errorMessage: null,
          updatedAt: new Date(),
        }

    const [claimed] = await this.database
      .update(paymentSettlement)
      .set(retryPatch)
      .where(and(eq(paymentSettlement.id, id), retryableCondition))
      .returning()

    if (claimed) return { status: 'claimed', settlement: toPaymentSettlement(claimed) }

    return { status: 'existing', settlement: existing }
  }

  async recordSettlementReceipt(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement> {
    const [row] = await this.database
      .update(paymentSettlement)
      .set({
        txHash: patch.txHash,
        chainId: patch.chainId,
        blockNumber: patch.blockNumber,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(paymentSettlement.id, id))
      .returning()

    if (!row) throw new Error(`payment_settlement ${id} not found`)
    return toPaymentSettlement(row)
  }

  async confirmSettlement(id: string, patch: PaymentSettlementReceiptPatch): Promise<PaymentSettlement> {
    const [row] = await this.database
      .update(paymentSettlement)
      .set({
        status: 'confirmed',
        txHash: patch.txHash,
        chainId: patch.chainId,
        blockNumber: patch.blockNumber,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(paymentSettlement.id, id))
      .returning()

    if (!row) throw new Error(`payment_settlement ${id} not found`)
    return toPaymentSettlement(row)
  }

  async failSettlement(id: string, patch: PaymentSettlementFailurePatch): Promise<PaymentSettlement> {
    const [row] = await this.database
      .update(paymentSettlement)
      .set({
        status: 'failed',
        txHash: patch.txHash ?? null,
        chainId: patch.chainId ?? null,
        blockNumber: patch.blockNumber ?? null,
        errorMessage: patch.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(paymentSettlement.id, id))
      .returning()

    if (!row) throw new Error(`payment_settlement ${id} not found`)
    return toPaymentSettlement(row)
  }

  async findById(id: string): Promise<PaymentSettlement | null> {
    const [row] = await this.database
      .select()
      .from(paymentSettlement)
      .where(eq(paymentSettlement.id, id))
      .limit(1)

    return row ? toPaymentSettlement(row) : null
  }

  async listRetryableSettlements(query: PaymentSettlementRetryQuery = {}): Promise<PaymentSettlement[]> {
    const retryableCondition = query.staleBroadcastingBefore
      ? or(
          autoRetryableFailedCondition(),
          and(
            eq(paymentSettlement.status, 'broadcasting'),
            lte(paymentSettlement.updatedAt, query.staleBroadcastingBefore),
          ),
        )
      : autoRetryableFailedCondition()

    const rows = await this.database
      .select()
      .from(paymentSettlement)
      .where(retryableCondition)
      .orderBy(asc(paymentSettlement.updatedAt))
      .limit(query.limit ?? 50)

    return rows.map(toPaymentSettlement)
  }

  async listConfirmedSettlementsNeedingReconcile(query: PaymentSettlementConfirmedReconcileQuery = {}): Promise<PaymentSettlement[]> {
    const cursorCondition = query.afterUpdatedAt && query.afterId
      ? or(
          gt(paymentSettlement.updatedAt, query.afterUpdatedAt),
          and(eq(paymentSettlement.updatedAt, query.afterUpdatedAt), gt(paymentSettlement.id, query.afterId)),
        )
      : undefined
    const whereCondition = cursorCondition
      ? and(eq(paymentSettlement.status, 'confirmed'), cursorCondition)
      : eq(paymentSettlement.status, 'confirmed')
    const rows = await this.database
      .select()
      .from(paymentSettlement)
      .where(whereCondition)
      .orderBy(asc(paymentSettlement.updatedAt), asc(paymentSettlement.id))
      .limit(query.limit ?? 50)

    return rows.map(toPaymentSettlement)
  }

  async count(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(paymentSettlement)
    return Number(row?.value ?? 0)
  }

  private async findByScope(address: string, researchId: string): Promise<PaymentSettlement | null> {
    const [row] = await this.database
      .select()
      .from(paymentSettlement)
      .where(and(eq(paymentSettlement.address, address), eq(paymentSettlement.researchId, researchId)))
      .limit(1)

    return row ? toPaymentSettlement(row) : null
  }
}
