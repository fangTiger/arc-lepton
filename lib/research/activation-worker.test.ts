import { describe, expect, it, vi } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { MemoryResearchRepo } from '@/lib/db/research-repo-memory'
import { MemoryWorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo-memory'
import { activationOperationKey, runOperationKey } from './funding-expiry'
import { processActivationOperation } from './activation-worker'

async function fundedActivatingFixture(options: { cancelRequestedAt?: Date } = {}) {
  const researchRepo = new MemoryResearchRepo()
  const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
  const created = await researchRepo.createFundingWithQuotaReservation({
    address: '0xabcdef000000000000000000000000000000c1d3',
    buyer: '0xabcdef000000000000000000000000000000c1d3',
    topic: 'PEPE',
    budgetUsdc: '0.01',
    budgetUnits: '10000',
    researchKey: `0x${'aa'.repeat(32)}`,
    expectedEscrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    fundingExpiresAt: new Date('2030-01-01T00:15:00.000Z'),
    expectedExpiresAt: new Date('2030-01-02T00:00:00.000Z'),
    fundingDeadline: new Date('2030-01-01T00:15:00.000Z'),
    intentSigner: '0x5555555555555555555555555555555555555555',
    voucherNonce: `0x${'bb'.repeat(32)}`,
    quotaDate: '2030-01-01',
    cancelRequestedAt: options.cancelRequestedAt,
    chainId: 5042002,
  }, {
    day: '2030-01-01',
    resetAt: new Date('2030-01-02T00:00:00.000Z'),
    walletLimit: 10,
    globalLimit: 100,
  })
  if (!created.ok) throw new Error(created.reason)
  await researchRepo.transitionLifecycle(
    created.research.id,
    { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
    { activationPhase: 'funded' },
  )
  await researchRepo.transitionLifecycle(
    created.research.id,
    { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
    { activationPhase: 'activating', quotaReservationState: 'activating' },
  )
  const protectedPayload = JSON.stringify({
    activationAuthorization: {
      escrow: created.research.expectedEscrowAddress,
      researchKey: `0x${'aa'.repeat(32)}`,
    },
    activationSignature: `0x${'11'.repeat(65)}`,
  })
  const claim = await workflowOutboxRepo.claimOperation({
    operationKey: activationOperationKey(created.research.id),
    type: 'ACTIVATE',
    researchId: created.research.id,
    escrowAddress: created.research.expectedEscrowAddress,
    payloadHash: 'activate',
    protectedPayloadDigest: keccak256(toBytes(protectedPayload)),
    protectedPayload,
    leaseOwner: 'activation-worker',
    leaseDurationMs: 30_000,
  })
  return { researchRepo, workflowOutboxRepo, research: created.research, operation: claim.operation }
}

describe('processActivationOperation', () => {
  it('reconciles an already Active escrow before submitting when txHash was not persisted', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()
    let submitCalled = false

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        submitCalled = true
        throw new Error('链上已 Active 时不应再次 submit ACTIVATE')
      },
      confirmActivation: async () => ({ status: 'active', blockNumber: '123' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    expect(submitCalled).toBe(false)
    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
    })
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      type: 'RUN',
      researchId: research.id,
    })
  })

  it('submits only after pre-broadcast reconcile proves the escrow is not Active', async () => {
    const { researchRepo, workflowOutboxRepo, operation } = await fundedActivatingFixture()
    const calls: string[] = []
    let confirmCount = 0

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        calls.push('submit')
        return { txHash: `0x${'12'.repeat(32)}`, chainId: 5042002, blockNumber: null }
      },
      confirmActivation: async ({ operation: currentOperation }) => {
        calls.push(`confirm:${currentOperation.txHash ?? 'none'}`)
        confirmCount += 1
        return confirmCount === 1
          ? { status: 'not_active' }
          : { status: 'active', blockNumber: '123' }
      },
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    expect(calls).toEqual(['confirm:none', 'submit', `confirm:0x${'12'.repeat(32)}`])
  })

  it('uses a persisted txHash to recover receipt processing without submitting again', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()
    await workflowOutboxRepo.recordBroadcast(operation.id, operation.fencingToken, {
      txHash: `0x${'44'.repeat(32)}`,
      chainId: 5042002,
      blockNumber: null,
    })
    const broadcastOperation = await workflowOutboxRepo.findByOperationKey(activationOperationKey(research.id))
    if (!broadcastOperation) throw new Error('missing operation')

    await expect(processActivationOperation(broadcastOperation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('已有 txHash 的恢复路径不应再次 submit ACTIVATE')
      },
      confirmActivation: async ({ operation: currentOperation }) => {
        expect(currentOperation.txHash).toBe(`0x${'44'.repeat(32)}`)
        return { status: 'active', blockNumber: '124' }
      },
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      type: 'RUN',
      researchId: research.id,
    })
  })

  it('does not create a second RUN operation when recovery sees an existing RUN key', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()
    await workflowOutboxRepo.claimOperation({
      operationKey: runOperationKey(research.id),
      type: 'RUN',
      researchId: research.id,
      escrowAddress: research.expectedEscrowAddress,
      payloadHash: `run:${research.id}`,
      protectedPayloadDigest: `run:${research.id}`,
      leaseOwner: 'existing-run-worker',
      leaseDurationMs: 30_000,
    })

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('链上已 Active 时不应再次 submit ACTIVATE')
      },
      confirmActivation: async () => ({ status: 'active', blockNumber: '125' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    await expect(workflowOutboxRepo.count()).resolves.toBe(2)
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      leaseOwner: 'existing-run-worker',
      attempts: 1,
    })
  })

  it('broadcasts ACTIVATE, consumes reservation, completes ACTIVATE, and enqueues RUN after Active receipt', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()
    let submittedPayload: unknown = null
    let confirmCalls = 0

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async (input: any) => {
        submittedPayload = input.protectedPayload
        return { txHash: `0x${'12'.repeat(32)}`, chainId: 5042002, blockNumber: null }
      },
      confirmActivation: async () => {
        confirmCalls += 1
        return confirmCalls === 1 ? { status: 'not_active' } : { status: 'active', blockNumber: '123' }
      },
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    expect(submittedPayload).toMatchObject({
      activationAuthorization: {
        escrow: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        researchKey: `0x${'aa'.repeat(32)}`,
      },
      activationSignature: `0x${'11'.repeat(65)}`,
    })

    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
    })
    expect(await workflowOutboxRepo.findByOperationKey(activationOperationKey(research.id))).toMatchObject({
      phase: 'succeeded',
      txHash: `0x${'12'.repeat(32)}`,
    })
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      type: 'RUN',
      researchId: research.id,
    })
  })

  it('keeps activating reservation when ACTIVATE receipt is still pending', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('submitActivation 不应在 reconcile 已经看到 pending 时运行')
      },
      confirmActivation: async () => ({ status: 'pending' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'activation_pending' })

    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'funding',
      activationPhase: 'activating',
      quotaReservationState: 'activating',
    })
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toBeNull()
  })

  it('backs off without leaking protected payload when ACTIVATE broadcast fails before txHash is stored', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:05:00.000Z'))
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error(`rpc failed with signature 0x${'11'.repeat(65)}`)
      },
      confirmActivation: async () => ({ status: 'not_active' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'activation_broadcast_failed' })

    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'funding',
      activationPhase: 'activating',
      quotaReservationState: 'activating',
    })
    const failed = await workflowOutboxRepo.findByOperationKey(activationOperationKey(research.id))
    expect(failed).toMatchObject({
      phase: 'queued',
      leaseOwner: null,
      txHash: null,
      lastError: 'ACTIVATION_BROADCAST_FAILED',
      nextAttemptAt: new Date('2030-01-01T00:06:00.000Z'),
    })
    expect(JSON.stringify(failed)).not.toContain(`0x${'11'.repeat(65)}`)
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toBeNull()
    vi.useRealTimers()
  })

  it('consumes reservation but does not enqueue RUN when cancel was requested before Active receipt', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture({
      cancelRequestedAt: new Date('2030-01-01T00:10:00.000Z'),
    })
    let confirmCalls = 0

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => ({ txHash: `0x${'56'.repeat(32)}`, chainId: 5042002, blockNumber: null }),
      confirmActivation: async () => {
        confirmCalls += 1
        return confirmCalls === 1 ? { status: 'not_active' } : { status: 'active', blockNumber: '124' }
      },
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'cancelled_closing' })

    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'cancelled',
      activationPhase: 'active',
      finalizationState: 'closing',
      quotaReservationState: 'consumed',
    })
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toBeNull()
  })

  it('recovers broadcast-after-crash by reconciling Active without replaying ACTIVATE when txHash was never stored', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('submitActivation 不应在链上已经 Active 时重播')
      },
      confirmActivation: async () => ({ status: 'active', blockNumber: '125', logIndex: 9 }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'running',
      activationPhase: 'active',
      quotaReservationState: 'consumed',
    })
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      type: 'RUN',
      researchId: research.id,
    })
  })

  it('confirms an already-broadcast ACTIVATE by txHash without requiring protected payload again', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()
    const operationWithoutPayload = await workflowOutboxRepo.claimOperation({
      operationKey: 'research:broadcasted-without-protected-payload:ACTIVATE',
      type: 'ACTIVATE',
      researchId: operation.researchId,
      escrowAddress: operation.escrowAddress,
      payloadHash: 'activate',
      protectedPayloadDigest: 'activate',
      leaseOwner: 'activation-worker',
      leaseDurationMs: 30_000,
    })
    await workflowOutboxRepo.recordBroadcast(operationWithoutPayload.operation.id, operationWithoutPayload.operation.fencingToken, {
      txHash: `0x${'78'.repeat(32)}`,
      chainId: 5042002,
      blockNumber: null,
    })
    const broadcasted = await workflowOutboxRepo.findByOperationKey('research:broadcasted-without-protected-payload:ACTIVATE')
    if (!broadcasted) throw new Error('broadcasted operation missing')

    await expect(processActivationOperation(broadcasted, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('submitActivation 不应在已有 txHash 时运行')
      },
      confirmActivation: async () => ({ status: 'active', blockNumber: '127' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    expect(await researchRepo.findById(research.id)).toMatchObject({
      status: 'running',
      activationPhase: 'active',
      quotaReservationState: 'consumed',
    })
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      type: 'RUN',
      researchId: research.id,
    })
  })

  it('does not enqueue a second RUN when activation recovery is retried after RUN already exists', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()
    await workflowOutboxRepo.claimOperation({
      operationKey: runOperationKey(research.id),
      type: 'RUN',
      researchId: research.id,
      escrowAddress: research.expectedEscrowAddress,
      payloadHash: `run:${research.id}`,
      protectedPayloadDigest: `run:${research.id}`,
      leaseOwner: 'existing-run-worker',
      leaseDurationMs: 30_000,
    })
    await expect(workflowOutboxRepo.count()).resolves.toBe(2)

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('submitActivation 不应在链上已经 Active 时重播')
      },
      confirmActivation: async () => ({ status: 'active', blockNumber: '126' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    await expect(workflowOutboxRepo.count()).resolves.toBe(2)
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      leaseOwner: 'existing-run-worker',
      attempts: 1,
    })
  })

  it('marks ACTIVATE complete when retry sees already-running research with existing RUN', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture()
    await researchRepo.completeFundingExpiry({
      id: research.id,
      expected: {
        status: 'funding',
        activationPhase: 'activating',
        finalizationState: 'none',
        quotaReservationState: 'activating',
      },
      next: {
        status: 'running',
        activationPhase: 'active',
        finalizationState: 'open',
        quotaReservationState: 'consumed',
      },
      runOperation: {
        operationKey: runOperationKey(research.id),
        type: 'RUN',
        researchId: research.id,
        escrowAddress: research.expectedEscrowAddress,
        phase: 'queued',
        payloadHash: `run:${research.id}`,
        protectedPayloadDigest: `run:${research.id}`,
        leaseOwner: 'activation-worker',
        leaseDurationMs: 30_000,
      },
      workflowOutboxRepo,
    })

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('research 已 running 时不应再次 submit ACTIVATE')
      },
      confirmActivation: async () => {
        throw new Error('research 已 running 时不应再次查询 ACTIVATE receipt')
      },
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'running_started' })

    await expect(workflowOutboxRepo.count()).resolves.toBe(2)
    await expect(workflowOutboxRepo.findByOperationKey(activationOperationKey(research.id))).resolves.toMatchObject({
      phase: 'succeeded',
      leaseOwner: null,
    })
    expect(await workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).toMatchObject({
      type: 'RUN',
      attempts: 1,
    })
  })

  it('marks ACTIVATE complete when retry sees already-cancelled active research', async () => {
    const { researchRepo, workflowOutboxRepo, research, operation } = await fundedActivatingFixture({
      cancelRequestedAt: new Date('2030-01-01T00:10:00.000Z'),
    })
    await researchRepo.completeFundingExpiry({
      id: research.id,
      expected: {
        status: 'funding',
        activationPhase: 'activating',
        finalizationState: 'none',
        quotaReservationState: 'activating',
      },
      next: {
        status: 'cancelled',
        activationPhase: 'active',
        finalizationState: 'closing',
        quotaReservationState: 'consumed',
      },
      workflowOutboxRepo,
    })

    await expect(processActivationOperation(operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('research 已 cancelled/active 时不应再次 submit ACTIVATE')
      },
      confirmActivation: async () => {
        throw new Error('research 已 cancelled/active 时不应再次查询 ACTIVATE receipt')
      },
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'cancelled_closing' })

    await expect(workflowOutboxRepo.count()).resolves.toBe(1)
    await expect(workflowOutboxRepo.findByOperationKey(activationOperationKey(research.id))).resolves.toMatchObject({
      phase: 'succeeded',
      leaseOwner: null,
    })
    await expect(workflowOutboxRepo.findByOperationKey(runOperationKey(research.id))).resolves.toBeNull()
  })

  it('fails closed and backs off when ACTIVATE protected payload is missing', async () => {
    const { researchRepo, workflowOutboxRepo, operation } = await fundedActivatingFixture()
    const operationWithoutPayload = await workflowOutboxRepo.claimOperation({
      operationKey: 'research:missing-protected-payload:ACTIVATE',
      type: 'ACTIVATE',
      researchId: operation.researchId,
      escrowAddress: operation.escrowAddress,
      payloadHash: 'activate',
      protectedPayloadDigest: 'activate',
      leaseOwner: 'activation-worker',
      leaseDurationMs: 30_000,
    })

    await expect(processActivationOperation(operationWithoutPayload.operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('submitActivation 不应在缺少受保护 payload 时运行')
      },
      confirmActivation: async () => ({ status: 'not_active' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'activation_payload_missing' })

    await expect(workflowOutboxRepo.findByOperationKey('research:missing-protected-payload:ACTIVATE')).resolves.toMatchObject({
      phase: 'queued',
      leaseOwner: null,
      lastError: 'ACTIVATION_PROTECTED_PAYLOAD_MISSING',
    })
  })

  it('fails closed and backs off when ACTIVATE protected payload digest mismatches', async () => {
    const { researchRepo, workflowOutboxRepo, operation } = await fundedActivatingFixture()
    const tamperedPayload = JSON.stringify({
      activationAuthorization: { escrow: '0xffffffffffffffffffffffffffffffffffffffff' },
      activationSignature: `0x${'22'.repeat(65)}`,
    })
    const operationWithTamperedPayload = await workflowOutboxRepo.claimOperation({
      operationKey: 'research:tampered-protected-payload:ACTIVATE',
      type: 'ACTIVATE',
      researchId: operation.researchId,
      escrowAddress: operation.escrowAddress,
      payloadHash: 'activate',
      protectedPayloadDigest: `0x${'00'.repeat(32)}`,
      protectedPayload: tamperedPayload,
      leaseOwner: 'activation-worker',
      leaseDurationMs: 30_000,
    })

    await expect(processActivationOperation(operationWithTamperedPayload.operation, {
      researchRepo,
      workflowOutboxRepo,
      submitActivation: async () => {
        throw new Error('submitActivation 不应在 protected payload digest 不匹配时运行')
      },
      confirmActivation: async () => ({ status: 'not_active' }),
      workerId: 'activation-worker',
    })).resolves.toEqual({ status: 'activation_payload_invalid' })

    await expect(workflowOutboxRepo.findByOperationKey('research:tampered-protected-payload:ACTIVATE')).resolves.toMatchObject({
      phase: 'queued',
      leaseOwner: null,
      lastError: 'ACTIVATION_PROTECTED_PAYLOAD_DIGEST_MISMATCH',
    })
  })
})
