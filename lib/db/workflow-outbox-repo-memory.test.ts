import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryWorkflowOutboxRepo } from './workflow-outbox-repo-memory'
import type { WorkflowOperationClaimInput, WorkflowOperationType } from './workflow-outbox-repo'

const operationTypes: WorkflowOperationType[] = ['ACTIVATE', 'RUN', 'SETTLE', 'RECONCILE', 'CLOSE']

describe('MemoryWorkflowOutboxRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('claims each supported operation type with a unique operationKey and protected payload digest', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T03:00:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()

    for (const type of operationTypes) {
      const claim = await repo.claimOperation(operationInput({
        type,
        operationKey: `${type}:research-1`,
        leaseOwner: `worker-${type.toLowerCase()}`,
      }))

      expect(claim).toMatchObject({
        status: 'claimed',
        operation: {
          operationKey: `${type}:research-1`,
          type,
          researchId: 'research-1',
          escrowAddress: '0x4444444444444444444444444444444444444444',
          phase: 'queued',
          payloadHash: hex32('aa'),
          protectedPayloadDigest: hex32('bb'),
          leaseOwner: `worker-${type.toLowerCase()}`,
          leaseExpiresAt: new Date('2026-07-11T03:00:30.000Z'),
          fencingToken: 1,
          attempts: 1,
          nextAttemptAt: new Date('2026-07-11T03:00:00.000Z'),
          txHash: null,
          chainId: null,
          blockNumber: null,
          blockHash: null,
          logIndex: null,
          lastError: null,
        },
      })
      expect(JSON.stringify(claim.operation)).not.toContain('rawAuthorization')
    }

    await expect(repo.count()).resolves.toBe(operationTypes.length)
  })

  it('stores protected payload behind an explicit accessor without exposing it on operations', async () => {
    const repo = new MemoryWorkflowOutboxRepo()
    const protectedPayload = JSON.stringify({
      rawAuthorization: { activationNonce: '1' },
      activationSignature: `0x${'11'.repeat(65)}`,
    })

    const claim = await repo.claimOperation(operationInput({
      operationKey: 'ACTIVATE:research-1',
      type: 'ACTIVATE',
      protectedPayload,
    }))
    const found = await repo.findByOperationKey('ACTIVATE:research-1')

    expect(JSON.stringify(claim.operation)).not.toContain('activationSignature')
    expect(JSON.stringify(found)).not.toContain('activationSignature')
    await expect(repo.getProtectedPayload('ACTIVATE:research-1')).resolves.toBe(protectedPayload)
    await expect(repo.getProtectedPayload('ACTIVATE:missing')).resolves.toBeNull()
  })

  it('keeps one logical operation per key and uses lease fencing to reject stale workers', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T03:00:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()

    const first = await repo.claimOperation(operationInput({ leaseOwner: 'worker-a' }))
    const duplicate = await repo.claimOperation(operationInput({ leaseOwner: 'worker-b' }))

    expect(duplicate).toMatchObject({
      status: 'existing',
      operation: {
        id: first.operation.id,
        leaseOwner: 'worker-a',
        fencingToken: 1,
        attempts: 1,
      },
    })
    await expect(repo.count()).resolves.toBe(1)

    vi.setSystemTime(new Date('2026-07-11T03:00:15.000Z'))
    await expect(repo.renewLease(first.operation.id, first.operation.fencingToken, {
      leaseOwner: 'worker-a',
      leaseDurationMs: 30_000,
    })).resolves.toMatchObject({
      leaseOwner: 'worker-a',
      leaseExpiresAt: new Date('2026-07-11T03:00:45.000Z'),
      fencingToken: 1,
      attempts: 1,
    })
    await expect(repo.renewLease(first.operation.id, first.operation.fencingToken, {
      leaseOwner: 'worker-spoof',
      leaseDurationMs: 30_000,
    })).resolves.toBeNull()

    vi.setSystemTime(new Date('2026-07-11T03:00:31.000Z'))
    await expect(repo.claimOperation(operationInput({ leaseOwner: 'worker-b' }))).resolves.toMatchObject({
      status: 'existing',
      operation: {
        leaseOwner: 'worker-a',
        fencingToken: 1,
        attempts: 1,
      },
    })

    vi.setSystemTime(new Date('2026-07-11T03:00:46.000Z'))
    await expect(repo.recordCheckpoint(first.operation.id, 1, {
      phase: 'running',
      payloadHash: hex32('dd'),
    })).resolves.toBe(false)

    const reclaimed = await repo.claimOperation(operationInput({ leaseOwner: 'worker-b' }))
    expect(reclaimed).toMatchObject({
      status: 'claimed',
      operation: {
        id: first.operation.id,
        leaseOwner: 'worker-b',
        fencingToken: 2,
        attempts: 2,
        leaseExpiresAt: new Date('2026-07-11T03:01:16.000Z'),
      },
    })

    await expect(repo.renewLease(first.operation.id, 1, {
      leaseOwner: 'worker-a',
      leaseDurationMs: 30_000,
    })).resolves.toBeNull()
    await expect(repo.recordCheckpoint(first.operation.id, 1, {
      phase: 'running',
      payloadHash: hex32('cc'),
    })).resolves.toBe(false)
    await expect(repo.recordBroadcast(first.operation.id, 1, {
      txHash: `0x${'12'.repeat(32)}`,
      chainId: 5_042_002,
      blockNumber: '12345',
    })).resolves.toBe(false)
    await expect(repo.failAndRelease(first.operation.id, 1, {
      lastError: 'stale worker',
      nextAttemptAt: new Date('2026-07-11T03:10:00.000Z'),
    })).resolves.toBe(false)
    await expect(repo.complete(first.operation.id, 1)).resolves.toBe(false)
    await expect(repo.recordCheckpoint(first.operation.id, 2, {
      phase: 'running',
      payloadHash: hex32('cc'),
    })).resolves.toBe(true)
    await expect(repo.findByOperationKey('RUN:research-1')).resolves.toMatchObject({
      phase: 'running',
      payloadHash: hex32('cc'),
      fencingToken: 2,
    })
  })

  it('records broadcast/log locator, releases failed attempts with backoff, and does not reclaim terminal operations', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T03:10:00.000Z'))
    const repo = new MemoryWorkflowOutboxRepo()
    const claim = await repo.claimOperation(operationInput({ type: 'SETTLE', operationKey: 'SETTLE:research-1' }))

    await expect(repo.recordBroadcast(claim.operation.id, claim.operation.fencingToken, {
      phase: 'broadcasting',
      txHash: `0x${'12'.repeat(32)}`,
      chainId: 5_042_002,
      blockNumber: '12345',
      blockHash: `0x${'34'.repeat(32)}`,
      logIndex: 7,
    })).resolves.toBe(true)

    await expect(repo.failAndRelease(claim.operation.id, claim.operation.fencingToken, {
      phase: 'queued',
      lastError: 'RPC timeout: redacted',
      nextAttemptAt: new Date('2026-07-11T03:15:00.000Z'),
    })).resolves.toBe(true)
    await expect(repo.findByOperationKey('SETTLE:research-1')).resolves.toMatchObject({
      phase: 'queued',
      leaseOwner: null,
      leaseExpiresAt: null,
      txHash: `0x${'12'.repeat(32)}`,
      chainId: 5_042_002,
      blockNumber: '12345',
      blockHash: `0x${'34'.repeat(32)}`,
      logIndex: 7,
      attempts: 1,
      lastError: 'RPC timeout: redacted',
      nextAttemptAt: new Date('2026-07-11T03:15:00.000Z'),
    })

    await expect(repo.listDueOperations({ now: new Date('2026-07-11T03:14:59.000Z') })).resolves.toHaveLength(0)
    await expect(repo.listDueOperations({ now: new Date('2026-07-11T03:15:00.000Z') })).resolves.toHaveLength(1)

    vi.setSystemTime(new Date('2026-07-11T03:15:00.000Z'))
    const retry = await repo.claimOperation(operationInput({ type: 'SETTLE', operationKey: 'SETTLE:research-1', leaseOwner: 'worker-retry' }))
    await expect(repo.complete(retry.operation.id, retry.operation.fencingToken, {
      phase: 'succeeded',
      blockNumber: '12346',
      logIndex: 8,
    })).resolves.toBe(true)
    await expect(repo.claimOperation(operationInput({ type: 'SETTLE', operationKey: 'SETTLE:research-1', leaseOwner: 'worker-late' }))).resolves.toMatchObject({
      status: 'existing',
      operation: {
        phase: 'succeeded',
        leaseOwner: null,
      },
    })
  })
})

function operationInput(overrides: Partial<WorkflowOperationClaimInput> = {}): WorkflowOperationClaimInput {
  return {
    operationKey: 'RUN:research-1',
    type: 'RUN' as const,
    researchId: 'research-1',
    escrowAddress: '0x4444444444444444444444444444444444444444',
    phase: 'queued',
    payloadHash: hex32('aa'),
    protectedPayloadDigest: hex32('bb'),
    leaseOwner: 'worker-a',
    leaseDurationMs: 30_000,
    nextAttemptAt: new Date('2026-07-11T03:00:00.000Z'),
    ...overrides,
  }
}

function hex32(byte: string) {
  return `0x${byte.repeat(32)}`
}
