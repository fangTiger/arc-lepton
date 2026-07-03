import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  let counter = 0
  const entries: Array<{
    id: string
    address: string
    source: string
    amount: string
    txHash: string | null
    txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
    chainId: number | null
    blockNumber: string | null
    settlementId: string | null
    requestId: string
    errorMessage: string | null
    createdAt: Date
  }> = []

  return {
    entries,
    reset() {
      counter = 0
      entries.length = 0
    },
    txLogRepo: {
      async record(entry: {
        address: string
        source: string
        amount: string
        txHash?: string | null
        txStatus?: 'mock' | 'pending' | 'confirmed' | 'failed'
        chainId?: number | null
        blockNumber?: string | null
        settlementId?: string | null
        requestId?: string
        errorMessage?: string | null
      }) {
        counter += 1
        const tx = {
          id: `tx-${counter}`,
          address: entry.address,
          source: entry.source,
          amount: entry.amount,
          txHash: entry.txHash ?? (entry.txStatus === 'failed' ? null : `0x${counter.toString(16).padStart(64, '0')}`),
          txStatus: entry.txStatus ?? 'mock',
          chainId: entry.chainId ?? null,
          blockNumber: entry.blockNumber ?? null,
          settlementId: entry.settlementId ?? null,
          requestId: entry.requestId ?? `req-${counter}`,
          errorMessage: entry.errorMessage ?? null,
          createdAt: new Date(Date.UTC(2026, 5, 25, 0, counter, 0)),
        }
        entries.unshift(tx)
        return tx
      },
      async listByAddress(address: string, limit = 50) {
        return entries.filter((entry) => entry.address === address).slice(0, limit)
      },
      async totalSpentByAddress(address: string) {
        return entries
          .filter((entry) => entry.address === address && (entry.txStatus === 'mock' || entry.txStatus === 'confirmed'))
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

async function authedRequest(path: string, address = '0xAbCdEf000000000000000000000000000000C1d3') {
  const jwt = await signSessionJwt(address)
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('wallet tx log APIs', () => {
  it('requires auth for tx-log and stats', async () => {
    const txLogRoute = await import('./tx-log/route')
    const statsRoute = await import('./stats/route')

    expect((await txLogRoute.GET(new Request('http://localhost/api/wallet/tx-log'))).status).toBe(401)
    expect((await statsRoute.GET(new Request('http://localhost/api/wallet/stats'))).status).toBe(401)
  })

  it('lists current user tx_log entries', async () => {
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0003',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      settlementId: 'settlement-1',
      requestId: 'req-confirmed',
    })
    await mockStore.txLogRepo.record({ address: '0xother', source: 'sentiment', amount: '0.0001' })
    const { GET } = await import('./tx-log/route')

    const res = await GET(await authedRequest('/api/wallet/tx-log'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({
      source: 'news',
      amount: '0.0003',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      settlementId: 'settlement-1',
      requestId: 'req-confirmed',
      errorMessage: null,
    })
  })

  it('returns billable spend/call counts without counting failed or pending receipts', async () => {
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0009',
      txStatus: 'failed',
      txHash: null,
      requestId: 'req-failed',
      errorMessage: 'RPC timeout',
    })
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'twitter-signals',
      amount: '0.0008',
      txStatus: 'pending',
      requestId: 'req-pending',
    })
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'whale-watch',
      amount: '0.0002',
      txStatus: 'confirmed',
    })
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'sentiment',
      amount: '0.0001',
      txStatus: 'mock',
    })
    const { GET } = await import('./stats/route')

    const res = await GET(await authedRequest('/api/wallet/stats'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      totalSpentUsdc: '0.0003',
      totalCalls: 2,
      lastResearchAt: '2026-06-25T00:04:00.000Z',
    })
  })
})
