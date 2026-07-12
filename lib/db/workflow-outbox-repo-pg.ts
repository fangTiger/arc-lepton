import { and, asc, count, eq, gt, inArray, isNull, lte, not, or } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { workflowOutbox } from './schema/workflow-outbox'
import type {
  WorkflowBroadcastPatch,
  WorkflowCheckpointPatch,
  WorkflowCompletePatch,
  WorkflowDueQuery,
  WorkflowFailurePatch,
  WorkflowLeaseRenewInput,
  WorkflowManualRecoveryPatch,
  WorkflowOperation,
  WorkflowOperationClaimInput,
  WorkflowOperationClaimResult,
  WorkflowOutboxRepo,
} from './workflow-outbox-repo'
import { isTerminalWorkflowPhase, normalizeWorkflowOperationKey } from './workflow-outbox-repo'

type DbClient = VercelPgDatabase<typeof schema>

function toWorkflowOperation(row: typeof workflowOutbox.$inferSelect): WorkflowOperation {
  const { protectedPayload: _protectedPayload, ...operation } = row
  return operation
}

export class PgWorkflowOutboxRepo implements WorkflowOutboxRepo {
  constructor(private readonly database: DbClient) {}

  async claimOperation(input: WorkflowOperationClaimInput): Promise<WorkflowOperationClaimResult> {
    const operationKey = normalizeWorkflowOperationKey(input.operationKey)
    const existing = await this.findByOperationKey(operationKey)
    const now = new Date()

    if (existing) {
      if (isTerminalWorkflowPhase(existing.phase) || !canClaim(existing, now)) {
        return { status: 'existing', operation: existing }
      }

      const [row] = await this.database
        .update(workflowOutbox)
        .set({
          leaseOwner: input.leaseOwner,
          leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
          fencingToken: existing.fencingToken + 1,
          attempts: existing.attempts + 1,
          lastError: null,
          updatedAt: now,
        })
        .where(canClaimOperationWhere(existing.id, now))
        .returning()
      if (!row) {
        const raced = await this.findByOperationKey(operationKey)
        return { status: 'existing', operation: raced ?? existing }
      }
      return { status: 'claimed', operation: toWorkflowOperation(row) }
    }

    const [row] = await this.database
      .insert(workflowOutbox)
      .values({
        operationKey,
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
      .returning()
    if (row) return { status: 'claimed', operation: toWorkflowOperation(row) }

    const raced = await this.findByOperationKey(operationKey)
    if (!raced) throw new Error(`Failed to resolve workflow operation ${operationKey}`)
    return { status: 'existing', operation: raced }
  }

  async getProtectedPayload(operationKey: string): Promise<string | null> {
    const [row] = await this.database
      .select({ protectedPayload: workflowOutbox.protectedPayload })
      .from(workflowOutbox)
      .where(eq(workflowOutbox.operationKey, normalizeWorkflowOperationKey(operationKey)))
      .limit(1)
    return row?.protectedPayload ?? null
  }

  async renewLease(
    id: string,
    fencingToken: number,
    input: WorkflowLeaseRenewInput,
  ): Promise<WorkflowOperation | null> {
    const now = new Date()
    const [row] = await this.database
      .update(workflowOutbox)
      .set({
        leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
        updatedAt: now,
      })
      .where(canRenewOperationWhere(id, fencingToken, input.leaseOwner, now))
      .returning()
    return row ? toWorkflowOperation(row) : null
  }

  async recordCheckpoint(id: string, fencingToken: number, patch: WorkflowCheckpointPatch): Promise<boolean> {
    const now = new Date()
    const rows = await this.database
      .update(workflowOutbox)
      .set({
        phase: patch.phase,
        payloadHash: patch.payloadHash,
        protectedPayloadDigest: patch.protectedPayloadDigest,
        updatedAt: new Date(),
      })
      .where(canMutateOperationWhere(id, fencingToken, now))
      .returning({ id: workflowOutbox.id })
    return rows.length > 0
  }

  async recordBroadcast(id: string, fencingToken: number, patch: WorkflowBroadcastPatch): Promise<boolean> {
    const now = new Date()
    const rows = await this.database
      .update(workflowOutbox)
      .set({
        phase: patch.phase ?? 'broadcasting',
        txHash: patch.txHash,
        chainId: patch.chainId,
        blockNumber: patch.blockNumber,
        blockHash: patch.blockHash,
        logIndex: patch.logIndex,
        updatedAt: new Date(),
      })
      .where(canMutateOperationWhere(id, fencingToken, now))
      .returning({ id: workflowOutbox.id })
    return rows.length > 0
  }

  async failAndRelease(id: string, fencingToken: number, patch: WorkflowFailurePatch): Promise<boolean> {
    const now = new Date()
    const rows = await this.database
      .update(workflowOutbox)
      .set({
        phase: patch.phase ?? 'queued',
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: patch.lastError,
        nextAttemptAt: patch.nextAttemptAt,
        updatedAt: new Date(),
      })
      .where(canMutateOperationWhere(id, fencingToken, now))
      .returning({ id: workflowOutbox.id })
    return rows.length > 0
  }

  async complete(id: string, fencingToken: number, patch: WorkflowCompletePatch = {}): Promise<boolean> {
    const now = new Date()
    const rows = await this.database
      .update(workflowOutbox)
      .set({
        phase: patch.phase ?? 'succeeded',
        leaseOwner: null,
        leaseExpiresAt: null,
        blockNumber: patch.blockNumber,
        blockHash: patch.blockHash,
        logIndex: patch.logIndex,
        updatedAt: new Date(),
      })
      .where(canMutateOperationWhere(id, fencingToken, now))
      .returning({ id: workflowOutbox.id })
    return rows.length > 0
  }

  async recoverManualOperation(operationKey: string, patch: WorkflowManualRecoveryPatch): Promise<WorkflowOperation | null> {
    const now = new Date()
    const [row] = await this.database
      .update(workflowOutbox)
      .set({
        phase: patch.phase,
        leaseOwner: null,
        leaseExpiresAt: null,
        nextAttemptAt: patch.nextAttemptAt,
        lastError: patch.lastError,
        updatedAt: now,
      })
      .where(and(
        eq(workflowOutbox.operationKey, normalizeWorkflowOperationKey(operationKey)),
        eq(workflowOutbox.phase, 'manual'),
      ))
      .returning()
    return row ? toWorkflowOperation(row) : null
  }

  async findByOperationKey(operationKey: string): Promise<WorkflowOperation | null> {
    const [row] = await this.database
      .select()
      .from(workflowOutbox)
      .where(eq(workflowOutbox.operationKey, normalizeWorkflowOperationKey(operationKey)))
      .limit(1)
    return row ? toWorkflowOperation(row) : null
  }

  async listDueOperations(query: WorkflowDueQuery = {}): Promise<WorkflowOperation[]> {
    const now = query.now ?? new Date()
    const rows = await this.database
      .select()
      .from(workflowOutbox)
      .where(and(
        lte(workflowOutbox.nextAttemptAt, now),
        or(isNull(workflowOutbox.leaseExpiresAt), lte(workflowOutbox.leaseExpiresAt, now)),
      ))
      .orderBy(asc(workflowOutbox.nextAttemptAt), asc(workflowOutbox.operationKey))
      .limit(query.limit ?? 50)
    return rows.filter((row) => !isTerminalWorkflowPhase(row.phase)).map(toWorkflowOperation)
  }

  async count(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(workflowOutbox)
    return Number(row?.value ?? 0)
  }
}

function canClaim(operation: WorkflowOperation, now: Date) {
  if (operation.nextAttemptAt > now) return false
  return !operation.leaseExpiresAt || operation.leaseExpiresAt <= now
}

function canClaimOperationWhere(id: string, now: Date) {
  return and(
    eq(workflowOutbox.id, id),
    lte(workflowOutbox.nextAttemptAt, now),
    or(isNull(workflowOutbox.leaseExpiresAt), lte(workflowOutbox.leaseExpiresAt, now)),
    nonTerminalPhaseWhere(),
  )
}

function canRenewOperationWhere(id: string, fencingToken: number, leaseOwner: string, now: Date) {
  return and(
    eq(workflowOutbox.id, id),
    eq(workflowOutbox.fencingToken, fencingToken),
    eq(workflowOutbox.leaseOwner, leaseOwner),
    gt(workflowOutbox.leaseExpiresAt, now),
    nonTerminalPhaseWhere(),
  )
}

function canMutateOperationWhere(id: string, fencingToken: number, now: Date) {
  return and(
    eq(workflowOutbox.id, id),
    eq(workflowOutbox.fencingToken, fencingToken),
    gt(workflowOutbox.leaseExpiresAt, now),
    nonTerminalPhaseWhere(),
  )
}

function nonTerminalPhaseWhere() {
  return not(inArray(workflowOutbox.phase, ['succeeded', 'manual']))
}
