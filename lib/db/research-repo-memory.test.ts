import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryResearchRepo } from './research-repo-memory'
import { MemoryResearchQuotaRepo, MemoryResearchQuotaStore } from './research-quota-repo-memory'
import { MemoryWorkflowOutboxRepo } from './workflow-outbox-repo-memory'

describe('MemoryResearchRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a running research record', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    const repo = new MemoryResearchRepo()

    const research = await repo.create({
      address: '0xabc',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
    })

    expect(research).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      address: '0xabc',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      spentUsdc: '0',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
      reportMd: null,
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: null,
    })
  })

  it('creates escrow funding records with separate lifecycle dimensions', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))
    const repo = new MemoryResearchRepo()

    const funding = await repo.createFunding({
      address: '0xabc',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })

    expect(funding).toMatchObject({
      status: 'funding',
      activationPhase: 'none',
      finalizationState: 'none',
      quotaReservationState: 'reserved',
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      preparedAt: new Date('2026-07-11T00:00:00.000Z'),
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
      startedAt: null,
      completedAt: null,
    })
  })

  it('covers unactivated funding expiry and cancel tuples', async () => {
    const repo = new MemoryResearchRepo()

    const noCloneExpired = await repo.createFunding({
      address: '0xabc',
      topic: 'no clone expired',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })
    await expect(repo.transitionLifecycle(
      noCloneExpired.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { status: 'funding_expired', activationPhase: 'expired', quotaReservationState: 'released' },
    )).resolves.toBe(true)
    expect(await repo.findById(noCloneExpired.id)).toMatchObject({
      status: 'funding_expired',
      activationPhase: 'expired',
      finalizationState: 'none',
      quotaReservationState: 'released',
    })

    const noCloneCancelled = await repo.createFunding({
      address: '0xabc',
      topic: 'no clone cancelled',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })
    await expect(repo.transitionLifecycle(
      noCloneCancelled.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { status: 'cancelled', activationPhase: 'cancelled', quotaReservationState: 'released' },
    )).resolves.toBe(true)
    expect(await repo.findById(noCloneCancelled.id)).toMatchObject({
      status: 'cancelled',
      activationPhase: 'cancelled',
      finalizationState: 'none',
      quotaReservationState: 'released',
    })
  })

  it('covers funded expiry and cancelUnactivated receipt tuples', async () => {
    const repo = new MemoryResearchRepo()
    const funded = await repo.createFunding({
      address: '0xabc',
      topic: 'funded',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })

    await expect(repo.transitionLifecycle(
      funded.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      funded.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { status: 'cancelled', activationPhase: 'cancelled', finalizationState: 'closed', quotaReservationState: 'released' },
    )).resolves.toBe(true)
    expect(await repo.findById(funded.id)).toMatchObject({
      status: 'cancelled',
      activationPhase: 'cancelled',
      finalizationState: 'closed',
      quotaReservationState: 'released',
    })

    const expiredFunded = await repo.createFunding({
      address: '0xabc',
      topic: 'expired funded',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })
    await expect(repo.transitionLifecycle(
      expiredFunded.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      expiredFunded.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { status: 'funding_expired', activationPhase: 'expired', quotaReservationState: 'released' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      expiredFunded.id,
      { status: 'funding_expired', activationPhase: 'expired', finalizationState: 'none', quotaReservationState: 'released' },
      { activationPhase: 'cancelled', finalizationState: 'closed' },
    )).resolves.toBe(true)
    expect(await repo.findById(expiredFunded.id)).toMatchObject({
      status: 'funding_expired',
      activationPhase: 'cancelled',
      finalizationState: 'closed',
      quotaReservationState: 'released',
    })
  })

  it('covers active start and cancel finalization tuples', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T01:00:00.000Z'))
    const repo = new MemoryResearchRepo()
    const research = await repo.createFunding({
      address: '0xabc',
      topic: 'active',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T01:15:00.000Z'),
    })

    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )).resolves.toBe(false)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'funding',
      activationPhase: 'none',
      finalizationState: 'none',
      quotaReservationState: 'reserved',
    })

    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
    )).resolves.toBe(true)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
      startedAt: new Date('2026-07-11T01:00:00.000Z'),
    })

    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      { status: 'cancelled', finalizationState: 'closing' },
    )).resolves.toBe(true)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'cancelled',
      activationPhase: 'active',
      finalizationState: 'closing',
      quotaReservationState: 'consumed',
    })

    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'cancelled', activationPhase: 'active', finalizationState: 'closing', quotaReservationState: 'consumed' },
      { finalizationState: 'closed' },
    )).resolves.toBe(true)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'cancelled',
      activationPhase: 'active',
      finalizationState: 'closed',
      quotaReservationState: 'consumed',
    })
  })

  it('releases an activating reservation when activation cannot become active', async () => {
    const repo = new MemoryResearchRepo()
    const research = await repo.createFunding({
      address: '0xabc',
      topic: 'activating expiry',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })

    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      { status: 'funding_expired', activationPhase: 'expired', quotaReservationState: 'released' },
    )).resolves.toBe(true)

    expect(await repo.findById(research.id)).toMatchObject({
      status: 'funding_expired',
      activationPhase: 'expired',
      finalizationState: 'none',
      quotaReservationState: 'released',
    })
  })

  it('rolls back atomic funding expiry completion when RUN outbox creation fails', async () => {
    const repo = new MemoryResearchRepo()
    const result = await repo.createFundingWithQuotaReservation({
      address: '0xabc',
      topic: 'atomic run rollback',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    }, {
      day: '2026-07-11',
      resetAt: new Date('2026-07-12T00:00:00.000Z'),
      walletLimit: 10,
      globalLimit: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await repo.transitionLifecycle(
      result.research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )
    await repo.transitionLifecycle(
      result.research.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )

    await expect(repo.completeFundingExpiry({
      id: result.research.id,
      expected: { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      next: { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      runOperation: {
        operationKey: `research:${result.research.id}:RUN`,
        type: 'RUN',
        researchId: result.research.id,
        escrowAddress: null,
        payloadHash: 'run',
        protectedPayloadDigest: 'run',
        leaseOwner: 'worker',
        leaseDurationMs: 30_000,
      },
      workflowOutboxRepo: {
        claimOperation: async () => {
          throw new Error('outbox unavailable')
        },
      },
    })).resolves.toBe(false)

    expect(await repo.findById(result.research.id)).toMatchObject({
      status: 'funding',
      activationPhase: 'activating',
      finalizationState: 'none',
      quotaReservationState: 'activating',
    })
  })

  it('requests active cancellation with a durable CLOSE outbox atomically', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T06:00:00.000Z'))
    const repo = new MemoryResearchRepo()
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const research = await repo.createFunding({
      address: '0xabc',
      topic: 'active cancel',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
      escrowAddress: '0x4444444444444444444444444444444444444444',
    })
    await repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )
    await repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )
    await repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
    )

    await expect(repo.requestCancellation({
      id: research.id,
      expected: { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      next: { status: 'cancelled', finalizationState: 'closing' },
      closeOperation: {
        operationKey: `CLOSE:${research.id}`,
        type: 'CLOSE',
        researchId: research.id,
        escrowAddress: '0x4444444444444444444444444444444444444444',
        payloadHash: `cancel:${research.id}`,
        protectedPayloadDigest: `cancel:${research.id}`,
        leaseOwner: 'cancel-api',
        leaseDurationMs: 30_000,
      },
      workflowOutboxRepo,
    })).resolves.toBe(true)

    expect(await repo.findById(research.id)).toMatchObject({
      status: 'cancelled',
      activationPhase: 'active',
      finalizationState: 'closing',
      quotaReservationState: 'consumed',
      cancelRequestedAt: new Date('2026-07-11T06:00:00.000Z'),
      errorMessage: 'Research cancelled',
      completedAt: new Date('2026-07-11T06:00:00.000Z'),
    })
    expect(await workflowOutboxRepo.findByOperationKey(`CLOSE:${research.id}`)).toMatchObject({
      operationKey: `CLOSE:${research.id}`,
      type: 'CLOSE',
      researchId: research.id,
      escrowAddress: '0x4444444444444444444444444444444444444444',
      phase: 'queued',
    })
  })

  it('rolls back active cancellation when CLOSE outbox creation fails', async () => {
    const repo = new MemoryResearchRepo()
    const research = await repo.create({ address: '0xabc', topic: 'cancel rollback', budgetUsdc: '0.01' })

    await expect(repo.requestCancellation({
      id: research.id,
      expected: { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      next: { status: 'cancelled', finalizationState: 'closing' },
      closeOperation: {
        operationKey: `CLOSE:${research.id}`,
        type: 'CLOSE',
        researchId: research.id,
        escrowAddress: null,
        payloadHash: `cancel:${research.id}`,
        protectedPayloadDigest: `cancel:${research.id}`,
        leaseOwner: 'cancel-api',
        leaseDurationMs: 30_000,
      },
      workflowOutboxRepo: {
        claimOperation: async () => {
          throw new Error('outbox unavailable')
        },
      },
    })).resolves.toBe(false)

    expect(await repo.findById(research.id)).toMatchObject({
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
      cancelRequestedAt: null,
      completedAt: null,
    })
  })

  it('exposes quota reservation transitions through the shared memory quota status repo', async () => {
    const quotaStore = new MemoryResearchQuotaStore()
    const repo = new MemoryResearchRepo(quotaStore)
    const quotaRepo = new MemoryResearchQuotaRepo(quotaStore)
    const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
    const resetAt = new Date('2026-07-12T00:00:00.000Z')

    const result = await repo.createFundingWithQuotaReservation({
      address: '0xAbC',
      topic: 'quota status',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    }, {
      day: '2026-07-11',
      resetAt,
      walletLimit: 10,
      globalLimit: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await expect(quotaRepo.status({
      address: '0xabc',
      day: '2026-07-11',
      resetAt: resetAt.toISOString(),
    })).resolves.toEqual({
      wallet: { consumed: 0, reserved: 1, used: 1, resetAt: resetAt.toISOString() },
      global: { consumed: 0, reserved: 1, used: 1, resetAt: resetAt.toISOString() },
    })

    await expect(repo.transitionLifecycle(
      result.research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )).resolves.toBe(true)

    await expect(repo.beginActivation({
      id: result.research.id,
      expected: { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      next: { activationPhase: 'activating', quotaReservationState: 'activating' },
      activateOperation: {
        operationKey: `research:${result.research.id}:ACTIVATE`,
        type: 'ACTIVATE',
        researchId: result.research.id,
        escrowAddress: null,
        payloadHash: 'activate',
        protectedPayloadDigest: 'activate-digest',
        protectedPayload: 'raw-activation',
        leaseOwner: 'start-api',
        leaseDurationMs: 30_000,
      },
      workflowOutboxRepo,
    })).resolves.toBe(true)

    await expect(quotaRepo.status({
      address: '0xabc',
      day: '2026-07-11',
      resetAt: resetAt.toISOString(),
    })).resolves.toEqual({
      wallet: { consumed: 0, reserved: 1, used: 1, resetAt: resetAt.toISOString() },
      global: { consumed: 0, reserved: 1, used: 1, resetAt: resetAt.toISOString() },
    })

    await expect(repo.completeFundingExpiry({
      id: result.research.id,
      expected: { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      next: { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
    })).resolves.toBe(true)

    await expect(quotaRepo.status({
      address: '0xabc',
      day: '2026-07-11',
      resetAt: resetAt.toISOString(),
    })).resolves.toEqual({
      wallet: { consumed: 1, reserved: 0, used: 1, resetAt: resetAt.toISOString() },
      global: { consumed: 1, reserved: 0, used: 1, resetAt: resetAt.toISOString() },
    })
  })

  it('rolls back activation transition when ACTIVATE outbox creation fails', async () => {
    const repo = new MemoryResearchRepo()
    const result = await repo.createFundingWithQuotaReservation({
      address: '0xabc',
      topic: 'atomic activation rollback',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    }, {
      day: '2026-07-11',
      resetAt: new Date('2026-07-12T00:00:00.000Z'),
      walletLimit: 10,
      globalLimit: 100,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    await repo.transitionLifecycle(
      result.research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )

    await expect(repo.beginActivation({
      id: result.research.id,
      expected: { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      next: { activationPhase: 'activating', quotaReservationState: 'activating' },
      activateOperation: {
        operationKey: `research:${result.research.id}:ACTIVATE`,
        type: 'ACTIVATE',
        researchId: result.research.id,
        escrowAddress: null,
        payloadHash: 'activate',
        protectedPayloadDigest: 'activate-digest',
        protectedPayload: 'raw-activation',
        leaseOwner: 'start-api',
        leaseDurationMs: 30_000,
      },
      workflowOutboxRepo: {
        claimOperation: async () => {
          throw new Error('outbox unavailable')
        },
      },
    })).resolves.toBe(false)

    expect(await repo.findById(result.research.id)).toMatchObject({
      status: 'funding',
      activationPhase: 'funded',
      finalizationState: 'none',
      quotaReservationState: 'reserved',
    })
  })

  it('rejects illegal lifecycle back edges without mutating the record', async () => {
    const repo = new MemoryResearchRepo()
    const released = await repo.createFunding({
      address: '0xabc',
      topic: 'released',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })
    await repo.transitionLifecycle(
      released.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { status: 'funding_expired', activationPhase: 'expired', quotaReservationState: 'released' },
    )
    const releasedBefore = await repo.findById(released.id)
    await expect(repo.transitionLifecycle(
      released.id,
      { status: 'funding_expired', activationPhase: 'expired', finalizationState: 'none', quotaReservationState: 'released' },
      { quotaReservationState: 'reserved' },
    )).resolves.toBe(false)
    expect(await repo.findById(released.id)).toEqual(releasedBefore)

    const research = await repo.createFunding({
      address: '0xabc',
      topic: 'illegal',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })

    await repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )
    await repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )
    await repo.transitionLifecycle(
      research.id,
      { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
    )
    await repo.transitionLifecycle(
      research.id,
      { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      { status: 'completed', finalizationState: 'closing' },
    )
    await repo.transitionLifecycle(
      research.id,
      { status: 'completed', activationPhase: 'active', finalizationState: 'closing', quotaReservationState: 'consumed' },
      { finalizationState: 'closed' },
    )

    const before = await repo.findById(research.id)

    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'completed', activationPhase: 'active', finalizationState: 'closed', quotaReservationState: 'consumed' },
      { quotaReservationState: 'none' },
    )).resolves.toBe(false)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'completed', activationPhase: 'active', finalizationState: 'closed', quotaReservationState: 'consumed' },
      { quotaReservationState: 'activating' },
    )).resolves.toBe(false)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'completed', activationPhase: 'active', finalizationState: 'closed', quotaReservationState: 'consumed' },
      { finalizationState: 'closing' },
    )).resolves.toBe(false)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'completed', activationPhase: 'active', finalizationState: 'closed', quotaReservationState: 'consumed' },
      { activationPhase: 'funded' },
    )).resolves.toBe(false)
    await expect(repo.transitionLifecycle(
      research.id,
      { status: 'completed', activationPhase: 'active', finalizationState: 'closed', quotaReservationState: 'consumed' },
      { status: 'running' },
    )).resolves.toBe(false)

    expect(await repo.findById(research.id)).toEqual(before)
  })

  it('updates status, report, and spent amount without floating point drift', async () => {
    const repo = new MemoryResearchRepo()
    const research = await repo.create({ address: '0xabc', topic: 'PEPE', budgetUsdc: '0.01' })

    await repo.appendSpent(research.id, '0.0001')
    await repo.appendSpent(research.id, '0.0002')
    await repo.setReport(research.id, '# Report')
    await repo.updateStatus(research.id, 'completed')

    expect(await repo.findById(research.id)).toMatchObject({
      spentUsdc: '0.0003',
      status: 'completed',
      reportMd: '# Report',
      completedAt: expect.any(Date),
    })
  })

  it('updates status conditionally only when the current status matches', async () => {
    const repo = new MemoryResearchRepo()
    const research = await repo.create({ address: '0xabc', topic: 'PEPE', budgetUsdc: '0.01' })

    await repo.updateStatus(research.id, 'completed')

    await expect(repo.updateStatusIfCurrent(research.id, 'running', 'cancelled', 'Research cancelled')).resolves.toBe(false)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'completed',
      errorMessage: null,
    })

    await expect(repo.updateStatusIfCurrent(research.id, 'completed', 'failed', 'Late failure')).resolves.toBe(true)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'failed',
      errorMessage: 'Late failure',
    })
  })

  it('completes with report only while the research is still running', async () => {
    const repo = new MemoryResearchRepo()
    const research = await repo.create({ address: '0xabc', topic: 'PEPE', budgetUsdc: '0.01' })

    await expect(repo.completeIfRunning(research.id, '# First report')).resolves.toBe(true)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'completed',
      reportMd: '# First report',
      errorMessage: null,
    })

    await expect(repo.completeIfRunning(research.id, '# Late report')).resolves.toBe(false)
    expect(await repo.findById(research.id)).toMatchObject({
      status: 'completed',
      reportMd: '# First report',
    })
  })

  it('lists records by address newest first with a limit', async () => {
    vi.useFakeTimers()
    const repo = new MemoryResearchRepo()

    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    await repo.create({ address: '0xabc', topic: 'first', budgetUsdc: '0.01' })
    vi.setSystemTime(new Date('2026-06-25T00:01:00.000Z'))
    await repo.create({ address: '0xdef', topic: 'other', budgetUsdc: '0.01' })
    vi.setSystemTime(new Date('2026-06-25T00:02:00.000Z'))
    await repo.create({ address: '0xabc', topic: 'second', budgetUsdc: '0.01' })

    const items = await repo.listByAddress('0xabc', 1)

    expect(items).toHaveLength(1)
    expect(items[0].topic).toBe('second')
  })

  it('orders lists by createdAt instead of nullable startedAt', async () => {
    vi.useFakeTimers()
    const repo = new MemoryResearchRepo()

    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))
    const olderCreated = await repo.createFunding({
      address: '0xabc',
      topic: 'older-created-but-started-later',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    })
    await repo.transitionLifecycle(
      olderCreated.id,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )
    await repo.transitionLifecycle(
      olderCreated.id,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )

    vi.setSystemTime(new Date('2026-07-11T00:01:00.000Z'))
    await repo.create({
      address: '0xabc',
      topic: 'newer-created',
      budgetUsdc: '0.01',
    })

    vi.setSystemTime(new Date('2026-07-11T00:02:00.000Z'))
    await repo.transitionLifecycle(
      olderCreated.id,
      { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
    )

    const items = await repo.listByAddress('0xabc', 2)

    expect(items.map((item) => item.topic)).toEqual([
      'newer-created',
      'older-created-but-started-later',
    ])
  })
})
