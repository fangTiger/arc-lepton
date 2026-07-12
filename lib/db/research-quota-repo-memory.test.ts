import { describe, expect, it } from 'vitest'
import { MemoryResearchQuotaRepo, MemoryResearchQuotaStore } from './research-quota-repo-memory'
import { MemoryResearchRepo } from './research-repo-memory'

describe('MemoryResearchQuotaRepo', () => {
  it('returns consumed/reserved/used quota status after consume and release', async () => {
    const repo = new MemoryResearchQuotaRepo()
    const input = {
      address: '0xAbCdEf000000000000000000000000000000C1d3',
      day: '2026-07-11',
      resetAt: '2026-07-12T00:00:00.000Z',
    }

    await expect(repo.status(input)).resolves.toEqual({
      wallet: { consumed: 0, reserved: 0, used: 0, resetAt: input.resetAt },
      global: { consumed: 0, reserved: 0, used: 0, resetAt: input.resetAt },
    })

    await repo.consume(input)
    await expect(repo.status(input)).resolves.toEqual({
      wallet: { consumed: 1, reserved: 0, used: 1, resetAt: input.resetAt },
      global: { consumed: 1, reserved: 0, used: 1, resetAt: input.resetAt },
    })

    await repo.release(input)
    await expect(repo.status(input)).resolves.toEqual({
      wallet: { consumed: 0, reserved: 0, used: 0, resetAt: input.resetAt },
      global: { consumed: 0, reserved: 0, used: 0, resetAt: input.resetAt },
    })
  })

  it('shares reservation state with MemoryResearchRepo lifecycle transitions', async () => {
    const quotaStore = new MemoryResearchQuotaStore()
    const quotaRepo = new MemoryResearchQuotaRepo(quotaStore)
    const researchRepo = new MemoryResearchRepo(quotaStore)
    const quotaInput = {
      address: '0xAbCdEf000000000000000000000000000000C1d3',
      day: '2026-07-11',
      resetAt: '2026-07-12T00:00:00.000Z',
    }
    const quota = {
      day: quotaInput.day,
      resetAt: new Date(quotaInput.resetAt),
      walletLimit: 10,
      globalLimit: 100,
    }

    const consumedReservation = await researchRepo.createFundingWithQuotaReservation({
      address: quotaInput.address,
      topic: 'consume path',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    }, quota)
    expect(consumedReservation.ok).toBe(true)
    if (!consumedReservation.ok) return

    await expect(quotaRepo.status(quotaInput)).resolves.toEqual({
      wallet: { consumed: 0, reserved: 1, used: 1, resetAt: quotaInput.resetAt },
      global: { consumed: 0, reserved: 1, used: 1, resetAt: quotaInput.resetAt },
    })

    await researchRepo.transitionLifecycle(
      consumedReservation.research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )
    await expect(researchRepo.beginActivation({
      id: consumedReservation.research.id,
      expected: { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      next: { activationPhase: 'activating', quotaReservationState: 'activating' },
      activateOperation: {
        operationKey: `research:${consumedReservation.research.id}:ACTIVATE`,
        type: 'ACTIVATE',
        researchId: consumedReservation.research.id,
        escrowAddress: null,
        payloadHash: 'activate',
        protectedPayloadDigest: 'activate-digest',
        leaseOwner: 'start-api',
        leaseDurationMs: 30_000,
      },
      workflowOutboxRepo: { claimOperation: async (operation) => ({ status: 'claimed', operation: workflowOperation(operation) }) },
    })).resolves.toBe(true)
    await expect(quotaRepo.status(quotaInput)).resolves.toEqual({
      wallet: { consumed: 0, reserved: 1, used: 1, resetAt: quotaInput.resetAt },
      global: { consumed: 0, reserved: 1, used: 1, resetAt: quotaInput.resetAt },
    })

    await expect(researchRepo.completeFundingExpiry({
      id: consumedReservation.research.id,
      expected: { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      next: { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
    })).resolves.toBe(true)
    await expect(quotaRepo.status(quotaInput)).resolves.toEqual({
      wallet: { consumed: 1, reserved: 0, used: 1, resetAt: quotaInput.resetAt },
      global: { consumed: 1, reserved: 0, used: 1, resetAt: quotaInput.resetAt },
    })

    const releasedStore = new MemoryResearchQuotaStore()
    const releasedQuotaRepo = new MemoryResearchQuotaRepo(releasedStore)
    const releasedResearchRepo = new MemoryResearchRepo(releasedStore)
    const releasedReservation = await releasedResearchRepo.createFundingWithQuotaReservation({
      address: quotaInput.address,
      topic: 'release path',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    }, quota)
    expect(releasedReservation.ok).toBe(true)
    if (!releasedReservation.ok) return

    await expect(releasedResearchRepo.releaseQuotaReservation(releasedReservation.research.id)).resolves.toBe(true)
    await expect(releasedQuotaRepo.status(quotaInput)).resolves.toEqual({
      wallet: { consumed: 0, reserved: 0, used: 0, resetAt: quotaInput.resetAt },
      global: { consumed: 0, reserved: 0, used: 0, resetAt: quotaInput.resetAt },
    })
  })
})

function workflowOperation(input: {
  operationKey: string
  type: 'ACTIVATE' | 'RUN' | 'SETTLE' | 'RECONCILE' | 'CLOSE'
  researchId: string
  escrowAddress?: string | null
  payloadHash: string
  protectedPayloadDigest: string
  leaseOwner: string
  leaseDurationMs: number
}) {
  const now = new Date('2026-07-11T00:00:00.000Z')
  return {
    id: input.operationKey,
    operationKey: input.operationKey,
    type: input.type,
    researchId: input.researchId,
    escrowAddress: input.escrowAddress ?? null,
    phase: 'queued' as const,
    payloadHash: input.payloadHash,
    protectedPayloadDigest: input.protectedPayloadDigest,
    leaseOwner: input.leaseOwner,
    leaseExpiresAt: new Date(now.getTime() + input.leaseDurationMs),
    fencingToken: 1,
    attempts: 1,
    nextAttemptAt: now,
    txHash: null,
    chainId: null,
    blockNumber: null,
    blockHash: null,
    logIndex: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  }
}
