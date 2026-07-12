import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { isAddress } from 'viem'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockState = vi.hoisted(() => {
  const records: Array<Record<string, any>> = []
  const createFunding = vi.fn(async (input: Record<string, any>) => {
    const now = new Date('2026-07-11T00:00:00.000Z')
    const record = {
      ...input,
      id: input.id,
      spentUsdc: '0',
      status: 'funding',
      activationPhase: 'none',
      finalizationState: 'none',
      quotaReservationState: 'reserved',
      reportMd: null,
      errorMessage: null,
      createdAt: now,
      preparedAt: now,
      fundingExpiresAt: input.fundingExpiresAt,
      startedAt: null,
      completedAt: null,
    }
    records.push(record)
    return record
  })
  const createFundingWithQuotaReservation = vi.fn(async (input: Record<string, any>) => ({
    ok: true,
    research: await createFunding(input),
  }))
  const create = vi.fn()

  return {
    records,
    create,
    createFunding,
    assertDurableDbAvailableForEscrow: vi.fn(),
    reset() {
      records.length = 0
      create.mockReset()
      createFunding.mockClear()
      createFundingWithQuotaReservation.mockClear()
      this.assertDurableDbAvailableForEscrow.mockReset()
    },
    researchRepo: {
      create,
      createFunding,
      createFundingWithQuotaReservation,
      consumeQuotaReservation: vi.fn(),
      releaseQuotaReservation: vi.fn(),
      async findByPrepareRequestId(prepareRequestId: string) {
        return records.find((record) => record.prepareRequestId === prepareRequestId) ?? null
      },
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockState.researchRepo,
  assertDurableDbAvailableForEscrow: mockState.assertDurableDbAvailableForEscrow,
}))

const mutableEnv = process.env as Record<string, string | undefined>
const fundingSignerPrivateKey = '0x59c6995e998f97a5a0044966f094538dc9e86dae88c7a841b20c89c7c9ef31bc'

beforeAll(() => {
  mutableEnv.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  vi.resetModules()
  mockState.reset()
  mutableEnv.NODE_ENV = 'test'
  mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
  mutableEnv.NEXT_PUBLIC_ARC_CHAIN_ID = '5042002'
  mutableEnv.ARC_RESEARCH_FACTORY_ADDRESS = '0x3333333333333333333333333333333333333333'
  mutableEnv.ARC_RESEARCH_ESCROW_IMPLEMENTATION_ADDRESS = '0x1111111111111111111111111111111111111111'
  mutableEnv.ARC_RESEARCH_USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
  mutableEnv.ARC_RESEARCH_INTENT_SIGNER_ADDRESS = '0x5555555555555555555555555555555555555555'
  mutableEnv.ARC_RESEARCH_FUNDING_SIGNER_PRIVATE_KEY = fundingSignerPrivateKey
  mutableEnv.ARC_RESEARCH_WORKER_AUTH_SECRET = 'test-worker-auth-secret-test-worker-auth-secret'
})

async function authedRequest(
  body: unknown,
  options: { address?: string; idempotencyKey?: string } = {},
) {
  const jwt = await signSessionJwt(options.address ?? '0xAbCdEf000000000000000000000000000000C1d3')
  const headers = new Headers({
    cookie: `arc_session=${jwt}`,
    'content-type': 'application/json',
  })
  if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey)

  return new Request('http://localhost/api/research/prepare', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

describe('POST /api/research/prepare', () => {
  it('requires auth before creating funding records', async () => {
    const { POST } = await import('./route')

    const res = await POST(new Request('http://localhost/api/research/prepare', { method: 'POST' }))

    expect(res.status).toBe(401)
    expect(mockState.createFunding).not.toHaveBeenCalled()
  })

  it('requires a stable Idempotency-Key', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'PEPE', budgetUsdc: '0.01' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'IDEMPOTENCY_KEY_REQUIRED' })
    expect(mockState.createFunding).not.toHaveBeenCalled()
  })

  it('creates a funding prepare for the authenticated buyer without starting the agent', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00.000Z'))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(
      { topic: '  SHOULD I BUY PEPE?  ', budgetUsdc: '0.01000000' },
      { idempotencyKey: 'prepare-key-1' },
    ))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      status: 'funding',
      activationPhase: 'none',
      quotaReservationState: 'reserved',
      buyer: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      budgetUnits: '10000',
      chainId: 5042002,
      factory: '0x3333333333333333333333333333333333333333',
      implementation: '0x1111111111111111111111111111111111111111',
      usdc: '0x3600000000000000000000000000000000000000',
      intentSigner: '0x5555555555555555555555555555555555555555',
      fundingSigner: '0x3aED557D932A8EB5B048BaB0a388Da4Ab0A84bC0',
      expectedExpiresAt: '2026-07-12T00:00:00.000Z',
      fundingDeadline: '2026-07-11T00:15:00.000Z',
    })
    expect(body.researchId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.researchKey).toMatch(/^0x[0-9a-f]{64}$/)
    expect(isAddress(body.expectedEscrowAddress)).toBe(true)
    expect(body.fundingVoucher).toMatchObject({
      buyer: body.buyer,
      researchKey: body.researchKey,
      budgetUnits: '10000',
      expectedExpiresAt: '1783814400',
      fundingDeadline: '1783728900',
      intentSigner: body.intentSigner,
    })
    expect(body.fundingVoucher.voucherNonce).toMatch(/^[0-9]+$/)
    expect(body.fundingSignature).toMatch(/^0x[0-9a-f]{130}$/)
    expect(mockState.createFunding).toHaveBeenCalledTimes(1)
    expect(mockState.researchRepo.createFundingWithQuotaReservation).toHaveBeenCalledTimes(1)
    expect(mockState.create).not.toHaveBeenCalled()
    expect(mockState.records[0]).toMatchObject({
      address: body.buyer,
      prepareRequestId: 'prepare-key-1',
      buyer: body.buyer,
      topic: 'SHOULD I BUY PEPE?',
      budgetUnits: '10000',
      researchKey: body.researchKey,
      expectedEscrowAddress: body.expectedEscrowAddress,
      status: 'funding',
      activationPhase: 'none',
      quotaReservationState: 'reserved',
    })
    vi.useRealTimers()
  })

  it('fails closed before reservation when worker auth is not configured', async () => {
    delete mutableEnv.ARC_RESEARCH_WORKER_AUTH_SECRET
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(
      { topic: 'PEPE', budgetUsdc: '0.01' },
      { idempotencyKey: 'missing-worker-auth' },
    ))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'DURABLE_DB_REQUIRED' })
    expect(mockState.researchRepo.createFundingWithQuotaReservation).not.toHaveBeenCalled()
    expect(mockState.createFunding).not.toHaveBeenCalled()
  })

  it('fails closed before reservation when funding signer is not configured', async () => {
    delete mutableEnv.ARC_RESEARCH_FUNDING_SIGNER_PRIVATE_KEY
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(
      { topic: 'PEPE', budgetUsdc: '0.01' },
      { idempotencyKey: 'missing-funding-signer' },
    ))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'ESCROW_CONFIG_REQUIRED' })
    expect(mockState.researchRepo.createFundingWithQuotaReservation).not.toHaveBeenCalled()
    expect(mockState.createFunding).not.toHaveBeenCalled()
  })

  it('returns the same prepare for same buyer/key/topic/budget retry', async () => {
    const { POST } = await import('./route')
    const request = () => authedRequest(
      { topic: 'PEPE', budgetUsdc: '0.01' },
      { idempotencyKey: 'retry-key' },
    )

    const first = await POST(await request())
    const second = await POST(await request())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual(await first.json())
    expect(mockState.createFunding).toHaveBeenCalledTimes(1)
  })

  it('rejects the same Idempotency-Key across buyer, topic, or budget scope', async () => {
    const { POST } = await import('./route')

    expect((await POST(await authedRequest(
      { topic: 'PEPE', budgetUsdc: '0.01' },
      { idempotencyKey: 'scope-key' },
    ))).status).toBe(200)

    const topicConflict = await POST(await authedRequest(
      { topic: 'DOGE', budgetUsdc: '0.01' },
      { idempotencyKey: 'scope-key' },
    ))
    expect(topicConflict.status).toBe(409)
    await expect(topicConflict.json()).resolves.toEqual({ error: 'PREPARE_IDEMPOTENCY_CONFLICT' })

    const budgetConflict = await POST(await authedRequest(
      { topic: 'PEPE', budgetUsdc: '0.02' },
      { idempotencyKey: 'scope-key' },
    ))
    expect(budgetConflict.status).toBe(409)

    const buyerConflict = await POST(await authedRequest(
      { topic: 'PEPE', budgetUsdc: '0.01' },
      {
        idempotencyKey: 'scope-key',
        address: '0x1111111111111111111111111111111111111111',
      },
    ))
    expect(buyerConflict.status).toBe(409)
    expect(mockState.createFunding).toHaveBeenCalledTimes(1)
  })

  it('rejects budgets that cannot be represented as 6-decimal USDC units', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(
      { topic: 'PEPE', budgetUsdc: '0.01000001' },
      { idempotencyKey: 'bad-budget-key' },
    ))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'SCALE8_TRUNCATION' })
    expect(mockState.createFunding).not.toHaveBeenCalled()
  })
})
