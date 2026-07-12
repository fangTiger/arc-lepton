import { describe, expect, it, vi, afterEach } from 'vitest'
import type { AgentEvent } from '@/lib/agent/research-agent'
import { MemoryResearchEventRepo } from '@/lib/db/research-event-repo-memory'
import { MemoryResearchRepo } from '@/lib/db/research-repo-memory'
import { MemoryTxLogRepo } from '@/lib/db/tx-log-repo-memory'
import { MemoryWorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo-memory'
import type { WorkflowOperationClaimInput } from '@/lib/db/workflow-outbox-repo'
import { processClaimedRunOperation } from './run-worker'

describe('processClaimedRunOperation', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('persists RUN events with monotonic cursors, publishes them, records a final checkpoint, and completes the lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T05:00:00.000Z'))
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const researchEventRepo = new MemoryResearchEventRepo()
    const claim = await workflowOutboxRepo.claimOperation(operationInput())
    const published: Array<{ event: AgentEvent; cursor: number }> = []

    const result = await processClaimedRunOperation({
      operation: claim.operation,
      research: researchInput(),
      deps: {
        workflowOutboxRepo,
        researchEventRepo,
        publishEvent(_researchId, event, cursor) {
          published.push({ event, cursor })
        },
      },
      agentRunner: async function* () {
        yield { type: 'thinking', text: 'Reading durable context.' }
        yield { type: 'final', reportMd: '# Durable report', totalSpentUsdc: '0', totalCalls: 0 }
      },
    })

    expect(result).toEqual({ status: 'completed', terminal: 'final' })
    await expect(researchEventRepo.listByResearch('research-1')).resolves.toMatchObject([
      {
        cursor: 1,
        type: 'thinking',
        payload: { type: 'thinking', text: 'Reading durable context.' },
        operationKey: 'RUN:research-1',
        attempt: 1,
        fencingToken: 1,
      },
      {
        cursor: 2,
        type: 'final',
        payload: { type: 'final', reportMd: '# Durable report', totalSpentUsdc: '0', totalCalls: 0 },
        operationKey: 'RUN:research-1',
        attempt: 1,
        fencingToken: 1,
      },
    ])
    await expect(researchEventRepo.latestCheckpoint('research-1')).resolves.toMatchObject({
      cursor: 3,
      operationKey: 'RUN:research-1',
      attempt: 1,
      fencingToken: 1,
      state: {
        phase: 'terminal',
        terminalEventType: 'final',
        lastEventCursor: 2,
      },
    })
    await expect(workflowOutboxRepo.findByOperationKey('RUN:research-1')).resolves.toMatchObject({
      phase: 'succeeded',
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    expect(published).toEqual([
      { cursor: 1, event: { type: 'thinking', text: 'Reading durable context.' } },
      { cursor: 2, event: { type: 'final', reportMd: '# Durable report', totalSpentUsdc: '0', totalCalls: 0 } },
    ])
  })

  it('stops a stale worker before durable writes or tool side effects after another owner reclaims the RUN lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T05:10:00.000Z'))
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const researchEventRepo = new MemoryResearchEventRepo()
    const first = await workflowOutboxRepo.claimOperation(operationInput({
      leaseOwner: 'runner-a',
      leaseDurationMs: 1_000,
    }))
    vi.setSystemTime(new Date('2026-07-11T05:10:02.000Z'))
    await workflowOutboxRepo.claimOperation(operationInput({
      leaseOwner: 'runner-b',
      leaseDurationMs: 30_000,
    }))
    const sideEffect = vi.fn()
    const agentRunner = vi.fn(async function* () {
      sideEffect()
      yield { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'call-1' } satisfies AgentEvent
    })

    const result = await processClaimedRunOperation({
      operation: first.operation,
      research: researchInput(),
      deps: {
        workflowOutboxRepo,
        researchEventRepo,
        researchRepo: new MemoryResearchRepo(),
        txLogRepo: new MemoryTxLogRepo(),
        publishEvent: vi.fn(),
      },
      agentRunner,
    })

    expect(result).toEqual({ status: 'stale_lease' })
    expect(agentRunner).not.toHaveBeenCalled()
    expect(sideEffect).not.toHaveBeenCalled()
    await expect(researchEventRepo.listByResearch('research-1')).resolves.toEqual([])
    await expect(researchEventRepo.latestCheckpoint('research-1')).resolves.toBeNull()
    await expect(workflowOutboxRepo.findByOperationKey('RUN:research-1')).resolves.toMatchObject({
      leaseOwner: 'runner-b',
      fencingToken: 2,
      phase: 'queued',
    })
  })

  it('allows a reclaimed RUN lease to retry when no payment intent was created yet', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T05:20:00.000Z'))
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const researchEventRepo = new MemoryResearchEventRepo()
    await workflowOutboxRepo.claimOperation(operationInput({
      leaseOwner: 'runner-a',
      leaseDurationMs: 1_000,
    }))
    vi.setSystemTime(new Date('2026-07-11T05:20:02.000Z'))
    const reclaimed = await workflowOutboxRepo.claimOperation(operationInput({
      leaseOwner: 'runner-b',
      leaseDurationMs: 30_000,
    }))
    const agentRunner = vi.fn(async function* () {
      yield { type: 'final', reportMd: '# Retried before intent', totalSpentUsdc: '0', totalCalls: 0 } satisfies AgentEvent
    })

    const result = await processClaimedRunOperation({
      operation: reclaimed.operation,
      research: researchInput(),
      deps: {
        workflowOutboxRepo,
        researchEventRepo,
        researchRepo: new MemoryResearchRepo(),
        txLogRepo: new MemoryTxLogRepo(),
        publishEvent: vi.fn(),
      },
      agentRunner,
    })

    expect(result).toEqual({ status: 'completed', terminal: 'final' })
    expect(agentRunner).toHaveBeenCalledTimes(1)
  })

  it('marks a reclaimed RUN safely failed instead of rerunning Agent after a payment intent exists', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T05:30:00.000Z'))
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const researchEventRepo = new MemoryResearchEventRepo()
    const researchRepo = new MemoryResearchRepo()
    const txLogRepo = new MemoryTxLogRepo()
    const research = await researchRepo.create({
      address: researchInput().address,
      topic: researchInput().topic,
      budgetUsdc: researchInput().budgetUsdc,
    })
    await workflowOutboxRepo.claimOperation(operationInput({
      operationKey: `RUN:${research.id}`,
      researchId: research.id,
      leaseOwner: 'runner-a',
      leaseDurationMs: 1_000,
    }))
    await txLogRepo.record({
      address: research.address,
      source: 'sentiment',
      amount: '0.0001',
      researchId: research.id,
      requestId: 'request-key-1',
      txStatus: 'pending',
      backend: 'escrow',
      version: 1,
      paymentIntentId: 'intent-1',
      escrowAddress: '0x4444444444444444444444444444444444444444',
      researchKey: `0x${'42'.repeat(32)}`,
    })
    vi.setSystemTime(new Date('2026-07-11T05:30:02.000Z'))
    const reclaimed = await workflowOutboxRepo.claimOperation(operationInput({
      operationKey: `RUN:${research.id}`,
      researchId: research.id,
      leaseOwner: 'runner-b',
      leaseDurationMs: 30_000,
    }))
    const agentRunner = vi.fn(async function* () {
      yield { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'must-not-run' } satisfies AgentEvent
    })

    const result = await processClaimedRunOperation({
      operation: reclaimed.operation,
      research: {
        id: research.id,
        address: research.address,
        topic: research.topic,
        budgetUsdc: research.budgetUsdc,
      },
      deps: {
        workflowOutboxRepo,
        researchEventRepo,
        researchRepo,
        txLogRepo,
        publishEvent: vi.fn(),
        markDone: vi.fn(),
      },
      agentRunner,
    })

    expect(result).toEqual({ status: 'safe_failed' })
    expect(agentRunner).not.toHaveBeenCalled()
    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'failed',
      finalizationState: 'closing',
      errorMessage: 'RUN lease was reclaimed after a payment intent; automatic rerun is disabled',
    })
    await expect(workflowOutboxRepo.findByOperationKey(`CLOSE:${research.id}`)).resolves.toMatchObject({
      type: 'CLOSE',
      researchId: research.id,
      escrowAddress: '0x4444444444444444444444444444444444444444',
      phase: 'queued',
    })
    await expect(workflowOutboxRepo.findByOperationKey(`RUN:${research.id}`)).resolves.toMatchObject({
      phase: 'succeeded',
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    await expect(researchEventRepo.listByResearch(research.id)).resolves.toEqual([])
  })
})

function operationInput(overrides: Partial<WorkflowOperationClaimInput> = {}): WorkflowOperationClaimInput {
  return {
    operationKey: 'RUN:research-1',
    type: 'RUN',
    researchId: 'research-1',
    escrowAddress: '0x4444444444444444444444444444444444444444',
    payloadHash: hex32('aa'),
    protectedPayloadDigest: hex32('bb'),
    leaseOwner: 'runner-a',
    leaseDurationMs: 30_000,
    ...overrides,
  }
}

function researchInput() {
  return {
    id: 'research-1',
    address: '0xabcdef000000000000000000000000000000c1d3',
    topic: 'SHOULD I BUY PEPE?',
    budgetUsdc: '0.01',
  }
}

function hex32(byte: string) {
  return `0x${byte.repeat(32)}`
}
