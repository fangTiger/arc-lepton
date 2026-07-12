import type { Research, ResearchLifecycle, ResearchRepo } from '@/lib/db/research-repo'
import type { WorkflowOperation, WorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo'

export type ActivationReconcileResult =
  | { status: 'active' }
  | { status: 'not_active' }
  | { status: 'pending' }
  | { status: 'unknown' }

export type FundingExpiryResult =
  | { status: 'not_due' }
  | { status: 'ignored'; reason: 'NOT_FOUND' | 'NOT_FUNDING' }
  | { status: 'activation_pending' }
  | { status: 'running_started' }
  | { status: 'cancelled_closing' }
  | { status: 'funding_expired' }
  | { status: 'race_lost' }

export type FundingExpiryDeps = {
  researchRepo: ResearchRepo
  workflowOutboxRepo: WorkflowOutboxRepo
  reconcileActivation: (input: {
    research: Research
    operation: WorkflowOperation | null
  }) => Promise<ActivationReconcileResult>
  now?: Date
  workerId?: string
}

export function activationOperationKey(researchId: string) {
  return `research:${researchId}:ACTIVATE`
}

export function runOperationKey(researchId: string) {
  return `research:${researchId}:RUN`
}

export async function handleFundingExpiry(
  researchId: string,
  deps: FundingExpiryDeps,
): Promise<FundingExpiryResult> {
  const now = deps.now ?? new Date()
  const workerId = deps.workerId ?? 'funding-expiry'
  const research = await deps.researchRepo.findById(researchId)
  if (!research) return { status: 'ignored', reason: 'NOT_FOUND' }
  if (research.status !== 'funding') return { status: 'ignored', reason: 'NOT_FUNDING' }
  const deadline = research.fundingDeadline ?? research.fundingExpiresAt
  if (!deadline || deadline > now) return { status: 'not_due' }

  const activationOperation = await deps.workflowOutboxRepo.findByOperationKey(activationOperationKey(researchId))
  const reconciliation = await deps.reconcileActivation({ research, operation: activationOperation })
  if (reconciliation.status === 'pending' || reconciliation.status === 'unknown') {
    return { status: 'activation_pending' }
  }

  if (reconciliation.status === 'active') {
    if (research.activationPhase !== 'activating' || research.quotaReservationState !== 'activating') {
      return { status: 'race_lost' }
    }
    const next = research.cancelRequestedAt
      ? { status: 'cancelled' as const, activationPhase: 'active' as const, finalizationState: 'closing' as const }
      : { status: 'running' as const, activationPhase: 'active' as const, finalizationState: 'open' as const }
    const completed = await deps.researchRepo.completeFundingExpiry({
      id: researchId,
      expected: lifecycleOf(research),
      next: { ...next, quotaReservationState: 'consumed' },
      runOperation: research.cancelRequestedAt
        ? undefined
        : {
            operationKey: runOperationKey(researchId),
            type: 'RUN',
            researchId,
            escrowAddress: research.escrowAddress ?? research.expectedEscrowAddress,
            phase: 'queued',
            payloadHash: `run:${researchId}`,
            protectedPayloadDigest: `run:${researchId}`,
            leaseOwner: workerId,
            leaseDurationMs: 30_000,
          },
      workflowOutboxRepo: deps.workflowOutboxRepo,
    })
    if (!completed) return { status: 'race_lost' }

    if (research.cancelRequestedAt) {
      return { status: 'cancelled_closing' }
    }

    return { status: 'running_started' }
  }

  const completed = await deps.researchRepo.completeFundingExpiry({
    id: researchId,
    expected: lifecycleOf(research),
    next: { status: 'funding_expired', activationPhase: 'expired', quotaReservationState: 'released' },
  })
  return completed ? { status: 'funding_expired' } : { status: 'race_lost' }
}

function lifecycleOf(research: Research): ResearchLifecycle {
  return {
    status: research.status,
    activationPhase: research.activationPhase,
    finalizationState: research.finalizationState,
    quotaReservationState: research.quotaReservationState,
  }
}
