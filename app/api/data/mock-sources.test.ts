import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  let counter = 0
  const entries: Array<{ id: string; address: string; source: string; amount: string; txHash: string; createdAt: Date }> = []

  return {
    entries,
    reset() {
      counter = 0
      entries.length = 0
    },
    txLogRepo: {
      async record(entry: { address: string; source: string; amount: string }) {
        counter += 1
        const tx = {
          id: `tx-${counter}`,
          address: entry.address,
          source: entry.source,
          amount: entry.amount,
          txHash: `0x${counter.toString(16).padStart(64, '0')}`,
          createdAt: new Date('2026-06-25T00:00:00.000Z'),
        }
        entries.push(tx)
        return { id: tx.id, txHash: tx.txHash, createdAt: tx.createdAt }
      },
      async listByAddress(address: string, limit = 50) {
        return entries.filter((entry) => entry.address === address).slice(0, limit)
      },
      async totalSpentByAddress(address: string) {
        return entries
          .filter((entry) => entry.address === address)
          .reduce((sum, entry) => sum + Number(entry.amount), 0)
          .toFixed(4)
      },
    },
  }
})

vi.mock('@/lib/db', () => ({
  txLogRepo: mockStore.txLogRepo,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  mockStore.reset()
})

async function authedRequest(path: string) {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

const sources = [
  { name: 'whale-watch', amount: '0.0002' },
  { name: 'sentiment', amount: '0.0001' },
  { name: 'news', amount: '0.0003' },
  { name: 'twitter-signals', amount: '0.0001' },
  { name: 'kline-pattern', amount: '0.0005' },
] as const

describe('mock data sources', () => {
  it.each(sources)('returns paid %s data with x402 headers', async ({ name, amount }) => {
    const { GET } = await import('./[name]/route')

    const res = await GET(await authedRequest(`/api/data/${name}?token=PEPE`), { params: { name } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Payment-Amount')).toBe(amount)
    expect(res.headers.get('X-Payment-Source')).toBe(name)
    expect(body).toMatchObject({
      source: name,
      token: 'PEPE',
      payment: {
        amount,
        source: name,
      },
    })
    expect(body.payment.txHash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(body.data).toBeTruthy()
    expect(mockStore.entries).toHaveLength(1)
  })

  it('defaults token to PEPE and returns deterministic business data for the same source/token/day', async () => {
    const { GET } = await import('./[name]/route')

    const first = await GET(await authedRequest('/api/data/sentiment'), { params: { name: 'sentiment' } })
    const second = await GET(await authedRequest('/api/data/sentiment?token=PEPE'), { params: { name: 'sentiment' } })

    const firstBody = await first.json()
    const secondBody = await second.json()
    expect(firstBody.token).toBe('PEPE')
    expect(firstBody.data).toEqual(secondBody.data)
    expect(firstBody.payment.txHash).not.toBe(secondBody.payment.txHash)
  })

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await import('./[name]/route')

    const res = await GET(new Request('http://localhost/api/data/whale-watch?token=PEPE'), { params: { name: 'whale-watch' } })

    expect(res.status).toBe(401)
    expect(mockStore.entries).toHaveLength(0)
  })

  it('returns 404 without charging for an unknown source', async () => {
    const { GET } = await import('./[name]/route')

    const res = await GET(await authedRequest('/api/data/unknown?token=PEPE'), { params: { name: 'unknown' } })

    expect(res.status).toBe(404)
    expect(mockStore.entries).toHaveLength(0)
  })
})
