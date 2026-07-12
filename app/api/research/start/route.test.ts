import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const buyerAddress = '0x3aED557D932A8EB5B048BaB0a388Da4Ab0A84bC0'
const buyerAddressLower = buyerAddress.toLowerCase()
const validActivationSignature = '0x644fdc6a1683e4dd17b4ff10869778060bc0518e4bc78d84ab620266742027d92a833b7f8b5b3cee532a04eb61f2d9da2cc774c58baaaad28a2d6e6ba76c369c1b'

const mockState = vi.hoisted(() => {
  let counter = 0
  const records: Array<{ id: string; address: string; topic: string; budgetUsdc: string; status: string }> = []
  const fundingRecords = new Map<string, Record<string, any>>()
  const create = vi.fn(async (input: { address: string; topic: string; budgetUsdc: string }) => {
    counter += 1
    const record = { id: `research-${counter}`, ...input, status: 'running' }
    records.push(record)
    return {
      ...record,
      spentUsdc: '0',
      reportMd: null,
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: null,
    }
  })
  const findById = vi.fn(async (id: string) => fundingRecords.get(id) ?? null)
  const transitionLifecycle = vi.fn(async () => true)
  const beginActivation = vi.fn(async (_input: Record<string, any>) => true)
  const claimOperation = vi.fn(async (input: Record<string, any>) => ({
    status: 'claimed',
    operation: {
      id: 'operation-1',
      ...input,
      fencingToken: 1,
    },
  }))
  const assertDurableDbAvailableForEscrow = vi.fn()

  return {
    records,
    fundingRecords,
    create,
    findById,
    transitionLifecycle,
    beginActivation,
    claimOperation,
    assertDurableDbAvailableForEscrow,
    reset() {
      counter = 0
      records.length = 0
      fundingRecords.clear()
      create.mockClear()
      findById.mockClear()
      transitionLifecycle.mockClear()
      beginActivation.mockClear()
      claimOperation.mockClear()
      assertDurableDbAvailableForEscrow.mockClear()
    },
    researchRepo: {
      create,
      findById,
      transitionLifecycle,
      beginActivation,
    },
    workflowOutboxRepo: {
      claimOperation,
    },
    quota: {
      consumeQuota: vi.fn(),
      getQuotaStatus: vi.fn(),
    },
    isProductionMemoryDbFallback: vi.fn(),
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockState.researchRepo,
  workflowOutboxRepo: mockState.workflowOutboxRepo,
  assertDurableDbAvailableForEscrow: mockState.assertDurableDbAvailableForEscrow,
  isProductionMemoryDbFallback: mockState.isProductionMemoryDbFallback,
}))

vi.mock('@/lib/rate-limit/research-quota', () => ({
  consumeQuota: mockState.quota.consumeQuota,
  getQuotaStatus: mockState.quota.getQuotaStatus,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  vi.useRealTimers()
  mockState.reset()
  vi.clearAllMocks()
  process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
  process.env.NEXT_PUBLIC_ARC_CHAIN_ID = '5042002'
  process.env.ARC_RESEARCH_FACTORY_ADDRESS = '0x3333333333333333333333333333333333333333'
  process.env.ARC_RESEARCH_ESCROW_IMPLEMENTATION_ADDRESS = '0x1111111111111111111111111111111111111111'
  process.env.ARC_RESEARCH_USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
  process.env.ARC_RESEARCH_INTENT_SIGNER_ADDRESS = '0x5555555555555555555555555555555555555555'
  process.env.ARC_RESEARCH_WORKER_AUTH_SECRET = 'test-worker-auth-secret-test-worker-auth-secret'
  mockState.isProductionMemoryDbFallback.mockReturnValue(false)
  mockState.quota.consumeQuota.mockResolvedValue({ ok: true })
  mockState.quota.getQuotaStatus.mockResolvedValue({
    wallet: { used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
    global: { used: 20, limit: 100, remaining: 80, resetAt: '2026-06-26T00:00:00.000Z' },
  })
})

async function authedRequest(body: unknown, address = buyerAddress) {
  const jwt = await signSessionJwt(address)
  return new Request('http://localhost/api/research/start', {
    method: 'POST',
    headers: {
      cookie: `arc_session=${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

function escrowStartBody(overrides: Record<string, any> = {}) {
  return {
    researchId: 'research-funded-1',
    fundingTxHash: `0x${'11'.repeat(32)}`,
    fundingLogIndex: 7,
    activationAuthorization: {
      escrow: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      researchKey: `0x${'aa'.repeat(32)}`,
      buyer: buyerAddress,
      intentSigner: '0x5555555555555555555555555555555555555555',
      initialBudget: '10000',
      expectedExpiresAt: '1893542400',
      activationNonce: '0',
      deadline: '1893456840',
    },
    activationSignature: validActivationSignature,
    ...overrides,
  }
}

function fundedResearchRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'research-funded-1',
    address: buyerAddressLower,
    prepareRequestId: 'prepare-funded-1',
    buyer: buyerAddressLower,
    topic: 'SHOULD I BUY PEPE?',
    budgetUsdc: '0.01',
    budgetUnits: '10000',
    spentUsdc: '0',
    status: 'funding',
    activationPhase: 'funded',
    finalizationState: 'none',
    quotaReservationState: 'reserved',
    researchKey: `0x${'aa'.repeat(32)}`,
    expectedEscrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    reportMd: null,
    errorMessage: null,
    createdAt: new Date('2030-01-01T00:00:00.000Z'),
    preparedAt: new Date('2030-01-01T00:00:00.000Z'),
    fundingExpiresAt: new Date('2030-01-01T00:15:00.000Z'),
    expectedExpiresAt: new Date('2030-01-02T00:00:00.000Z'),
    fundingDeadline: new Date('2030-01-01T00:15:00.000Z'),
    intentSigner: '0x5555555555555555555555555555555555555555',
    voucherNonce: `0x${'bb'.repeat(32)}`,
    quotaDate: '2026-07-11',
    cancelRequestedAt: null,
    chainId: 5042002,
    startedAt: null,
    completedAt: null,
    ...overrides,
  }
}

describe('POST /api/research/start', () => {
  it('requires auth', async () => {
    const { POST } = await import('./route')

    const res = await POST(new Request('http://localhost/api/research/start', { method: 'POST' }))

    expect(res.status).toBe(401)
    expect(mockState.records).toHaveLength(0)
  })

  it('validates body', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: '', budgetUsdc: '0.0001' }))

    expect(res.status).toBe(400)
    expect(mockState.records).toHaveLength(0)
  })

  it('creates a running research record for the stream route to execute', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'SHOULD I BUY PEPE?', budgetUsdc: '0.01' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ researchId: 'research-1', status: 'running' })
    expect(mockState.records[0]).toMatchObject({
      address: buyerAddressLower,
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      status: 'running',
    })
  })

  it('keeps legacy ARC calldata backend as a one-step start when durable DB is available', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    mockState.isProductionMemoryDbFallback.mockReturnValue(false)
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'SHOULD I BUY PEPE?', budgetUsdc: '0.01' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ researchId: 'research-1', status: 'running' })
    expect(mockState.assertDurableDbAvailableForEscrow).not.toHaveBeenCalled()
    expect(mockState.beginActivation).not.toHaveBeenCalled()
    expect(mockState.records[0]).toMatchObject({
      address: buyerAddressLower,
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      status: 'running',
    })
  })

  it('returns a signed research id in production memory DB fallback', async () => {
    mockState.isProductionMemoryDbFallback.mockReturnValue(true)
    process.env.ARC_RECEIPT_MODE = 'mock'
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'SHOULD I BUY PEPE?', budgetUsdc: '0.01' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('running')
    expect(body.researchId).not.toBe('research-1')
    expect(body.researchId).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('rejects legacy calldata start in production memory DB fallback instead of issuing a signed run token', async () => {
    mockState.isProductionMemoryDbFallback.mockReturnValue(true)
    process.env.ARC_RECEIPT_MODE = 'arc'
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'SHOULD I BUY PEPE?', budgetUsdc: '0.01' }))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'DURABLE_DB_REQUIRED' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('returns 429 and does not create research when quota is exceeded', async () => {
    mockState.quota.consumeQuota.mockResolvedValueOnce({ ok: false, reason: 'WALLET_LIMIT' })
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'SHOULD I BUY PEPE?', budgetUsdc: '0.01' }))
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body).toEqual({
      error: 'WALLET_LIMIT',
      quota: {
        wallet: { used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
        global: { used: 20, limit: 100, remaining: 80, resetAt: '2026-06-26T00:00:00.000Z' },
      },
    })
    expect(mockState.records).toHaveLength(0)
  })

  it('rejects legacy one-step start in escrow backend before consuming quota or creating running research', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'SHOULD I BUY PEPE?', budgetUsdc: '0.01' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'ESCROW_START_REQUIRES_FUNDING_RECEIPT' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('starts escrow research from an existing Funded receipt instead of creating a second running research', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord())
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body).toEqual({
      researchId: 'research-funded-1',
      status: 'funding',
      activationPhase: 'activating',
    })
    expect(mockState.assertDurableDbAvailableForEscrow).toHaveBeenCalledWith('research start')
    expect(mockState.findById).toHaveBeenCalledWith('research-funded-1')
    expect(mockState.beginActivation).toHaveBeenCalledWith(expect.objectContaining({
      id: 'research-funded-1',
      expected: { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      next: { activationPhase: 'activating', quotaReservationState: 'activating' },
      workflowOutboxRepo: mockState.workflowOutboxRepo,
      activateOperation: expect.objectContaining({
        operationKey: 'research:research-funded-1:ACTIVATE',
        type: 'ACTIVATE',
        researchId: 'research-funded-1',
        escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        phase: 'queued',
        leaseOwner: 'start-api',
      }),
    }))
    const activateOperation = mockState.beginActivation.mock.calls[0]?.[0]?.activateOperation
    expect(activateOperation).toEqual(expect.objectContaining({
      operationKey: 'research:research-funded-1:ACTIVATE',
      type: 'ACTIVATE',
      researchId: 'research-funded-1',
      escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      phase: 'queued',
      leaseOwner: 'start-api',
    }))
    expect(activateOperation.payloadHash).toMatch(/^0x[0-9a-f]{64}$/)
    expect(activateOperation.protectedPayloadDigest).toMatch(/^0x[0-9a-f]{64}$/)
    expect(JSON.stringify({
      payloadHash: activateOperation.payloadHash,
      protectedPayloadDigest: activateOperation.protectedPayloadDigest,
    })).not.toContain(validActivationSignature)
    expect(activateOperation.protectedPayload).toBeTruthy()
    expect(activateOperation.protectedPayload).toContain(validActivationSignature)
    expect(JSON.parse(activateOperation.protectedPayload)).toMatchObject({
      researchId: 'research-funded-1',
      fundingTxHash: escrowStartBody().fundingTxHash,
      fundingLogIndex: 7,
      activationAuthorization: escrowStartBody().activationAuthorization,
      activationSignature: validActivationSignature,
    })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('rejects escrow start when the SIWE buyer differs from the prepared buyer', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord())
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(
      escrowStartBody(),
      '0x1111111111111111111111111111111111111111',
    ))

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'BUYER_MISMATCH' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('rejects tampered activation budget or expiry before accepting start', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord())
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody({
      activationAuthorization: {
        ...escrowStartBody().activationAuthorization,
        initialBudget: '9999',
      },
    })))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'ACTIVATION_AUTHORIZATION_MISMATCH' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('rejects invalid buyer ActivationAuthorization signature', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord())
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody({
      activationSignature: `0x${'33'.repeat(65)}`,
    })))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'ACTIVATION_SIGNATURE_INVALID' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
    expect(mockState.beginActivation).not.toHaveBeenCalled()
  })

  it('returns existing expired funding research before activation without creating another runner', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord({
      status: 'funding_expired',
      activationPhase: 'expired',
      quotaReservationState: 'released',
    }))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      researchId: 'research-funded-1',
      status: 'funding_expired',
      activationPhase: 'expired',
      finalizationState: 'none',
    })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
    expect(mockState.beginActivation).not.toHaveBeenCalled()
  })

  it('rejects escrow start when stored chainId does not match configured chain', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord({ chainId: 5042003 }))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'FUNDING_EVIDENCE_MISMATCH' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('rejects escrow start when remaining TTL is below 60 minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord({
      expectedExpiresAt: new Date('2030-01-01T00:59:00.000Z'),
    }))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody({
      activationAuthorization: {
        ...escrowStartBody().activationAuthorization,
        expectedExpiresAt: '1893459540',
      },
    })))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'ESCROW_TTL_TOO_SHORT' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('rejects escrow start when activation submission window is below 2 minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:12:30.000Z'))
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord())
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'ACTIVATION_WINDOW_TOO_SHORT' })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('rejects escrow start when ActivationAuthorization deadline exceeds fundingDeadline', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord())
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody({
      activationAuthorization: {
        ...escrowStartBody().activationAuthorization,
        deadline: '1893456901',
      },
    })))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'ACTIVATION_DEADLINE_AFTER_FUNDING_DEADLINE' })
    expect(mockState.beginActivation).not.toHaveBeenCalled()
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('returns existing running activation on retry without consuming quota or creating another research', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord({
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      quotaReservationState: 'consumed',
      startedAt: new Date('2026-07-11T00:10:00.000Z'),
    }))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      researchId: 'research-funded-1',
      status: 'running',
      activationPhase: 'active',
    })
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
    expect(mockState.beginActivation).not.toHaveBeenCalled()
  })

  it('returns existing running finalization state on retry without starting a second runner', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord({
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'closing',
      quotaReservationState: 'consumed',
      startedAt: new Date('2026-07-11T00:10:00.000Z'),
    }))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      researchId: 'research-funded-1',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'closing',
    })
    expect(mockState.beginActivation).not.toHaveBeenCalled()
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it.each([
    ['completed', { status: 'completed', activationPhase: 'active', finalizationState: 'closing', quotaReservationState: 'consumed' }],
    ['failed', { status: 'failed', activationPhase: 'active', finalizationState: 'closing', quotaReservationState: 'consumed' }],
    ['cancelled', { status: 'cancelled', activationPhase: 'active', finalizationState: 'closing', quotaReservationState: 'consumed' }],
    ['funding_expired', { status: 'funding_expired', activationPhase: 'expired', finalizationState: 'none', quotaReservationState: 'released' }],
    ['closed', { status: 'completed', activationPhase: 'active', finalizationState: 'closed', quotaReservationState: 'consumed' }],
    ['manual', { status: 'failed', activationPhase: 'active', finalizationState: 'manual', quotaReservationState: 'consumed' }],
  ])('returns existing %s escrow state on retry without creating another runner', async (_caseName, overrides) => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord(overrides))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      researchId: 'research-funded-1',
      status: overrides.status,
      activationPhase: overrides.activationPhase,
      finalizationState: overrides.finalizationState,
    })
    expect(mockState.beginActivation).not.toHaveBeenCalled()
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('returns existing activating state on retry without creating a second ACTIVATE operation', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord({
      activationPhase: 'activating',
      quotaReservationState: 'activating',
    }))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({
      researchId: 'research-funded-1',
      status: 'funding',
      activationPhase: 'activating',
    })
    expect(mockState.beginActivation).not.toHaveBeenCalled()
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })

  it('does not enqueue ACTIVATE when reserved to activating transition loses the race', async () => {
    process.env.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    mockState.beginActivation.mockResolvedValueOnce(false)
    mockState.fundingRecords.set('research-funded-1', fundedResearchRecord())
    const { POST } = await import('./route')

    const res = await POST(await authedRequest(escrowStartBody()))

    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'START_RACE_LOST' })
    expect(mockState.beginActivation).toHaveBeenCalledOnce()
    expect(mockState.quota.consumeQuota).not.toHaveBeenCalled()
    expect(mockState.create).not.toHaveBeenCalled()
  })
})
