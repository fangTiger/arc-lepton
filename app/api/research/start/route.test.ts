import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockState = vi.hoisted(() => {
  let counter = 0
  const records: Array<{ id: string; address: string; topic: string; budgetUsdc: string; status: string }> = []

  return {
    records,
    reset() {
      counter = 0
      records.length = 0
    },
    researchRepo: {
      async create(input: { address: string; topic: string; budgetUsdc: string }) {
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
      },
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
  mockState.reset()
  vi.clearAllMocks()
  mockState.isProductionMemoryDbFallback.mockReturnValue(false)
  mockState.quota.consumeQuota.mockResolvedValue({ ok: true })
  mockState.quota.getQuotaStatus.mockResolvedValue({
    wallet: { used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
    global: { used: 20, limit: 100, remaining: 80, resetAt: '2026-06-26T00:00:00.000Z' },
  })
})

async function authedRequest(body: unknown) {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request('http://localhost/api/research/start', {
    method: 'POST',
    headers: {
      cookie: `arc_session=${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
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
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      status: 'running',
    })
  })

  it('returns a signed research id in production memory DB fallback', async () => {
    mockState.isProductionMemoryDbFallback.mockReturnValue(true)
    const { POST } = await import('./route')

    const res = await POST(await authedRequest({ topic: 'SHOULD I BUY PEPE?', budgetUsdc: '0.01' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('running')
    expect(body.researchId).not.toBe('research-1')
    expect(body.researchId).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
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
})
