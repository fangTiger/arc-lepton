import type { Research, ResearchLifecycle, ResearchRepo } from '@/lib/db/research-repo'
import type { WorkflowBroadcastPatch, WorkflowOperation, WorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo'
import { keccak256, toBytes } from 'viem'
import { runOperationKey } from './funding-expiry'

export type ActivationReceiptResult =
  | { status: 'active'; blockNumber?: string | null; blockHash?: string | null; logIndex?: number | null }
  | { status: 'pending' }
  | { status: 'unknown' }
  | { status: 'not_active' }

export type ActivationWorkerResult =
  | { status: 'ignored'; reason: 'NOT_ACTIVATE' | 'NOT_FOUND' | 'NOT_ACTIVATING' }
  | { status: 'activation_pending' }
  | { status: 'activation_payload_missing' }
  | { status: 'activation_payload_invalid' }
  | { status: 'activation_broadcast_failed' }
  | { status: 'running_started' }
  | { status: 'cancelled_closing' }
  | { status: 'race_lost' }

export type ActivationWorkerDeps = {
  researchRepo: ResearchRepo
  workflowOutboxRepo: WorkflowOutboxRepo
  submitActivation: (input: { research: Research; operation: WorkflowOperation; protectedPayload: unknown }) => Promise<WorkflowBroadcastPatch>
  confirmActivation: (input: { research: Research; operation: WorkflowOperation }) => Promise<ActivationReceiptResult>
  workerId?: string
}

export async function processActivationOperation(
  operation: WorkflowOperation,
  deps: ActivationWorkerDeps,
): Promise<ActivationWorkerResult> {
  if (operation.type !== 'ACTIVATE') return { status: 'ignored', reason: 'NOT_ACTIVATE' }
  const workerId = deps.workerId ?? 'activation-worker'
  const research = await deps.researchRepo.findById(operation.researchId)
  if (!research) return { status: 'ignored', reason: 'NOT_FOUND' }
  if (
    research.status !== 'funding'
    || research.activationPhase !== 'activating'
    || research.quotaReservationState !== 'activating'
  ) {
    const alreadyFinalized = await completeAlreadyFinalizedActivation({ research, operation, deps })
    if (alreadyFinalized) return alreadyFinalized

    return { status: 'ignored', reason: 'NOT_ACTIVATING' }
  }

  let currentOperation = operation
  if (!operation.txHash) {
    const preBroadcastReceipt = await deps.confirmActivation({ research, operation })
    if (preBroadcastReceipt.status === 'pending' || preBroadcastReceipt.status === 'unknown') {
      return { status: 'activation_pending' }
    }
    if (preBroadcastReceipt.status === 'active') {
      return finalizeActiveActivation({
        research,
        operation,
        currentOperation,
        receipt: preBroadcastReceipt,
        deps,
        workerId,
      })
    }

    const protectedPayload = await readActivationProtectedPayload(operation, deps.workflowOutboxRepo)
    if (!protectedPayload.ok) {
      await deps.workflowOutboxRepo.failAndRelease(operation.id, operation.fencingToken, {
        phase: 'queued',
        lastError: protectedPayload.error,
        nextAttemptAt: new Date(Date.now() + 60_000),
      })
      return protectedPayload.error === 'ACTIVATION_PROTECTED_PAYLOAD_MISSING'
        ? { status: 'activation_payload_missing' }
        : { status: 'activation_payload_invalid' }
    }

    let broadcast: WorkflowBroadcastPatch
    try {
      broadcast = await deps.submitActivation({ research, operation, protectedPayload: protectedPayload.value })
    } catch {
      const released = await deps.workflowOutboxRepo.failAndRelease(operation.id, operation.fencingToken, {
        phase: 'queued',
        lastError: 'ACTIVATION_BROADCAST_FAILED',
        nextAttemptAt: new Date(Date.now() + 60_000),
      })
      return released ? { status: 'activation_broadcast_failed' } : { status: 'race_lost' }
    }
    const recorded = await deps.workflowOutboxRepo.recordBroadcast(operation.id, operation.fencingToken, broadcast)
    if (!recorded) return { status: 'race_lost' }
    currentOperation = {
      ...operation,
      phase: broadcast.phase ?? 'broadcasting',
      txHash: broadcast.txHash,
      chainId: broadcast.chainId,
      blockNumber: broadcast.blockNumber,
      blockHash: broadcast.blockHash ?? operation.blockHash,
      logIndex: broadcast.logIndex ?? operation.logIndex,
    }
  }

  const receipt = await deps.confirmActivation({ research, operation: currentOperation })
  if (receipt.status === 'pending' || receipt.status === 'unknown') return { status: 'activation_pending' }
  if (receipt.status !== 'active') return { status: 'race_lost' }

  return finalizeActiveActivation({
    research,
    operation,
    currentOperation,
    receipt,
    deps,
    workerId,
  })
}

async function completeAlreadyFinalizedActivation(input: {
  research: Research
  operation: WorkflowOperation
  deps: ActivationWorkerDeps
}): Promise<ActivationWorkerResult | null> {
  const { research, operation, deps } = input
  if (research.activationPhase !== 'active' || research.quotaReservationState !== 'consumed') return null

  if (research.status === 'running' && research.finalizationState === 'open') {
    const runOperation = await deps.workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))
    if (!runOperation) return null
    const completed = await completeActivationOperation(operation, deps.workflowOutboxRepo)
    return completed ? { status: 'running_started' } : { status: 'race_lost' }
  }

  if (research.status === 'cancelled' && research.finalizationState === 'closing') {
    const completed = await completeActivationOperation(operation, deps.workflowOutboxRepo)
    return completed ? { status: 'cancelled_closing' } : { status: 'race_lost' }
  }

  return null
}

async function finalizeActiveActivation(input: {
  research: Research
  operation: WorkflowOperation
  currentOperation: WorkflowOperation
  receipt: Extract<ActivationReceiptResult, { status: 'active' }>
  deps: ActivationWorkerDeps
  workerId: string
}): Promise<ActivationWorkerResult> {
  const { research, operation, currentOperation, receipt, deps, workerId } = input
  const next = research.cancelRequestedAt
    ? { status: 'cancelled' as const, activationPhase: 'active' as const, finalizationState: 'closing' as const }
    : { status: 'running' as const, activationPhase: 'active' as const, finalizationState: 'open' as const }

  const completed = await deps.researchRepo.completeFundingExpiry({
    id: research.id,
    expected: lifecycleOf(research),
    next: { ...next, quotaReservationState: 'consumed' },
    runOperation: research.cancelRequestedAt
      ? undefined
      : {
          operationKey: runOperationKey(research.id),
          type: 'RUN',
          researchId: research.id,
          escrowAddress: research.escrowAddress ?? research.expectedEscrowAddress,
          phase: 'queued',
          payloadHash: `run:${research.id}`,
          protectedPayloadDigest: `run:${research.id}`,
          leaseOwner: workerId,
          leaseDurationMs: 30_000,
        },
    workflowOutboxRepo: deps.workflowOutboxRepo,
  })
  if (!completed) return { status: 'race_lost' }

  const markedComplete = await deps.workflowOutboxRepo.complete(operation.id, operation.fencingToken, {
    blockNumber: receipt.blockNumber ?? currentOperation.blockNumber,
    blockHash: receipt.blockHash ?? currentOperation.blockHash,
    logIndex: receipt.logIndex ?? currentOperation.logIndex,
  })
  if (!markedComplete) return { status: 'race_lost' }

  return research.cancelRequestedAt ? { status: 'cancelled_closing' } : { status: 'running_started' }
}

async function completeActivationOperation(
  operation: WorkflowOperation,
  workflowOutboxRepo: WorkflowOutboxRepo,
): Promise<boolean> {
  return workflowOutboxRepo.complete(operation.id, operation.fencingToken, {
    blockNumber: operation.blockNumber,
    blockHash: operation.blockHash,
    logIndex: operation.logIndex,
  })
}

function lifecycleOf(research: Research): ResearchLifecycle {
  return {
    status: research.status,
    activationPhase: research.activationPhase,
    finalizationState: research.finalizationState,
    quotaReservationState: research.quotaReservationState,
  }
}

async function readActivationProtectedPayload(
  operation: WorkflowOperation,
  workflowOutboxRepo: WorkflowOutboxRepo,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const protectedPayload = await workflowOutboxRepo.getProtectedPayload(operation.operationKey)
  if (!protectedPayload) return { ok: false, error: 'ACTIVATION_PROTECTED_PAYLOAD_MISSING' }

  const digest = keccak256(toBytes(protectedPayload))
  if (digest.toLowerCase() !== operation.protectedPayloadDigest.toLowerCase()) {
    return { ok: false, error: 'ACTIVATION_PROTECTED_PAYLOAD_DIGEST_MISMATCH' }
  }

  try {
    return { ok: true, value: JSON.parse(protectedPayload) }
  } catch {
    return { ok: false, error: 'ACTIVATION_PROTECTED_PAYLOAD_INVALID' }
  }
}
