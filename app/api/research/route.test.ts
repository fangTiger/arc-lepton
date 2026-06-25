import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  const records = [
    {
      id: 'research-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'PEPE 现在能进吗',
      budgetUsdc: '0.01',
      spentUsdc: '0.0012',
      status: 'completed',
      reportMd: '# Report',
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: new Date('2026-06-25T00:00:18.000Z'),
    },
    {
      id: 'research-2',
      address: '0xother',
      topic: 'Other',
      budgetUsdc: '0.01',
      spentUsdc: '0',
      status: 'running',
      reportMd: null,
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:01:00.000Z'),
      completedAt: null,
    },
  ]

  return {
    reset() {},
    researchRepo: {
      async listByAddress(address: string, limit = 50) {
        return records.filter((record) => record.address === address).slice(0, limit)
      },
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockStore.researchRepo,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  mockStore.reset()
})

async function authedRequest(path = '/api/research') {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('GET /api/research', () => {
  it('requires auth', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request('http://localhost/api/research'))

    expect(res.status).toBe(401)
  })

  it('lists current user research records', async () => {
    const { GET } = await import('./route')

    const res = await GET(await authedRequest('/api/research?limit=20'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.researches).toEqual([
      expect.objectContaining({
        id: 'research-1',
        topic: 'PEPE 现在能进吗',
        status: 'completed',
        spentUsdc: '0.0012',
        startedAt: '2026-06-25T00:00:00.000Z',
        completedAt: '2026-06-25T00:00:18.000Z',
      }),
    ])
  })
})
