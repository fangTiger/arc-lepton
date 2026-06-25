import { describe, expect, it, vi } from 'vitest'

const mockStore = vi.hoisted(() => ({
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
      return 47
    },
    async totalSpent() {
      return '0.0156'
    },
  },
}))

vi.mock('@/lib/db', () => ({
  researchRepo: mockStore.researchRepo,
  txLogRepo: mockStore.txLogRepo,
}))

describe('GET /api/stats/global', () => {
  it('returns public aggregate stats', async () => {
    const { GET } = await import('./route')

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      totalResearches: 12,
      totalCallsAcrossAllUsers: 47,
      totalUsdcSpent: '0.0156',
      activeAgents: 2,
    })
  })
})
