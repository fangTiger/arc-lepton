import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryResearchEventRepo } from '@/lib/db/research-event-repo-memory'
import { MemoryResearchRepo } from '@/lib/db/research-repo-memory'
import { MemoryTxLogRepo } from '@/lib/db/tx-log-repo-memory'
import { MemoryWorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo-memory'
import type { WorkflowOperation, WorkflowOperationClaimInput, WorkflowOperationType } from '@/lib/db/workflow-outbox-repo'
import {
  createResearchWorkflowHandlers,
  processDueWorkflowOperations,
  recoverManualWorkflowOperation,
} from './workflow-worker'

const operationTypes: WorkflowOperationType[] = ['ACTIVATE', 'RUN', 'SETTLE', 'RECONCILE', 'CLOSE']

describe('processDueWorkflowOperations', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('claims due operations and dispatches each supported type under the current lease', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:00:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()
    for (const type of operationTypes) {
      await seedExpiredOperation(repo, { type, operationKey: `${type}:research-1` })
    }
    const handled: string[] = []

    const result = await processDueWorkflowOperations({
      workflowOutboxRepo: repo,
      workerId: 'worker-a',
      leaseDurationMs: 30_000,
      now: new Date('2026-07-11T04:00:10.000Z'),
      handlers: Object.fromEntries(operationTypes.map((type) => [
        type,
        vi.fn(async (operation) => {
          handled.push(`${operation.type}:${operation.leaseOwner}:${operation.fencingToken}`)
          await repo.complete(operation.id, operation.fencingToken)
        }),
      ])),
    })

    expect(result).toMatchObject({
      scanned: 5,
      claimed: 5,
      dispatched: 5,
      failed: 0,
      manual: 0,
      skipped: 0,
    })
    expect(handled).toEqual([
      'ACTIVATE:worker-a:2',
      'CLOSE:worker-a:2',
      'RECONCILE:worker-a:2',
      'RUN:worker-a:2',
      'SETTLE:worker-a:2',
    ])
    await expect(repo.listDueOperations({ now: new Date('2026-07-11T04:00:11.000Z') })).resolves.toHaveLength(0)
  })

  it('passes a renew helper that extends only the current owner and fencing token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:05:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()
    await seedExpiredOperation(repo, { type: 'RUN', operationKey: 'RUN:research-renew' })
    const renewedLeaseExpiresAt = new Date('2026-07-11T04:05:42.000Z')

    await expect(processDueWorkflowOperations({
      workflowOutboxRepo: repo,
      workerId: 'worker-renew',
      leaseDurationMs: 40_000,
      now: new Date('2026-07-11T04:05:02.000Z'),
      handlers: {
        RUN: async (operation, context) => {
          vi.setSystemTime(new Date('2026-07-11T04:05:02.000Z'))
          const renewed = await context.renewLease()
          expect(renewed).toMatchObject({
            id: operation.id,
            leaseOwner: 'worker-renew',
            fencingToken: operation.fencingToken,
            leaseExpiresAt: renewedLeaseExpiresAt,
          })
          await repo.complete(operation.id, operation.fencingToken)
        },
      },
    })).resolves.toMatchObject({ claimed: 1, dispatched: 1, failed: 0 })

    await expect(repo.findByOperationKey('RUN:research-renew')).resolves.toMatchObject({
      phase: 'succeeded',
      leaseOwner: null,
    })
  })

  it('uses release with backoff and redacted errors when a handler fails below the manual threshold', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:10:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()
    await seedExpiredOperation(repo, { type: 'SETTLE', operationKey: 'SETTLE:research-backoff' })

    const result = await processDueWorkflowOperations({
      workflowOutboxRepo: repo,
      workerId: 'worker-backoff',
      leaseDurationMs: 30_000,
      now: new Date('2026-07-11T04:10:02.000Z'),
      maxAttempts: 4,
      backoffBaseMs: 60_000,
      handlers: {
        SETTLE: async () => {
          throw new Error(`RPC timeout secret=${'sk-test-secret'.repeat(4)}`)
        },
      },
    })

    expect(result).toMatchObject({
      scanned: 1,
      claimed: 1,
      dispatched: 1,
      failed: 1,
      manual: 0,
    })
    await expect(repo.findByOperationKey('SETTLE:research-backoff')).resolves.toMatchObject({
      phase: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
      attempts: 2,
      nextAttemptAt: new Date('2026-07-11T04:12:02.000Z'),
    })
    const operation = await repo.findByOperationKey('SETTLE:research-backoff')
    expect(operation?.lastError).toContain('RPC timeout')
    expect(operation?.lastError).not.toContain('sk-test-secret')
  })

  it('dead-letters exhausted operations into manual instead of immediately retrying', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:15:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()
    await seedExpiredOperation(repo, { type: 'CLOSE', operationKey: 'CLOSE:research-manual' })
    const manualCallbacks: string[] = []

    const result = await processDueWorkflowOperations({
      workflowOutboxRepo: repo,
      workerId: 'worker-manual',
      leaseDurationMs: 30_000,
      now: new Date('2026-07-11T04:15:02.000Z'),
      maxAttempts: 2,
      onManual: async (operation) => {
        manualCallbacks.push(operation.operationKey)
      },
      handlers: {
        CLOSE: async () => {
          throw new Error('chain/db evidence mismatch')
        },
      },
    })

    expect(result).toMatchObject({
      scanned: 1,
      claimed: 1,
      dispatched: 1,
      failed: 0,
      manual: 1,
    })
    await expect(repo.findByOperationKey('CLOSE:research-manual')).resolves.toMatchObject({
      phase: 'manual',
      leaseOwner: null,
      leaseExpiresAt: null,
      attempts: 2,
      lastError: 'chain/db evidence mismatch',
    })
    expect(manualCallbacks).toEqual(['CLOSE:research-manual'])
    await expect(repo.listDueOperations({ now: new Date('2026-07-11T04:30:00.000Z') })).resolves.toHaveLength(0)
  })

  it('dead-letters missed escrow expiry as a serious operational manual recovery item', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:17:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()
    await seedExpiredOperation(repo, { type: 'SETTLE', operationKey: 'SETTLE:research-expired' })
    const manualCallbacks: string[] = []

    const result = await processDueWorkflowOperations({
      workflowOutboxRepo: repo,
      workerId: 'worker-expired',
      leaseDurationMs: 30_000,
      now: new Date('2026-07-11T04:17:02.000Z'),
      maxAttempts: 2,
      onManual: async (operation, lastError) => {
        manualCallbacks.push(`${operation.operationKey}:${lastError}`)
      },
      handlers: {
        SETTLE: async () => {
          throw new Error('ESCROW_EXPIRED_BEFORE_FINALIZATION: serious operational alert; provider payment missed expiry and requires manual handling')
        },
      },
    })

    expect(result).toMatchObject({
      scanned: 1,
      claimed: 1,
      dispatched: 1,
      failed: 0,
      manual: 1,
    })
    await expect(repo.findByOperationKey('SETTLE:research-expired')).resolves.toMatchObject({
      phase: 'manual',
      leaseOwner: null,
      leaseExpiresAt: null,
      attempts: 2,
      lastError: expect.stringContaining('ESCROW_EXPIRED_BEFORE_FINALIZATION'),
    })
    const operation = await repo.findByOperationKey('SETTLE:research-expired')
    expect(operation?.lastError).toContain('serious operational alert')
    expect(manualCallbacks).toEqual([
      expect.stringContaining('SETTLE:research-expired:ESCROW_EXPIRED_BEFORE_FINALIZATION'),
    ])
  })

  it('allows concurrent workers to scan the same due operation but dispatches it only once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:20:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()
    await seedExpiredOperation(repo, { type: 'RUN', operationKey: 'RUN:research-race' })
    const handler = vi.fn(async (operation) => {
      await repo.complete(operation.id, operation.fencingToken)
    })

    const [left, right] = await Promise.all([
      processDueWorkflowOperations({
        workflowOutboxRepo: repo,
        workerId: 'worker-left',
        leaseDurationMs: 30_000,
        now: new Date('2026-07-11T04:20:02.000Z'),
        handlers: { RUN: handler },
      }),
      processDueWorkflowOperations({
        workflowOutboxRepo: repo,
        workerId: 'worker-right',
        leaseDurationMs: 30_000,
        now: new Date('2026-07-11T04:20:02.000Z'),
        handlers: { RUN: handler },
      }),
    ])

    expect(left.claimed + right.claimed).toBe(1)
    expect(left.dispatched + right.dispatched).toBe(1)
    expect(left.skipped + right.skipped).toBe(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('createResearchWorkflowHandlers', () => {
  it('wires ACTIVATE and RUN to the concrete processors while settlement stages remain injected', async () => {
    const researchRepo = new MemoryResearchRepo()
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const researchEventRepo = new MemoryResearchEventRepo()
    const txLogRepo = new MemoryTxLogRepo()
    const research = await researchRepo.create({
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'PEPE',
      budgetUsdc: '0.01',
    })
    const processActivationOperation = vi.fn(async () => ({ status: 'running_started' as const }))
    const processClaimedRunOperation = vi.fn(async () => ({ status: 'completed' as const, terminal: null }))
    const calls: string[] = []

    const handlers = createResearchWorkflowHandlers({
      researchRepo,
      workflowOutboxRepo,
      researchEventRepo,
      txLogRepo,
      processActivationOperation,
      processClaimedRunOperation,
      submitActivation: async () => ({ txHash: hex32('12'), chainId: 5042002, blockNumber: null }),
      confirmActivation: async () => ({ status: 'active' }),
      settle: async (operation) => {
        calls.push(`SETTLE:${operation.operationKey}`)
      },
      reconcile: async (operation) => {
        calls.push(`RECONCILE:${operation.operationKey}`)
      },
      close: async (operation) => {
        calls.push(`CLOSE:${operation.operationKey}`)
      },
    })

    const activateOperation = operationRecord({ type: 'ACTIVATE', operationKey: `ACTIVATE:${research.id}`, researchId: research.id })
    const runOperation = operationRecord({ type: 'RUN', operationKey: `RUN:${research.id}`, researchId: research.id })
    await handlers.ACTIVATE(activateOperation, handlerContext())
    await handlers.RUN(runOperation, handlerContext())
    await handlers.SETTLE(operationRecord({ type: 'SETTLE', operationKey: `SETTLE:${research.id}`, researchId: research.id }), handlerContext())
    await handlers.RECONCILE(operationRecord({ type: 'RECONCILE', operationKey: `RECONCILE:${research.id}`, researchId: research.id }), handlerContext())
    await handlers.CLOSE(operationRecord({ type: 'CLOSE', operationKey: `CLOSE:${research.id}`, researchId: research.id }), handlerContext())

    expect(processActivationOperation).toHaveBeenCalledWith(activateOperation, expect.objectContaining({
      researchRepo,
      workflowOutboxRepo,
      workerId: 'worker-a',
    }))
    expect(processClaimedRunOperation).toHaveBeenCalledWith(expect.objectContaining({
      operation: runOperation,
      research: {
        id: research.id,
        address: research.address,
        topic: research.topic,
        budgetUsdc: research.budgetUsdc,
      },
      deps: expect.objectContaining({
        workflowOutboxRepo,
        researchEventRepo,
        researchRepo,
        txLogRepo,
      }),
    }))
    expect(calls).toEqual([
      `SETTLE:SETTLE:${research.id}`,
      `RECONCILE:RECONCILE:${research.id}`,
      `CLOSE:CLOSE:${research.id}`,
    ])
  })

  it('dispatches ACTIVATE/RUN/SETTLE/RECONCILE/CLOSE and loads durable research for RUN', async () => {
    const researchRepo = new MemoryResearchRepo()
    const research = await researchRepo.create({
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'PEPE',
      budgetUsdc: '0.01',
    })
    const calls: string[] = []
    const handlers = createResearchWorkflowHandlers({
      researchRepo,
      activate: async (operation) => {
        calls.push(`ACTIVATE:${operation.operationKey}`)
      },
      run: async (operation, runResearch) => {
        calls.push(`RUN:${operation.operationKey}:${runResearch.topic}`)
      },
      settle: async (operation) => {
        calls.push(`SETTLE:${operation.operationKey}`)
      },
      reconcile: async (operation) => {
        calls.push(`RECONCILE:${operation.operationKey}`)
      },
      close: async (operation) => {
        calls.push(`CLOSE:${operation.operationKey}`)
      },
    })

    await handlers.ACTIVATE(operationRecord({ type: 'ACTIVATE', operationKey: `ACTIVATE:${research.id}`, researchId: research.id }), handlerContext())
    await handlers.RUN(operationRecord({ type: 'RUN', operationKey: `RUN:${research.id}`, researchId: research.id }), handlerContext())
    await handlers.SETTLE(operationRecord({ type: 'SETTLE', operationKey: `SETTLE:${research.id}`, researchId: research.id }), handlerContext())
    await handlers.RECONCILE(operationRecord({ type: 'RECONCILE', operationKey: `RECONCILE:${research.id}`, researchId: research.id }), handlerContext())
    await handlers.CLOSE(operationRecord({ type: 'CLOSE', operationKey: `CLOSE:${research.id}`, researchId: research.id }), handlerContext())

    expect(calls).toEqual([
      `ACTIVATE:ACTIVATE:${research.id}`,
      `RUN:RUN:${research.id}:PEPE`,
      `SETTLE:SETTLE:${research.id}`,
      `RECONCILE:RECONCILE:${research.id}`,
      `CLOSE:CLOSE:${research.id}`,
    ])
  })

  it('fails RUN dispatch before side effects when the durable research row is missing', async () => {
    const handlers = createResearchWorkflowHandlers({
      researchRepo: new MemoryResearchRepo(),
      activate: async () => undefined,
      run: async () => {
        throw new Error('RUN handler should not be called without research')
      },
      settle: async () => undefined,
      reconcile: async () => undefined,
      close: async () => undefined,
    })

    await expect(
      handlers.RUN(operationRecord({ type: 'RUN', operationKey: 'RUN:missing', researchId: 'missing' }), handlerContext()),
    ).rejects.toThrow('Research missing for RUN operation missing')
  })
})

describe('recoverManualWorkflowOperation', () => {
  it('rejects recovery for non-manual operations before audit or lifecycle changes', async () => {
    const researchRepo = new MemoryResearchRepo()
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const research = await completedManualResearch(researchRepo)
    await workflowOutboxRepo.claimOperation(operationInput({
      type: 'CLOSE',
      operationKey: `CLOSE:${research.id}`,
      researchId: research.id,
      leaseOwner: 'active-worker',
      leaseDurationMs: 30_000,
    }))
    const audit = vi.fn()

    await expect(recoverManualWorkflowOperation({
      workflowOutboxRepo,
      researchRepo,
      operationKey: `CLOSE:${research.id}`,
      action: 'requeue',
      operator: 'ops-1',
      reason: '不能恢复非 manual operation',
      evidenceDigest: hex32('ab'),
      audit,
    })).resolves.toEqual({ status: 'not_manual' })

    expect(audit).not.toHaveBeenCalled()
    await expect(workflowOutboxRepo.findByOperationKey(`CLOSE:${research.id}`)).resolves.toMatchObject({
      phase: 'queued',
      leaseOwner: 'active-worker',
    })
    await expect(researchRepo.findById(research.id)).resolves.toMatchObject({
      finalizationState: 'manual',
    })
  })

  it('requeues a manual operation with audit evidence and moves research manual back to closing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T05:00:00.000Z'))
    const researchRepo = new MemoryResearchRepo()
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const research = await completedManualResearch(researchRepo)
    await manualOperation(workflowOutboxRepo, { type: 'CLOSE', operationKey: `CLOSE:${research.id}`, researchId: research.id })
    const audit: unknown[] = []

    const result = await recoverManualWorkflowOperation({
      workflowOutboxRepo,
      researchRepo,
      operationKey: `CLOSE:${research.id}`,
      action: 'requeue',
      operator: 'ops-1',
      reason: '已复核 settlement evidence，可继续 close',
      evidenceDigest: hex32('cd'),
      now: new Date('2026-07-11T05:00:10.000Z'),
      audit: async (entry) => {
        audit.push(entry)
      },
    })

    expect(result).toEqual({ status: 'requeued' })
    await expect(workflowOutboxRepo.findByOperationKey(`CLOSE:${research.id}`)).resolves.toMatchObject({
      phase: 'queued',
      leaseOwner: null,
      nextAttemptAt: new Date('2026-07-11T05:00:10.000Z'),
    })
    await expect(researchRepo.findById(research.id)).resolves.toMatchObject({
      finalizationState: 'closing',
    })
    expect(audit).toEqual([
      expect.objectContaining({
        operationKey: `CLOSE:${research.id}`,
        action: 'requeue',
        operator: 'ops-1',
        reason: '已复核 settlement evidence，可继续 close',
        evidenceDigest: hex32('cd'),
        previousPhase: 'manual',
        nextPhase: 'queued',
        at: new Date('2026-07-11T05:00:10.000Z'),
      }),
    ])
  })

  it('does not mutate manual recovery state when audit persistence fails', async () => {
    const researchRepo = new MemoryResearchRepo()
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const research = await completedManualResearch(researchRepo)
    await manualOperation(workflowOutboxRepo, { type: 'CLOSE', operationKey: `CLOSE:${research.id}`, researchId: research.id })

    await expect(recoverManualWorkflowOperation({
      workflowOutboxRepo,
      researchRepo,
      operationKey: `CLOSE:${research.id}`,
      action: 'requeue',
      operator: 'ops-1',
      reason: '审计落库失败时不能改变状态',
      evidenceDigest: hex32('de'),
      audit: async () => {
        throw new Error('audit database unavailable')
      },
    })).rejects.toThrow('audit database unavailable')

    await expect(workflowOutboxRepo.findByOperationKey(`CLOSE:${research.id}`)).resolves.toMatchObject({
      phase: 'manual',
    })
    await expect(researchRepo.findById(research.id)).resolves.toMatchObject({
      finalizationState: 'manual',
    })
  })

  it('marks manual close as succeeded only when public evidence proves the escrow is closed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T05:05:00.000Z'))
    const researchRepo = new MemoryResearchRepo()
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const research = await completedManualResearch(researchRepo)
    await manualOperation(workflowOutboxRepo, { type: 'CLOSE', operationKey: `CLOSE:${research.id}`, researchId: research.id })
    const audit: unknown[] = []

    await expect(recoverManualWorkflowOperation({
      workflowOutboxRepo,
      researchRepo,
      operationKey: `CLOSE:${research.id}`,
      action: 'mark_closed',
      operator: 'ops-1',
      reason: '尝试使用未验证 evidence',
      evidenceDigest: hex32('ef'),
      verifyClosedEvidence: async () => false,
      audit: async (entry) => {
        audit.push(entry)
      },
    })).resolves.toEqual({ status: 'evidence_rejected' })
    expect(audit).toHaveLength(0)

    await expect(recoverManualWorkflowOperation({
      workflowOutboxRepo,
      researchRepo,
      operationKey: `CLOSE:${research.id}`,
      action: 'mark_closed',
      operator: 'ops-1',
      reason: '公开 receipt 已证明 Escrow Closed',
      evidenceDigest: hex32('ef'),
      now: new Date('2026-07-11T05:05:10.000Z'),
      verifyClosedEvidence: async () => true,
      audit: async (entry) => {
        audit.push(entry)
      },
    })).resolves.toEqual({ status: 'closed' })

    await expect(workflowOutboxRepo.findByOperationKey(`CLOSE:${research.id}`)).resolves.toMatchObject({
      phase: 'succeeded',
      leaseOwner: null,
    })
    await expect(researchRepo.findById(research.id)).resolves.toMatchObject({
      finalizationState: 'closed',
    })
    expect(audit).toEqual([
      expect.objectContaining({
        operationKey: `CLOSE:${research.id}`,
        action: 'mark_closed',
        previousPhase: 'manual',
        nextPhase: 'succeeded',
        evidenceDigest: hex32('ef'),
      }),
    ])
  })
})

async function seedExpiredOperation(repo: MemoryWorkflowOutboxRepo, overrides: Partial<WorkflowOperationClaimInput> = {}) {
  const claim = await repo.claimOperation(operationInput(overrides))
  if (claim.status !== 'claimed') throw new Error('seed operation was not claimed')
  vi.setSystemTime(new Date(Date.now() + 2_000))
  return claim.operation
}

function operationInput(overrides: Partial<WorkflowOperationClaimInput> = {}): WorkflowOperationClaimInput {
  const type = overrides.type ?? 'RUN'
  return {
    operationKey: `${type}:research-1`,
    type,
    researchId: 'research-1',
    escrowAddress: '0x4444444444444444444444444444444444444444',
    phase: 'queued',
    payloadHash: hex32('aa'),
    protectedPayloadDigest: hex32('bb'),
    leaseOwner: 'seed-worker',
    leaseDurationMs: 1_000,
    nextAttemptAt: new Date('2026-07-11T04:00:00.000Z'),
    ...overrides,
  }
}

function operationRecord(overrides: Partial<WorkflowOperation>): WorkflowOperation {
  return {
    id: 'operation-id',
    operationKey: 'RUN:research-1',
    type: 'RUN',
    researchId: 'research-1',
    escrowAddress: '0x4444444444444444444444444444444444444444',
    phase: 'running',
    payloadHash: hex32('aa'),
    protectedPayloadDigest: hex32('bb'),
    leaseOwner: 'worker-a',
    leaseExpiresAt: new Date('2026-07-11T04:30:00.000Z'),
    fencingToken: 1,
    attempts: 1,
    nextAttemptAt: new Date('2026-07-11T04:00:00.000Z'),
    txHash: null,
    chainId: null,
    blockNumber: null,
    blockHash: null,
    logIndex: null,
    lastError: null,
    createdAt: new Date('2026-07-11T04:00:00.000Z'),
    updatedAt: new Date('2026-07-11T04:00:00.000Z'),
    ...overrides,
  }
}

function handlerContext() {
  return {
    workerId: 'worker-a',
    renewLease: async () => null,
  }
}

async function completedManualResearch(researchRepo: MemoryResearchRepo) {
  const research = await researchRepo.create({
    address: '0xabcdef000000000000000000000000000000c1d3',
    topic: 'PEPE',
    budgetUsdc: '0.01',
  })
  await researchRepo.transitionLifecycle(
    research.id,
    { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
    { status: 'completed', finalizationState: 'closing' },
  )
  await researchRepo.transitionLifecycle(
    research.id,
    { status: 'completed', activationPhase: 'active', finalizationState: 'closing', quotaReservationState: 'consumed' },
    { finalizationState: 'manual' },
  )
  const current = await researchRepo.findById(research.id)
  if (!current) throw new Error('missing research')
  return current
}

async function manualOperation(workflowOutboxRepo: MemoryWorkflowOutboxRepo, overrides: Partial<WorkflowOperationClaimInput>) {
  const claim = await workflowOutboxRepo.claimOperation(operationInput({
    type: 'CLOSE',
    operationKey: 'CLOSE:research-1',
    researchId: 'research-1',
    ...overrides,
  }))
  if (claim.status !== 'claimed') throw new Error('manual seed was not claimed')
  await workflowOutboxRepo.failAndRelease(claim.operation.id, claim.operation.fencingToken, {
    phase: 'manual',
    lastError: 'manual recovery required',
    nextAttemptAt: new Date('2026-07-11T05:00:00.000Z'),
  })
  return claim.operation
}

function hex32(byte: string) {
  return `0x${byte.repeat(32)}`
}
