import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTypedData } from 'viem'
import { MemoryResearchRepo } from '@/lib/db/research-repo-memory'
import { prepareResearch } from './prepare'

const fundingSignerPrivateKey = '0x59c6995e998f97a5a0044966f094538dc9e86dae88c7a841b20c89c7c9ef31bc' as const
const fundingSignerAddress = '0x3aED557D932A8EB5B048BaB0a388Da4Ab0A84bC0' as const
const config = {
  chainId: 5042002,
  factoryAddress: '0x3333333333333333333333333333333333333333' as const,
  implementationAddress: '0x1111111111111111111111111111111111111111' as const,
  usdcAddress: '0x3600000000000000000000000000000000000000' as const,
  intentSigner: '0x5555555555555555555555555555555555555555' as const,
  fundingSignerPrivateKey,
  fundingSignerAddress,
}

const fundingVoucherTypes = {
  FundingVoucher: [
    { name: 'buyer', type: 'address' },
    { name: 'researchKey', type: 'bytes32' },
    { name: 'budgetUnits', type: 'uint256' },
    { name: 'expectedExpiresAt', type: 'uint64' },
    { name: 'fundingDeadline', type: 'uint64' },
    { name: 'intentSigner', type: 'address' },
    { name: 'voucherNonce', type: 'uint256' },
  ],
} as const

describe('prepareResearch quota reservation UoW', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates funding research and wallet/global quota reservation atomically', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))
    const repo = new MemoryResearchRepo()

    const response = await prepareResearch({
      buyer: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      idempotencyKey: 'quota-uow-key',
      repo,
      config,
    })

    const record = await repo.findById(response.researchId)
    expect(record).toMatchObject({
      status: 'funding',
      quotaReservationState: 'reserved',
      quotaDate: '2026-07-11',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
      fundingDeadline: new Date('2026-07-11T00:15:00.000Z'),
      expectedExpiresAt: new Date('2026-07-12T00:00:00.000Z'),
      budgetUnits: response.budgetUnits,
      researchKey: response.researchKey,
      expectedEscrowAddress: response.expectedEscrowAddress,
      intentSigner: response.intentSigner,
      voucherNonce: response.fundingVoucher.voucherNonce,
    })
    expect(response.fundingVoucher).toMatchObject({
      buyer: response.buyer,
      researchKey: record?.researchKey,
      budgetUnits: record?.budgetUnits,
      expectedExpiresAt: '1783814400',
      fundingDeadline: '1783728900',
      intentSigner: record?.intentSigner,
      voucherNonce: record?.voucherNonce,
    })
    await expect(verifyTypedData({
      address: fundingSignerAddress,
      domain: {
        name: 'ArcLeptonResearchEscrowFactory',
        version: '1',
        chainId: BigInt(config.chainId),
        verifyingContract: config.factoryAddress,
      },
      types: fundingVoucherTypes,
      primaryType: 'FundingVoucher',
      message: {
        buyer: response.fundingVoucher.buyer as `0x${string}`,
        researchKey: response.fundingVoucher.researchKey as `0x${string}`,
        budgetUnits: BigInt(response.fundingVoucher.budgetUnits),
        expectedExpiresAt: BigInt(response.fundingVoucher.expectedExpiresAt),
        fundingDeadline: BigInt(response.fundingVoucher.fundingDeadline),
        intentSigner: response.fundingVoucher.intentSigner as `0x${string}`,
        voucherNonce: BigInt(response.fundingVoucher.voucherNonce),
      },
      signature: response.fundingSignature,
    })).resolves.toBe(true)
  })

  it('does not reserve quota twice for an idempotent retry', async () => {
    const repo = new MemoryResearchRepo()
    const input = {
      buyer: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      idempotencyKey: 'same-key',
      repo,
      config,
    }

    const first = await prepareResearch(input)
    const second = await prepareResearch(input)

    expect(second).toEqual(first)
    await expect(prepareResearch({
      ...input,
      idempotencyKey: 'second-through-tenth-1',
    })).resolves.toMatchObject({ status: 'funding' })
    await Promise.all(Array.from({ length: 8 }, (_, index) => prepareResearch({
      ...input,
      idempotencyKey: `second-through-tenth-${index + 2}`,
    })))
    await expect(prepareResearch({
      ...input,
      idempotencyKey: 'eleventh',
    })).rejects.toThrow(expect.objectContaining({ code: 'WALLET_LIMIT', status: 429 }))
  })

  it('fails closed at the global limit before creating the 101st reservation', async () => {
    const repo = new MemoryResearchRepo()

    await Promise.all(Array.from({ length: 100 }, (_, index) => prepareResearch({
      buyer: `0x${(index + 1).toString(16).padStart(40, '0')}`,
      topic: `topic ${index}`,
      budgetUsdc: '0.01',
      idempotencyKey: `global-${index}`,
      repo,
      config,
    })))

    await expect(prepareResearch({
      buyer: '0x9999999999999999999999999999999999999999',
      topic: 'overflow',
      budgetUsdc: '0.01',
      idempotencyKey: 'global-overflow',
      repo,
      config,
    })).rejects.toThrow(expect.objectContaining({ code: 'GLOBAL_LIMIT', status: 429 }))
  })

  it('settles a reservation exactly once across consume/release races', async () => {
    const repo = new MemoryResearchRepo()
    const response = await prepareResearch({
      buyer: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      idempotencyKey: 'race-key',
      repo,
      config,
    })

    await expect(repo.transitionLifecycle(
      response.researchId,
      { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'funded' },
    )).resolves.toBe(true)
    await expect(repo.transitionLifecycle(
      response.researchId,
      { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      { activationPhase: 'activating', quotaReservationState: 'activating' },
    )).resolves.toBe(true)

    const results = await Promise.all([
      repo.consumeQuotaReservation(response.researchId),
      repo.releaseQuotaReservation(response.researchId),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await repo.consumeQuotaReservation(response.researchId)).toBe(false)
    expect(await repo.releaseQuotaReservation(response.researchId)).toBe(false)
    expect((await repo.findById(response.researchId))?.quotaReservationState).toMatch(/^(consumed|released)$/)
  })
})
