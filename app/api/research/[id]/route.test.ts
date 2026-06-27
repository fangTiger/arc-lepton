import { beforeAll, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  const researches = [
    {
      id: 'research-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      spentUsdc: '0.0012',
      status: 'completed' as const,
      reportMd: '# Report',
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: new Date('2026-06-25T00:00:18.000Z'),
    },
  ]
  const txEntries = [
    {
      id: 'tx-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed' as const,
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-1',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:05.000Z'),
    },
    {
      id: 'tx-2',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-2',
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      txStatus: 'confirmed' as const,
      chainId: 5_042_002,
      blockNumber: '12346',
      requestId: 'req-2',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:08.000Z'),
    },
    {
      id: 'tx-3',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'twitter-signals',
      amount: '0.0001',
      researchId: null,
      txHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      txStatus: 'mock' as const,
      chainId: null,
      blockNumber: null,
      requestId: 'req-3',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:10.000Z'),
    },
  ]

  return {
    researchRepo: {
      async findById(id: string) {
        return researches.find((research) => research.id === id) ?? null
      },
    },
    txLogRepo: {
      async listByAddress(address: string, limit = 50) {
        return txEntries.filter((entry) => entry.address === address).slice(0, limit)
      },
      async listByResearchId(address: string, researchId: string, limit = 50) {
        return txEntries
          .filter((entry) => entry.address === address && entry.researchId === researchId)
          .slice(0, limit)
      },
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockStore.researchRepo,
  txLogRepo: mockStore.txLogRepo,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

async function authedRequest(path = '/api/research/research-1') {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('GET /api/research/[id]', () => {
  it('returns only tx_log rows that match the same researchId', async () => {
    const { GET } = await import('./route')

    const res = await GET(await authedRequest(), { params: { id: 'research-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.txLog).toHaveLength(1)
    expect(body.txLog).toEqual([
      expect.objectContaining({
        id: 'tx-1',
        source: 'news',
        requestId: 'req-1',
      }),
    ])
  })
})
