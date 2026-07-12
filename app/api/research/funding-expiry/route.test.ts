import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const handleFundingExpiry = vi.fn(async () => ({ status: 'funding_expired' }))
  const assertDurableDbAvailableForEscrow = vi.fn()
  const assertDurableDbAvailable = vi.fn()
  return {
    handleFundingExpiry,
    assertDurableDbAvailableForEscrow,
    assertDurableDbAvailable,
    researchRepo: { kind: 'research-repo' },
    workflowOutboxRepo: { kind: 'workflow-outbox-repo' },
    reset() {
      handleFundingExpiry.mockReset()
      handleFundingExpiry.mockResolvedValue({ status: 'funding_expired' })
      assertDurableDbAvailableForEscrow.mockReset()
      assertDurableDbAvailable.mockReset()
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockState.researchRepo,
  workflowOutboxRepo: mockState.workflowOutboxRepo,
  assertDurableDbAvailableForEscrow: mockState.assertDurableDbAvailableForEscrow,
  assertDurableDbAvailable: mockState.assertDurableDbAvailable,
}))

vi.mock('@/lib/research/funding-expiry', () => ({
  handleFundingExpiry: mockState.handleFundingExpiry,
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

function workerRequest(body: unknown, token = workerSecret) {
  return new Request('http://localhost/api/research/funding-expiry', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/research/funding-expiry', () => {
  it('requires worker bearer auth before touching expiry state', async () => {
    const { POST } = await import('./route')

    const res = await POST(new Request('http://localhost/api/research/funding-expiry', { method: 'POST' }))

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'WORKER_UNAUTHORIZED' })
    expect(mockState.handleFundingExpiry).not.toHaveBeenCalled()
  })

  it('fails closed when worker auth is not configured', async () => {
    delete mutableEnv.ARC_RESEARCH_WORKER_AUTH_SECRET
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ researchId: 'research-1' }))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'DURABLE_DB_REQUIRED' })
    expect(mockState.handleFundingExpiry).not.toHaveBeenCalled()
  })

  it('fails closed without durable DB before processing existing escrow funding expiry during calldata rollback', async () => {
    mutableEnv.NODE_ENV = 'production'
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    delete mutableEnv.DATABASE_URL
    delete mutableEnv.POSTGRES_URL
    mockState.assertDurableDbAvailable.mockImplementationOnce(() => {
      const error = new Error('Durable Postgres is required for research funding expiry') as Error & { code: string }
      error.code = 'DURABLE_DB_REQUIRED'
      throw error
    })
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ researchId: 'research-1' }))

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({ error: 'DURABLE_DB_REQUIRED' })
    expect(mockState.assertDurableDbAvailable).toHaveBeenCalledWith('research funding expiry')
    expect(mockState.handleFundingExpiry).not.toHaveBeenCalled()
  })

  it('rejects invalid body after worker auth', async () => {
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ researchId: '' }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'INVALID_BODY' })
    expect(mockState.handleFundingExpiry).not.toHaveBeenCalled()
  })

  it('allows protected funding-expiry worker to process existing escrow research when new escrow traffic is disabled', async () => {
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ researchId: 'research-1' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'funding_expired' })
    expect(mockState.assertDurableDbAvailable).toHaveBeenCalledWith('research funding expiry')
    expect(mockState.handleFundingExpiry).toHaveBeenCalledWith('research-1', {
      researchRepo: mockState.researchRepo,
      workflowOutboxRepo: mockState.workflowOutboxRepo,
      reconcileActivation: expect.any(Function),
    })
  })

  it('calls funding expiry service with durable repos', async () => {
    mockState.handleFundingExpiry.mockResolvedValueOnce({ status: 'activation_pending' })
    const { POST } = await import('./route')

    const res = await POST(workerRequest({ researchId: 'research-1' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ status: 'activation_pending' })
    expect(mockState.assertDurableDbAvailable).toHaveBeenCalledWith('research funding expiry')
    expect(mockState.handleFundingExpiry).toHaveBeenCalledWith('research-1', {
      researchRepo: mockState.researchRepo,
      workflowOutboxRepo: mockState.workflowOutboxRepo,
      reconcileActivation: expect.any(Function),
    })
  })
})
