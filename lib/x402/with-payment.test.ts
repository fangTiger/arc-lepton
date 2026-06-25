import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'
import { withPayment } from './with-payment'

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

async function authedRequest(address = '0xAbCdEf000000000000000000000000000000C1d3') {
  const jwt = await signSessionJwt(address)
  return new Request('http://localhost/api/test', {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('withPayment', () => {
  it('returns 401 and does not record payment when unauthenticated', async () => {
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('sentiment', '0.0001', handler)

    const res = await route(new Request('http://localhost/api/test'))

    expect(res.status).toBe(401)
    expect(handler).not.toHaveBeenCalled()
    expect(mockStore.entries).toHaveLength(0)
  })

  it('calls handler with payment context and records tx_log when authenticated', async () => {
    const handler = vi.fn(async (_req: Request, ctx) => Response.json({ txHash: ctx.txHash }))
    const route = withPayment('whale-watch', '0.0002', handler)

    const res = await route(await authedRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.txHash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(handler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        address: '0xabcdef000000000000000000000000000000c1d3',
        source: 'whale-watch',
        amount: '0.0002',
        recordedAt: new Date('2026-06-25T00:00:00.000Z'),
      }),
    )
    expect(mockStore.entries).toHaveLength(1)
  })

  it('adds x402 payment headers to handler response', async () => {
    const route = withPayment('news', '0.0003', async () => Response.json({ ok: true }))

    const res = await route(await authedRequest())

    expect(res.headers.get('X-Payment-Tx')).toMatch(/^0x[a-f0-9]{64}$/)
    expect(res.headers.get('X-Payment-Amount')).toBe('0.0003')
    expect(res.headers.get('X-Payment-Source')).toBe('news')
  })
})
