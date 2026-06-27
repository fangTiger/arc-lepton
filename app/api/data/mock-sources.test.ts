import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  let counter = 0
  const entries: Array<{
    id: string
    address: string
    source: string
    amount: string
    researchId: string | null
    txHash: string | null
    txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
    chainId: number | null
    blockNumber: string | null
    requestId: string | null
    errorMessage: string | null
    createdAt: Date
  }> = []

  function createEntry(entry: {
    address: string
    source: string
    amount: string
    researchId?: string | null
    txHash?: string | null
    txStatus?: 'mock' | 'pending' | 'confirmed' | 'failed'
    chainId?: number | null
    blockNumber?: string | null
    requestId?: string | null
    errorMessage?: string | null
  }) {
    counter += 1
    const tx = {
      id: `tx-${counter}`,
      address: entry.address,
      source: entry.source,
      amount: entry.amount,
      researchId: entry.researchId ?? null,
      txHash: entry.txHash !== undefined ? entry.txHash : `0x${counter.toString(16).padStart(64, '0')}`,
      txStatus: entry.txStatus ?? 'mock',
      chainId: entry.chainId ?? null,
      blockNumber: entry.blockNumber ?? null,
      requestId: entry.requestId ?? `req-${counter}`,
      errorMessage: entry.errorMessage ?? null,
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
    }
    entries.push(tx)
    return tx
  }

  return {
    entries,
    reset() {
      counter = 0
      entries.length = 0
    },
    txLogRepo: {
      async record(entry: Parameters<typeof createEntry>[0]) {
        return createEntry(entry)
      },
      async claimRequest(entry: { address: string; source: string; amount: string; requestId: string; researchId?: string | null }) {
        const existing = entries.find((tx) => tx.address === entry.address && tx.requestId === entry.requestId)
        if (existing) {
          if (existing.txStatus === 'pending') return { status: 'pending' as const, entry: existing }
          if (existing.txStatus === 'failed') return { status: 'failed' as const, entry: existing }
          return { status: 'existing' as const, entry: existing }
        }
        const tx = createEntry({
          address: entry.address,
          source: entry.source,
          amount: entry.amount,
          researchId: entry.researchId ?? null,
          txHash: null,
          txStatus: 'pending',
          requestId: entry.requestId,
        })
        return { status: 'claimed' as const, entry: tx }
      },
      async updateReceipt(id: string, patch: {
        txHash?: string | null
        txStatus?: 'mock' | 'pending' | 'confirmed' | 'failed'
        chainId?: number | null
        blockNumber?: string | null
        errorMessage?: string | null
      }) {
        const tx = entries.find((entry) => entry.id === id)
        if (!tx) throw new Error(`tx_log ${id} not found`)
        if (patch.txHash !== undefined) tx.txHash = patch.txHash
        if (patch.txStatus !== undefined) tx.txStatus = patch.txStatus
        if (patch.chainId !== undefined) tx.chainId = patch.chainId
        if (patch.blockNumber !== undefined) tx.blockNumber = patch.blockNumber
        if (patch.errorMessage !== undefined) tx.errorMessage = patch.errorMessage
        return tx
      },
      async findByRequestId(address: string, requestId: string) {
        return entries.find((entry) => entry.address === address && entry.requestId === requestId) ?? null
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
