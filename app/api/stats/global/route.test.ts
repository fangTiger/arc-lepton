import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStore = vi.hoisted(() => {
  const entries: Array<{
    address: string
    amount: string
    txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
  }> = []

  function isBillable(status: 'mock' | 'pending' | 'confirmed' | 'failed') {
    return status === 'mock' || status === 'confirmed'
  }

  return {
    entries,
    reset() {
      entries.length = 0
    },
    researchRepo: {
      async countAll() {
        return 12
      },
      async countRunning() {
        return 2
      },
    },
    txLogRepo: {
      async count() {
        return entries.filter((entry) => isBillable(entry.txStatus)).length
      },
      async totalSpent() {
        return entries
          .filter((entry) => isBillable(entry.txStatus))
          .reduce((sum, entry) => sum + Number(entry.amount), 0)
          .toFixed(4)
      },
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockStore.researchRepo,
  txLogRepo: mockStore.txLogRepo,
}))

vi.mock('@/lib/rate-limit/research-quota', () => ({
  getGlobalQuotaStatus: async () => ({
    used: 67,
    limit: 100,
    remaining: 33,
    resetAt: '2026-06-26T00:00:00.000Z',
  }),
}))

beforeEach(() => {
  mockStore.reset()
})

describe('GET /api/stats/global', () => {
  it('opts out of build-time prerendering', async () => {
    const route = await import('./route')

    expect(route.dynamic).toBe('force-dynamic')
  })

  it('returns public aggregate stats', async () => {
    mockStore.entries.push(
      { address: '0xabc', amount: '0.0100', txStatus: 'confirmed' },
      { address: '0xdef', amount: '0.0056', txStatus: 'mock' },
      { address: '0xghi', amount: '0.0100', txStatus: 'failed' },
    )
    const { GET } = await import('./route')

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      totalResearches: 12,
      totalCallsAcrossAllUsers: 2,
      totalUsdcSpent: '0.0156',
      activeAgents: 2,
      dailyResearchQuota: {
        used: 67,
        limit: 100,
        remaining: 33,
        resetAt: '2026-06-26T00:00:00.000Z',
      },
    })
  })

  it('excludes pending and failed receipts from global aggregates when statuses are mixed', async () => {
    mockStore.entries.push(
      { address: '0xaaa', amount: '0.0003', txStatus: 'confirmed' },
      { address: '0xbbb', amount: '0.0002', txStatus: 'mock' },
      { address: '0xccc', amount: '0.0007', txStatus: 'pending' },
      { address: '0xddd', amount: '0.0009', txStatus: 'failed' },
    )
    const { GET } = await import('./route')

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.totalCallsAcrossAllUsers).toBe(2)
    expect(body.totalUsdcSpent).toBe('0.0005')
  })
})
