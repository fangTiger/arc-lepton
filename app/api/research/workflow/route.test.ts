import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const assertDurableDbAvailableForEscrow = vi.fn()
  const assertDurableDbAvailable = vi.fn()
  const processDueWorkflowOperations = vi.fn(async () => ({
    scanned: 1,
    claimed: 1,
    dispatched: 1,
    failed: 0,
    manual: 0,
    skipped: 0,
  }))
  const recoverManualWorkflowOperation = vi.fn(async (input: { audit?: (entry: any) => Promise<void> }) => {
    await input.audit?.({
      operationKey: 'CLOSE:research-1',
      action: 'requeue',
      operator: 'ops-1',
      reason: '已复核链上 evidence，可以重新 close',
      evidenceDigest: `0x${'ab'.repeat(32)}`,
      previousPhase: 'manual',
      nextPhase: 'queued',
      at: new Date('2026-07-11T05:00:00.000Z'),
    })
    return { status: 'requeued' }
  })
  const settleEscrowResearchPayments = vi.fn(async () => ({
    status: 'confirmed',
    settlementId: 'SETTLE:research-1',
    settlementKey: `0x${'cd'.repeat(32)}`,
    itemsHash: `0x${'ef'.repeat(32)}`,
    total: '100',
    itemCount: 1,
    txHash: `0x${'12'.repeat(32)}`,
    blockNumber: '123456',
  }))
  const processSettlementOperation = vi.fn(async () => ({ status: 'submitted' }))
  const workflowHandlers = {
    ACTIVATE: vi.fn(),
    RUN: vi.fn(),
    SETTLE: vi.fn(),
    RECONCILE: vi.fn(),
    CLOSE: vi.fn(),
  }
  const createResearchWorkflowHandlers = vi.fn(() => workflowHandlers)

  return {
    assertDurableDbAvailableForEscrow,
    assertDurableDbAvailable,
    processDueWorkflowOperations,
    recoverManualWorkflowOperation,
    createResearchWorkflowHandlers,
    settleEscrowResearchPayments,
    processSettlementOperation,
    workflowHandlers,
    researchRepo: {
      kind: 'research-repo',
      findById: vi.fn(async () => ({
        id: 'research-1',
        address: '0xB000000000000000000000000000000000000001',
        researchKey: `0x${'ab'.repeat(32)}`,
        escrowAddress: '0xE000000000000000000000000000000000000001',
        chainId: 5_042_002,
      })),
    },
    txLogRepo: { kind: 'tx-log-repo' },
    workflowOutboxRepo: {
      kind: 'workflow-outbox-repo',
      recordBroadcast: vi.fn(async () => true),
      complete: vi.fn(async () => true),
    },
    workflowManualRecoveryAuditRepo: {
      record: vi.fn(),
    },
    reset() {
      assertDurableDbAvailableForEscrow.mockReset()
      assertDurableDbAvailable.mockReset()
      processDueWorkflowOperations.mockReset()
      createResearchWorkflowHandlers.mockClear()
      processDueWorkflowOperations.mockResolvedValue({
        scanned: 1,
        claimed: 1,
        dispatched: 1,
        failed: 0,
        manual: 0,
        skipped: 0,
      })
      recoverManualWorkflowOperation.mockReset()
      processSettlementOperation.mockReset()
      processSettlementOperation.mockResolvedValue({ status: 'submitted' })
      settleEscrowResearchPayments.mockReset()
      settleEscrowResearchPayments.mockResolvedValue({
        status: 'confirmed',
        settlementId: 'SETTLE:research-1',
        settlementKey: `0x${'cd'.repeat(32)}`,
        itemsHash: `0x${'ef'.repeat(32)}`,
        total: '100',
        itemCount: 1,
        txHash: `0x${'12'.repeat(32)}`,
        blockNumber: '123456',
      })
      this.researchRepo.findById.mockReset()
      this.researchRepo.findById.mockResolvedValue({
        id: 'research-1',
        address: '0xB000000000000000000000000000000000000001',
        researchKey: `0x${'ab'.repeat(32)}`,
        escrowAddress: '0xE000000000000000000000000000000000000001',
        chainId: 5_042_002,
      })
      this.workflowOutboxRepo.recordBroadcast.mockReset()
      this.workflowOutboxRepo.recordBroadcast.mockResolvedValue(true)
      this.workflowOutboxRepo.complete.mockReset()
      this.workflowOutboxRepo.complete.mockResolvedValue(true)
      recoverManualWorkflowOperation.mockImplementation(async (input: { audit?: (entry: any) => Promise<void> }) => {
        await input.audit?.({
          operationKey: 'CLOSE:research-1',
          action: 'requeue',
          operator: 'ops-1',
          reason: '已复核链上 evidence，可以重新 close',
          evidenceDigest: `0x${'ab'.repeat(32)}`,
          previousPhase: 'manual',
          nextPhase: 'queued',
          at: new Date('2026-07-11T05:00:00.000Z'),
        })
        return { status: 'requeued' }
      })
      this.workflowManualRecoveryAuditRepo.record.mockReset()
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockState.researchRepo,
  txLogRepo: mockState.txLogRepo,
  workflowOutboxRepo: mockState.workflowOutboxRepo,
  workflowManualRecoveryAuditRepo: mockState.workflowManualRecoveryAuditRepo,
  assertDurableDbAvailableForEscrow: mockState.assertDurableDbAvailableForEscrow,
  assertDurableDbAvailable: mockState.assertDurableDbAvailable,
}))

vi.mock('@/lib/research/workflow-worker', () => ({
  processDueWorkflowOperations: mockState.processDueWorkflowOperations,
  recoverManualWorkflowOperation: mockState.recoverManualWorkflowOperation,
  createResearchWorkflowHandlers: mockState.createResearchWorkflowHandlers,
}))

vi.mock('@/lib/research/settlement-client', () => ({
  settleEscrowResearchPayments: mockState.settleEscrowResearchPayments,
}))

vi.mock('@/lib/research/settlement-worker', () => ({
  canonicalSettlementIdFromOperationKey: (operationKey: string) => '00000000-0000-4000-8000-000000000011',
  processSettlementOperation: mockState.processSettlementOperation,
}))

const mutableEnv = process.env as Record<string, string | undefined>
const workerSecret = 'test-worker-auth-secret-test-worker-auth-secret'

beforeEach(() => {
  vi.resetModules()
  mockState.reset()
  mutableEnv.NODE_ENV = 'test'
  mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
  mutableEnv.ARC_RESEARCH_WORKER_AUTH_SECRET = workerSecret
})

function workerRequest(body: unknown = {}, token = workerSecret) {
  return new Request('http://localhost/api/research/workflow', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function workflowOperation() {
  return {
    id: 'operation-1',
    operationKey: 'SETTLE:research-1',
    type: 'SETTLE',
    researchId: 'research-1',
    escrowAddress: '0xE000000000000000000000000000000000000001',
    phase: 'running',
    payloadHash: `0x${'34'.repeat(32)}`,
    protectedPayloadDigest: `0x${'56'.repeat(32)}`,
    leaseOwner: 'cron-a',
    leaseExpiresAt: new Date('2026-07-11T05:01:00.000Z'),
    fencingToken: 7,
    attempts: 1,
    nextAttemptAt: new Date('2026-07-11T05:00:00.000Z'),
    txHash: null,
    chainId: null,
    blockNumber: null,
    blockHash: null,
    logIndex: null,
    lastError: null,
    createdAt: new Date('2026-07-11T05:00:00.000Z'),
    updatedAt: new Date('2026-07-11T05:00:00.000Z'),
  } as any
}

describe('POST /api/research/workflow', () => {
  it('requires worker bearer auth before touching workflow state', async () => {
    const { POST } = await import('./route')

    const res = await POST(new Request('http://localhost/api/research/workflow', { method: 'POST' }))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'WORKER_UNAUTHORIZED' })
    expect(mockState.assertDurableDbAvailableForEscrow).not.toHaveBeenCalled()
    expect(mockState.assertDurableDbAvailable).not.toHaveBeenCalled()
    expect(mockState.processDueWorkflowOperations).not.toHaveBeenCalled()
  })

  it('fails closed when worker auth is not configured', async () => {
    delete mutableEnv.ARC_RESEARCH_WORKER_AUTH_SECRET
    const { POST } = await import('./route')

    const res = await POST(workerRequest())

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'DURABLE_DB_REQUIRED' })
    expect(mockState.processDueWorkflowOperations).not.toHaveBeenCalled()
  })

  it('fails closed without durable DB before draining existing escrow workflow during calldata rollback', async () => {
    mutableEnv.NODE_ENV = 'production'
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    delete mutableEnv.DATABASE_URL
    delete mutableEnv.POSTGRES_URL
    mockState.assertDurableDbAvailable.mockImplementationOnce(() => {
      const error = new Error('Durable Postgres is required for research workflow worker') as Error & { code: string }
      error.code = 'DURABLE_DB_REQUIRED'
      throw error
    })
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ limit: 2, workerId: 'rollback-cron' }))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'DURABLE_DB_REQUIRED' })
    expect(mockState.assertDurableDbAvailable).toHaveBeenCalledWith('research workflow worker')
    expect(mockState.processDueWorkflowOperations).not.toHaveBeenCalled()
  })

  it('allows protected workflow worker to drain existing escrow operations when new escrow traffic is disabled', async () => {
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ limit: 2, workerId: 'rollback-cron' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      scanned: 1,
      claimed: 1,
      dispatched: 1,
      failed: 0,
      manual: 0,
      skipped: 0,
    })
    expect(mockState.assertDurableDbAvailable).toHaveBeenCalledWith('research workflow worker')
    expect(mockState.processDueWorkflowOperations).toHaveBeenCalledWith(expect.objectContaining({
      workflowOutboxRepo: mockState.workflowOutboxRepo,
      handlers: mockState.workflowHandlers,
      workerId: 'rollback-cron',
      limit: 2,
    }))
  })

  it('calls the protected workflow worker with durable outbox dependencies', async () => {
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ limit: 3, workerId: 'cron-a' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      scanned: 1,
      claimed: 1,
      dispatched: 1,
      failed: 0,
      manual: 0,
      skipped: 0,
    })
    expect(mockState.assertDurableDbAvailable).toHaveBeenCalledWith('research workflow worker')
    expect(mockState.processDueWorkflowOperations).toHaveBeenCalledWith(expect.objectContaining({
      workflowOutboxRepo: mockState.workflowOutboxRepo,
      handlers: mockState.workflowHandlers,
      onManual: expect.any(Function),
      workerId: 'cron-a',
      limit: 3,
    }))
    expect(mockState.createResearchWorkflowHandlers).toHaveBeenCalledWith(expect.objectContaining({
      researchRepo: mockState.researchRepo,
      activate: expect.any(Function),
      run: expect.any(Function),
      settle: expect.any(Function),
      reconcile: expect.any(Function),
      close: expect.any(Function),
    }))
  })

  it('rejects malformed JSON instead of defaulting to process_due', async () => {
    const { POST } = await import('./route')

    const res = await POST(new Request('http://localhost/api/research/workflow', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${workerSecret}`,
        'content-type': 'application/json',
      },
      body: '{"limit":',
    }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'INVALID_BODY' })
    expect(mockState.processDueWorkflowOperations).not.toHaveBeenCalled()
  })

  it('wires SETTLE and RECONCILE operations to the research settlement worker only', async () => {
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ limit: 1, workerId: 'cron-a' }))
    expect(res.status).toBe(200)

    const handlerInput = (mockState.createResearchWorkflowHandlers as any).mock.calls[0][0]
    const settleOperation = workflowOperation()
    await handlerInput.settle(settleOperation, {
      workerId: 'cron-a',
      renewLease: async () => null,
    })
    const reconcileOperation = { ...workflowOperation(), type: 'RECONCILE', operationKey: 'RECONCILE:research-1' }
    await handlerInput.reconcile(reconcileOperation, {
      workerId: 'cron-a',
      renewLease: async () => null,
    })

    expect(mockState.processSettlementOperation).toHaveBeenNthCalledWith(1, settleOperation, expect.objectContaining({
      officialUsdc: '0x3600000000000000000000000000000000000000',
      researchRepo: mockState.researchRepo,
      txLogRepo: mockState.txLogRepo,
      workflowOutboxRepo: mockState.workflowOutboxRepo,
      submitSettlement: expect.any(Function),
      recoverSettlement: expect.any(Function),
    }))
    expect(mockState.processSettlementOperation).toHaveBeenNthCalledWith(2, reconcileOperation, expect.objectContaining({
      recoverSettlement: expect.any(Function),
    }))
    expect(mockState.settleEscrowResearchPayments).not.toHaveBeenCalled()
  })

  it('calls protected manual recovery with operator, reason, and evidence digest', async () => {
    const { POST } = await import('./route')

    const res = await POST(workerRequest({
      action: 'recover_manual',
      operationKey: 'CLOSE:research-1',
      recoveryAction: 'requeue',
      operator: 'ops-1',
      reason: '已复核链上 evidence，可以重新 close',
      evidenceDigest: `0x${'ab'.repeat(32)}`,
    }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'requeued' })
    expect(mockState.recoverManualWorkflowOperation).toHaveBeenCalledWith(expect.objectContaining({
      workflowOutboxRepo: mockState.workflowOutboxRepo,
      researchRepo: mockState.researchRepo,
      operationKey: 'CLOSE:research-1',
      action: 'requeue',
      operator: 'ops-1',
      reason: '已复核链上 evidence，可以重新 close',
      evidenceDigest: `0x${'ab'.repeat(32)}`,
      verifyClosedEvidence: expect.any(Function),
      audit: expect.any(Function),
    }))
    expect(mockState.workflowManualRecoveryAuditRepo.record).toHaveBeenCalledWith({
      operationKey: 'CLOSE:research-1',
      action: 'requeue',
      operator: 'ops-1',
      reason: '已复核链上 evidence，可以重新 close',
      evidenceDigest: `0x${'ab'.repeat(32)}`,
      previousPhase: 'manual',
      nextPhase: 'queued',
      createdAt: new Date('2026-07-11T05:00:00.000Z'),
    })
    expect(mockState.processDueWorkflowOperations).not.toHaveBeenCalled()
  })
})
