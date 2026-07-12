import { describe, expect, it } from 'vitest'
import { MemoryResearchRepo } from '@/lib/db/research-repo-memory'
import { MemoryWorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo-memory'
import { prepareResearch } from './prepare'
import {
  activationOperationKey,
  handleFundingExpiry,
  runOperationKey,
} from './funding-expiry'

const config = {
  chainId: 5042002,
  factoryAddress: '0x3333333333333333333333333333333333333333' as const,
  implementationAddress: '0x1111111111111111111111111111111111111111' as const,
  usdcAddress: '0x3600000000000000000000000000000000000000' as const,
  intentSigner: '0x5555555555555555555555555555555555555555' as const,
  fundingSignerPrivateKey: '0x59c6995e998f97a5a0044966f094538dc9e86dae88c7a841b20c89c7c9ef31bc' as const,
  fundingSignerAddress: '0x3aED557D932A8EB5B048BaB0a388Da4Ab0A84bC0' as const,
}

async function preparedFunding(options: { idempotencyKey?: string } = {}) {
  const repo = new MemoryResearchRepo()
  const outbox = new MemoryWorkflowOutboxRepo()
  const response = await prepareResearch({
    buyer: '0xabcdef000000000000000000000000000000c1d3',
    topic: 'PEPE',
    budgetUsdc: '0.01',
    idempotencyKey: options.idempotencyKey ?? 'funding-expiry',
    repo,
    now: new Date('2026-07-11T00:00:00.000Z'),
    config,
  })
  return { repo, outbox, response }
}

async function preparedCancelledFunding() {
  const repo = new MemoryResearchRepo()
  const outbox = new MemoryWorkflowOutboxRepo()
  const result = await repo.createFundingWithQuotaReservation({
    address: '0xabcdef000000000000000000000000000000c1d3',
    prepareRequestId: 'cancel-active',
    buyer: '0xabcdef000000000000000000000000000000c1d3',
    topic: 'PEPE',
    budgetUsdc: '0.01',
    budgetUnits: '10000',
    researchKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    expectedEscrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    expectedExpiresAt: new Date('2026-07-12T00:00:00.000Z'),
    fundingDeadline: new Date('2026-07-11T00:15:00.000Z'),
    intentSigner: config.intentSigner,
    voucherNonce: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    quotaDate: '2026-07-11',
    cancelRequestedAt: new Date('2026-07-11T00:05:00.000Z'),
    chainId: config.chainId,
  }, {
    day: '2026-07-11',
    resetAt: new Date('2026-07-12T00:00:00.000Z'),
    walletLimit: 10,
    globalLimit: 100,
  })
  if (!result.ok) throw new Error(`unexpected quota failure: ${result.reason}`)
  return {
    repo,
    outbox,
    response: {
      researchId: result.research.id,
      expectedEscrowAddress: result.research.expectedEscrowAddress!,
    },
  }
}

async function markActivating(repo: MemoryResearchRepo, researchId: string) {
  await expect(repo.transitionLifecycle(
    researchId,
    { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
    { activationPhase: 'funded' },
  )).resolves.toBe(true)
  await expect(repo.transitionLifecycle(
    researchId,
    { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
    { activationPhase: 'activating', quotaReservationState: 'activating' },
  )).resolves.toBe(true)
}

describe('handleFundingExpiry', () => {
  it('does not release before fundingDeadline', async () => {
    const { repo, outbox, response } = await preparedFunding()

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:14:59.000Z'),
      reconcileActivation: async () => ({ status: 'not_active' }),
    })).resolves.toEqual({ status: 'not_due' })
    expect((await repo.findById(response.researchId))?.quotaReservationState).toBe('reserved')
  })

  it('keeps reservation when ACTIVATE is pending across fundingDeadline', async () => {
    const { repo, outbox, response } = await preparedFunding({ idempotencyKey: 'pending' })
    await markActivating(repo, response.researchId)
    const claim = await outbox.claimOperation({
      operationKey: activationOperationKey(response.researchId),
      type: 'ACTIVATE',
      researchId: response.researchId,
      escrowAddress: response.expectedEscrowAddress,
      payloadHash: 'activate',
      protectedPayloadDigest: 'activate',
      leaseOwner: 'worker',
      leaseDurationMs: 30_000,
    })
    await outbox.recordBroadcast(claim.operation.id, claim.operation.fencingToken, {
      txHash: '0xactivate',
      chainId: 5042002,
      blockNumber: null,
    })

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:16:00.000Z'),
      reconcileActivation: async () => ({ status: 'pending' }),
    })).resolves.toEqual({ status: 'activation_pending' })

    expect((await repo.findById(response.researchId))?.quotaReservationState).toBe('activating')
  })

  it('consumes reservation and enqueues RUN when late ACTIVATE is Active', async () => {
    const { repo, outbox, response } = await preparedFunding({ idempotencyKey: 'active-run' })
    await markActivating(repo, response.researchId)

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:16:00.000Z'),
      reconcileActivation: async () => ({ status: 'active' }),
    })).resolves.toEqual({ status: 'running_started' })

    expect(await repo.findById(response.researchId)).toMatchObject({
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
    })
    expect(await outbox.findByOperationKey(runOperationKey(response.researchId))).toMatchObject({
      type: 'RUN',
      researchId: response.researchId,
    })
  })

  it('rolls back consume and lifecycle when RUN outbox cannot be created', async () => {
    const { repo, outbox, response } = await preparedFunding({ idempotencyKey: 'run-outbox-fails' })
    await markActivating(repo, response.researchId)
    const failingOutbox = Object.create(outbox) as MemoryWorkflowOutboxRepo
    failingOutbox.claimOperation = async (input) => {
      if (input.type === 'RUN') throw new Error('RUN outbox unavailable')
      return outbox.claimOperation(input)
    }

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: failingOutbox,
      now: new Date('2026-07-11T00:16:00.000Z'),
      reconcileActivation: async () => ({ status: 'active' }),
    })).resolves.toEqual({ status: 'race_lost' })

    expect(await repo.findById(response.researchId)).toMatchObject({
      status: 'funding',
      activationPhase: 'activating',
      finalizationState: 'none',
      quotaReservationState: 'activating',
    })
    expect(await outbox.findByOperationKey(runOperationKey(response.researchId))).toBeNull()
  })

  it('does not consume reserved quota when Active is observed before DB enters activating', async () => {
    const { repo, outbox, response } = await preparedFunding({ idempotencyKey: 'active-before-activating' })

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:16:00.000Z'),
      reconcileActivation: async () => ({ status: 'active' }),
    })).resolves.toEqual({ status: 'race_lost' })

    expect(await repo.findById(response.researchId)).toMatchObject({
      status: 'funding',
      activationPhase: 'none',
      quotaReservationState: 'reserved',
    })
    expect(await outbox.findByOperationKey(runOperationKey(response.researchId))).toBeNull()
  })

  it('consumes reservation and closes cancellation when late ACTIVATE is Active after cancel request', async () => {
    const { repo, outbox, response } = await preparedCancelledFunding()
    await markActivating(repo, response.researchId)

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:16:00.000Z'),
      reconcileActivation: async () => ({ status: 'active' }),
    })).resolves.toEqual({ status: 'cancelled_closing' })

    expect(await repo.findById(response.researchId)).toMatchObject({
      status: 'cancelled',
      activationPhase: 'active',
      finalizationState: 'closing',
      quotaReservationState: 'consumed',
      cancelRequestedAt: new Date('2026-07-11T00:05:00.000Z'),
    })
    expect(await outbox.findByOperationKey(runOperationKey(response.researchId))).toBeNull()
  })

  it('releases reservation exactly once when reconcile proves not active', async () => {
    const { repo, outbox, response } = await preparedFunding({ idempotencyKey: 'not-active' })

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:16:00.000Z'),
      reconcileActivation: async () => ({ status: 'not_active' }),
    })).resolves.toEqual({ status: 'funding_expired' })
    expect(await repo.findById(response.researchId)).toMatchObject({
      status: 'funding_expired',
      activationPhase: 'expired',
      quotaReservationState: 'released',
    })

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:17:00.000Z'),
      reconcileActivation: async () => ({ status: 'not_active' }),
    })).resolves.toEqual({ status: 'ignored', reason: 'NOT_FUNDING' })
  })

  it('does not release reservation when funding_expired lifecycle transition is invalid', async () => {
    const { repo, outbox, response } = await preparedFunding({ idempotencyKey: 'invalid-expiry-transition' })
    await markActivating(repo, response.researchId)
    await expect(repo.transitionLifecycle(
      response.researchId,
      { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      { activationPhase: 'active' },
    )).resolves.toBe(true)

    await expect(handleFundingExpiry(response.researchId, {
      researchRepo: repo,
      workflowOutboxRepo: outbox,
      now: new Date('2026-07-11T00:16:00.000Z'),
      reconcileActivation: async () => ({ status: 'not_active' }),
    })).resolves.toEqual({ status: 'race_lost' })

    expect(await repo.findById(response.researchId)).toMatchObject({
      status: 'funding',
      activationPhase: 'active',
      finalizationState: 'none',
      quotaReservationState: 'activating',
    })
  })
})
