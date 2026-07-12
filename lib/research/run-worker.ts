import { createHash } from 'node:crypto'
import { markResearchDone, publishResearchEvent } from '@/lib/agent/event-bus'
import { runResearchAgent, type AgentEvent } from '@/lib/agent/research-agent'
import { researchEventRepo, researchRepo, txLogRepo, workflowOutboxRepo } from '@/lib/db'
import type { ResearchRepo } from '@/lib/db/research-repo'
import type { ResearchEventRepo } from '@/lib/db/research-event-repo'
import type { TxLogRepo } from '@/lib/db/tx-log-repo'
import type { WorkflowOperation, WorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo'
import { finalizeResearchReport } from './finalization'

export type RunWorkerResearch = {
  id: string
  address: string
  topic: string
  budgetUsdc: string
}

export type RunWorkerDeps = {
  workflowOutboxRepo: WorkflowOutboxRepo
  researchEventRepo: ResearchEventRepo
  researchRepo: ResearchRepo
  txLogRepo: TxLogRepo
  finalizeReport?: typeof finalizeResearchReport
  publishEvent?: (researchId: string, event: AgentEvent, cursor: number) => void
  markDone?: (researchId: string) => void
}

export type AgentRunner = (input: {
  researchId: string
  address: string
  topic: string
  budgetUsdc: string
  signal?: AbortSignal
}) => AsyncIterable<AgentEvent>

export type ProcessClaimedRunOperationResult =
  | { status: 'completed'; terminal: 'final' | 'error' | null }
  | { status: 'stale_lease' }
  | { status: 'safe_failed' }

export async function processClaimedRunOperation(input: {
  operation: WorkflowOperation
  research: RunWorkerResearch
  deps?: Partial<RunWorkerDeps>
  agentRunner?: AgentRunner
  signal?: AbortSignal
}): Promise<ProcessClaimedRunOperationResult> {
  const deps = {
    workflowOutboxRepo,
    researchEventRepo,
    researchRepo,
    txLogRepo,
    finalizeReport: finalizeResearchReport,
    publishEvent: publishResearchEvent,
    markDone: markResearchDone,
    ...input.deps,
  } satisfies RunWorkerDeps
  const operation = input.operation

  if (!(await hasFreshLease(deps.workflowOutboxRepo, operation))) return { status: 'stale_lease' }
  if (await shouldFailReclaimedRunAfterIntent(operation, input.research, deps)) {
    return failReclaimedRunAfterIntent(operation, input.research, deps)
  }
  const markedRunning = await deps.workflowOutboxRepo.recordCheckpoint(operation.id, operation.fencingToken, {
    phase: 'running',
  })
  if (!markedRunning) return { status: 'stale_lease' }

  const agentRunner = input.agentRunner ?? runResearchAgent
  let ordinal = 0
  let lastEventCursor = 0
  let terminal: 'final' | 'error' | null = null

  for await (const event of agentRunner({
    researchId: input.research.id,
    address: input.research.address,
    topic: input.research.topic,
    budgetUsdc: input.research.budgetUsdc,
    signal: input.signal,
  })) {
    if (!(await hasFreshLease(deps.workflowOutboxRepo, operation))) return { status: 'stale_lease' }
    ordinal += 1
    const appended = await deps.researchEventRepo.appendEvent({
      researchId: input.research.id,
      type: event.type,
      payload: event,
      payloadHash: digestJson(event),
      operationKey: operation.operationKey,
      attempt: operation.attempts,
      fencingToken: operation.fencingToken,
      dedupeKey: `${operation.operationKey}:event:${ordinal}`,
    })
    if (!(await hasFreshLease(deps.workflowOutboxRepo, operation))) return { status: 'stale_lease' }
    lastEventCursor = appended.event.cursor
    deps.publishEvent?.(input.research.id, event, appended.event.cursor)

    if (event.type === 'final' || event.type === 'error') {
      terminal = event.type
      const checkpoint = await deps.researchEventRepo.recordCheckpoint({
        researchId: input.research.id,
        operationKey: operation.operationKey,
        attempt: operation.attempts,
        fencingToken: operation.fencingToken,
        payloadHash: digestJson({
          phase: 'terminal',
          terminalEventType: event.type,
          lastEventCursor,
          event,
        }),
        state: {
          phase: 'terminal',
          terminalEventType: event.type,
          lastEventCursor,
          event,
        },
        dedupeKey: `${operation.operationKey}:checkpoint:terminal`,
      })
      if (!(await hasFreshLease(deps.workflowOutboxRepo, operation))) return { status: 'stale_lease' }
      lastEventCursor = checkpoint.checkpoint.cursor
      if (event.type === 'final') {
        const finalized = await deps.finalizeReport?.({
          researchId: input.research.id,
          reportMd: event.reportMd,
          workerId: operation.leaseOwner ?? 'run-worker',
        }, {
          researchRepo: deps.researchRepo,
          txLogRepo: deps.txLogRepo,
          workflowOutboxRepo: deps.workflowOutboxRepo,
        })
        if (finalized?.status === 'race_lost') return { status: 'stale_lease' }
      }
      break
    }
  }

  const completed = await deps.workflowOutboxRepo.complete(operation.id, operation.fencingToken, {
    phase: 'succeeded',
  })
  if (!completed) return { status: 'stale_lease' }
  deps.markDone?.(input.research.id)
  return { status: 'completed', terminal }
}

async function hasFreshLease(repo: WorkflowOutboxRepo, operation: WorkflowOperation) {
  const latest = await repo.findByOperationKey(operation.operationKey)
  if (!latest) return false
  if (latest.id !== operation.id) return false
  if (latest.fencingToken !== operation.fencingToken) return false
  if (latest.leaseOwner !== operation.leaseOwner) return false
  if (latest.phase === 'succeeded' || latest.phase === 'manual') return false
  return Boolean(latest.leaseExpiresAt && latest.leaseExpiresAt > new Date())
}

async function shouldFailReclaimedRunAfterIntent(
  operation: WorkflowOperation,
  research: RunWorkerResearch,
  deps: Pick<RunWorkerDeps, 'txLogRepo'>,
) {
  if (operation.attempts <= 1) return false
  const entries = await deps.txLogRepo.listByResearchId(research.address, research.id, 200)
  return entries.some((entry) => (
    entry.backend === 'escrow'
    && entry.researchId === research.id
    && Boolean(entry.paymentIntentId)
  ))
}

async function failReclaimedRunAfterIntent(
  operation: WorkflowOperation,
  research: RunWorkerResearch,
  deps: Pick<RunWorkerDeps, 'researchRepo' | 'workflowOutboxRepo' | 'markDone'>,
): Promise<ProcessClaimedRunOperationResult> {
  const closeDigest = digestJson({
    type: 'CLOSE',
    reason: 'run_lease_reclaimed_after_intent',
    researchId: research.id,
    escrowAddress: operation.escrowAddress,
    runOperationKey: operation.operationKey,
    runFencingToken: operation.fencingToken,
  })
  const finalized = await deps.researchRepo.requestFinalization({
    id: research.id,
    expected: {
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
    },
    next: { status: 'failed', finalizationState: 'closing' },
    errorMessage: 'RUN lease was reclaimed after a payment intent; automatic rerun is disabled',
    closeOperation: {
      operationKey: `CLOSE:${research.id}`,
      type: 'CLOSE',
      researchId: research.id,
      escrowAddress: operation.escrowAddress,
      phase: 'queued',
      payloadHash: closeDigest,
      protectedPayloadDigest: closeDigest,
      leaseOwner: operation.leaseOwner ?? 'run-worker',
      leaseDurationMs: 30_000,
    },
    workflowOutboxRepo: deps.workflowOutboxRepo,
  })
  if (!finalized) return { status: 'stale_lease' }

  const completed = await deps.workflowOutboxRepo.complete(operation.id, operation.fencingToken, {
    phase: 'succeeded',
  })
  if (!completed) return { status: 'stale_lease' }
  deps.markDone?.(research.id)
  return { status: 'safe_failed' }
}

function digestJson(value: unknown) {
  return `0x${createHash('sha256').update(stableJson(value)).digest('hex')}`
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
