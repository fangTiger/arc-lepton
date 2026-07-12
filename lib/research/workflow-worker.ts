import type {
  WorkflowOperation,
  WorkflowOperationType,
  WorkflowOutboxRepo,
} from '@/lib/db/workflow-outbox-repo'
import type { Research, ResearchRepo } from '@/lib/db/research-repo'
import type { ResearchEventRepo } from '@/lib/db/research-event-repo'
import type { TxLogRepo } from '@/lib/db/tx-log-repo'

export type WorkflowOperationHandlerContext = {
  workerId: string
  renewLease: () => Promise<WorkflowOperation | null>
}

export type WorkflowOperationHandler = (
  operation: WorkflowOperation,
  context: WorkflowOperationHandlerContext,
) => Promise<void>

export type WorkflowWorkerSummary = {
  scanned: number
  claimed: number
  dispatched: number
  failed: number
  manual: number
  skipped: number
}

export type WorkflowWorkerInput = {
  workflowOutboxRepo: WorkflowOutboxRepo
  handlers?: Partial<Record<WorkflowOperationType, WorkflowOperationHandler>>
  onManual?: (operation: WorkflowOperation, lastError: string) => Promise<void>
  workerId?: string
  now?: Date
  limit?: number
  leaseDurationMs?: number
  maxAttempts?: number
  backoffBaseMs?: number
  backoffMaxMs?: number
}

export type RunWorkflowResearch = Pick<Research, 'id' | 'address' | 'topic' | 'budgetUsdc'>

export type ResearchWorkflowHandlersInput = {
  researchRepo: Pick<ResearchRepo, 'findById'>
  workflowOutboxRepo?: WorkflowOutboxRepo
  researchEventRepo?: ResearchEventRepo
  txLogRepo?: TxLogRepo
  activate?: WorkflowOperationHandler
  run?: (operation: WorkflowOperation, research: RunWorkflowResearch, context: WorkflowOperationHandlerContext) => Promise<void>
  processActivationOperation?: (
    operation: WorkflowOperation,
    deps: {
      researchRepo: Pick<ResearchRepo, 'findById'>
      workflowOutboxRepo?: WorkflowOutboxRepo
      submitActivation?: unknown
      confirmActivation?: unknown
      workerId?: string
    },
  ) => Promise<unknown>
  processClaimedRunOperation?: (input: {
    operation: WorkflowOperation
    research: RunWorkflowResearch
    deps?: {
      workflowOutboxRepo?: WorkflowOutboxRepo
      researchEventRepo?: ResearchEventRepo
      researchRepo: Pick<ResearchRepo, 'findById'>
      txLogRepo?: TxLogRepo
    }
  }) => Promise<unknown>
  submitActivation?: unknown
  confirmActivation?: unknown
  settle: WorkflowOperationHandler
  reconcile: WorkflowOperationHandler
  close: WorkflowOperationHandler
}

export type ManualRecoveryAction = 'requeue' | 'mark_closed'

export type ManualRecoveryAuditEntry = {
  operationKey: string
  action: ManualRecoveryAction
  operator: string
  reason: string
  evidenceDigest: string
  previousPhase: WorkflowOperation['phase']
  nextPhase: WorkflowOperation['phase']
  at: Date
}

export type ManualRecoveryResult =
  | { status: 'requeued' }
  | { status: 'closed' }
  | { status: 'not_found' }
  | { status: 'not_manual' }
  | { status: 'evidence_rejected' }
  | { status: 'race_lost' }

export type ManualRecoveryInput = {
  workflowOutboxRepo: WorkflowOutboxRepo
  researchRepo?: Pick<ResearchRepo, 'findById' | 'transitionLifecycle'>
  operationKey: string
  action: ManualRecoveryAction
  operator: string
  reason: string
  evidenceDigest: string
  now?: Date
  verifyClosedEvidence?: (operation: WorkflowOperation, evidenceDigest: string) => Promise<boolean>
  audit?: (entry: ManualRecoveryAuditEntry) => Promise<void>
}

const DEFAULT_WORKER_ID = 'research-workflow-worker'
const DEFAULT_LIMIT = 25
const DEFAULT_LEASE_DURATION_MS = 30_000
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_BACKOFF_BASE_MS = 60_000
const DEFAULT_BACKOFF_MAX_MS = 15 * 60_000

export async function processDueWorkflowOperations(input: WorkflowWorkerInput): Promise<WorkflowWorkerSummary> {
  const workerId = input.workerId?.trim() || DEFAULT_WORKER_ID
  const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS
  const now = input.now ?? new Date()
  const due = await input.workflowOutboxRepo.listDueOperations({
    now,
    limit: input.limit ?? DEFAULT_LIMIT,
  })
  const summary: WorkflowWorkerSummary = {
    scanned: due.length,
    claimed: 0,
    dispatched: 0,
    failed: 0,
    manual: 0,
    skipped: 0,
  }

  for (const operation of due) {
    const claim = await input.workflowOutboxRepo.claimOperation({
      operationKey: operation.operationKey,
      type: operation.type,
      researchId: operation.researchId,
      escrowAddress: operation.escrowAddress,
      phase: operation.phase,
      payloadHash: operation.payloadHash,
      protectedPayloadDigest: operation.protectedPayloadDigest,
      leaseOwner: workerId,
      leaseDurationMs,
      nextAttemptAt: operation.nextAttemptAt,
    })

    if (claim.status !== 'claimed' || claim.operation.leaseOwner !== workerId) {
      summary.skipped += 1
      continue
    }

    summary.claimed += 1
    const claimedOperation = claim.operation
    const handler = input.handlers?.[claimedOperation.type]

    try {
      if (!handler) throw new Error(`No workflow handler configured for ${claimedOperation.type}`)
      summary.dispatched += 1
      await handler(claimedOperation, {
        workerId,
        renewLease: () => input.workflowOutboxRepo.renewLease(claimedOperation.id, claimedOperation.fencingToken, {
          leaseOwner: workerId,
          leaseDurationMs,
        }),
      })
    } catch (error) {
      const lastError = sanitizeWorkerError(error)
      const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
      if (claimedOperation.attempts >= maxAttempts) {
        const released = await input.workflowOutboxRepo.failAndRelease(claimedOperation.id, claimedOperation.fencingToken, {
          phase: 'manual',
          lastError,
          nextAttemptAt: now,
        })
        if (released) {
          await input.onManual?.(claimedOperation, lastError)
          summary.manual += 1
        } else {
          summary.skipped += 1
        }
        continue
      }

      const released = await input.workflowOutboxRepo.failAndRelease(claimedOperation.id, claimedOperation.fencingToken, {
        phase: 'queued',
        lastError,
        nextAttemptAt: new Date(now.getTime() + retryDelayMs(claimedOperation.attempts, input)),
      })
      if (released) summary.failed += 1
      else summary.skipped += 1
    }
  }

  return summary
}

export function createResearchWorkflowHandlers(input: ResearchWorkflowHandlersInput): Record<WorkflowOperationType, WorkflowOperationHandler> {
  return {
    ACTIVATE: async (operation, context) => {
      if (input.activate) return input.activate(operation, context)
      if (!input.processActivationOperation) throw new Error('ACTIVATE handler is not configured')
      await input.processActivationOperation(operation, {
        researchRepo: input.researchRepo,
        workflowOutboxRepo: input.workflowOutboxRepo,
        submitActivation: input.submitActivation,
        confirmActivation: input.confirmActivation,
        workerId: context.workerId,
      })
    },
    RUN: async (operation, context) => {
      const research = await input.researchRepo.findById(operation.researchId)
      if (!research) throw new Error(`Research missing for RUN operation ${operation.researchId}`)
      const runResearch = {
        id: research.id,
        address: research.address,
        topic: research.topic,
        budgetUsdc: research.budgetUsdc,
      }
      if (input.run) return input.run(operation, runResearch, context)
      if (!input.processClaimedRunOperation) throw new Error('RUN handler is not configured')
      await input.processClaimedRunOperation({
        operation,
        research: runResearch,
        deps: {
          workflowOutboxRepo: input.workflowOutboxRepo,
          researchEventRepo: input.researchEventRepo,
          researchRepo: input.researchRepo,
          txLogRepo: input.txLogRepo,
        },
      })
    },
    SETTLE: input.settle,
    RECONCILE: input.reconcile,
    CLOSE: input.close,
  }
}

export async function recoverManualWorkflowOperation(input: ManualRecoveryInput): Promise<ManualRecoveryResult> {
  const now = input.now ?? new Date()
  const operation = await input.workflowOutboxRepo.findByOperationKey(input.operationKey)
  if (!operation) return { status: 'not_found' }
  if (operation.phase !== 'manual') return { status: 'not_manual' }

  if (input.action === 'mark_closed') {
    const accepted = await input.verifyClosedEvidence?.(operation, input.evidenceDigest)
    if (!accepted) return { status: 'evidence_rejected' }
  }

  const nextPhase = input.action === 'requeue' ? 'queued' : 'succeeded'
  await input.audit?.({
    operationKey: operation.operationKey,
    action: input.action,
    operator: input.operator,
    reason: input.reason,
    evidenceDigest: input.evidenceDigest,
    previousPhase: operation.phase,
    nextPhase,
    at: now,
  })

  const recovered = await input.workflowOutboxRepo.recoverManualOperation(operation.operationKey, {
    phase: nextPhase,
    nextAttemptAt: now,
    lastError: `manual recovery by ${input.operator}: ${sanitizeWorkerError(input.reason)}`,
  })
  if (!recovered) return { status: 'race_lost' }

  if (input.researchRepo) {
    const research = await input.researchRepo.findById(operation.researchId)
    if (research) {
      const transitioned = await input.researchRepo.transitionLifecycle(
        research.id,
        {
          status: research.status,
          activationPhase: research.activationPhase,
          finalizationState: research.finalizationState,
          quotaReservationState: research.quotaReservationState,
        },
        {
          finalizationState: input.action === 'requeue' ? 'closing' : 'closed',
        },
      )
      if (!transitioned) return { status: 'race_lost' }
    }
  }

  return input.action === 'requeue' ? { status: 'requeued' } : { status: 'closed' }
}

function retryDelayMs(attempts: number, input: Pick<WorkflowWorkerInput, 'backoffBaseMs' | 'backoffMaxMs'>) {
  const baseMs = input.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
  const maxMs = input.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS
  const exponent = Math.max(0, attempts - 1)
  return Math.min(maxMs, baseMs * 2 ** exponent)
}

function sanitizeWorkerError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted-secret]')
    .replace(/0x[a-fA-F0-9]{64,}/g, '0x[redacted-hex]')
    .slice(0, 500)
}
