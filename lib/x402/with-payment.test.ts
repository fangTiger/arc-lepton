import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'
import { withPayment } from './with-payment'

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
    requestId: string
    errorMessage: string | null
    createdAt: Date
  }> = []
  const calls: Array<{ address: string; source: string; amount: string; requestId?: string }> = []
  let nextError: (Error & { code?: string }) | null = null

  return {
    entries,
    calls,
    reset() {
      counter = 0
      entries.length = 0
      calls.length = 0
      nextError = null
    },
    paymentRecorder: {
      async recordPaymentReceipt(entry: { address: string; source: string; amount: string; requestId?: string }) {
        if (nextError) throw nextError
        calls.push(entry)
        const existing = entry.requestId
          ? entries.find((tx) => tx.address === entry.address && tx.requestId === entry.requestId)
          : undefined
        if (existing) {
          if (existing.source !== entry.source || existing.amount !== entry.amount) {
            throw Object.assign(new Error('scope mismatch'), { code: 'PAYMENT_IDEMPOTENCY_CONFLICT' })
          }
          return existing
        }
        counter += 1
        const tx = {
          id: `tx-${counter}`,
          address: entry.address,
          source: entry.source,
          amount: entry.amount,
          txHash: `0x${counter.toString(16).padStart(64, '0')}`,
          txStatus: 'mock' as const,
          chainId: null,
          blockNumber: null,
          requestId: entry.requestId ?? `req-${counter}`,
          errorMessage: null,
          createdAt: new Date('2026-06-25T00:00:00.000Z'),
        }
        entries.push(tx)
        return tx
      },
    },
    failNext(code = 'PAYMENT_RECEIPT_FAILED', message = 'RPC timeout') {
      nextError = Object.assign(new Error(message), { code })
    },
  }
})

vi.mock('./payment-recorder', () => ({
  recordPaymentReceipt: mockStore.paymentRecorder.recordPaymentReceipt,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  mockStore.reset()
  delete process.env.ARC_RECEIPT_MODE
})

async function authedRequest({
  address = '0xAbCdEf000000000000000000000000000000C1d3',
  path = '/api/test',
  headers = {},
}: {
  address?: string
  path?: string
  headers?: Record<string, string>
} = {}) {
  const jwt = await signSessionJwt(address)
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `arc_session=${jwt}`, ...headers },
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
    const handler = vi.fn(async (_req: Request, ctx) => Response.json({ txHash: ctx.txHash, txStatus: ctx.txStatus }))
    const route = withPayment('whale-watch', '0.0002', handler)

    const res = await route(await authedRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.txHash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(body.txStatus).toBe('mock')
    expect(handler).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        address: '0xabcdef000000000000000000000000000000c1d3',
        source: 'whale-watch',
        amount: '0.0002',
        txStatus: 'mock',
        chainId: null,
        blockNumber: null,
        recordedAt: new Date('2026-06-25T00:00:00.000Z'),
      }),
    )
    expect(mockStore.entries).toHaveLength(1)
  })

  it('adds x402 payment headers to handler response', async () => {
    const route = withPayment('news', '0.0003', async () => Response.json({ ok: true }))

    const res = await route(await authedRequest())

    expect(res.headers.get('X-Payment-Tx')).toMatch(/^0x[a-f0-9]{64}$/)
    expect(res.headers.get('X-Payment-Tx-Status')).toBe('mock')
    expect(res.headers.get('X-Payment-Amount')).toBe('0.0003')
    expect(res.headers.get('X-Payment-Source')).toBe('news')
  })

  it('requires an explicit idempotency key before broadcasting in arc mode', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('news', '0.0003', handler)

    const res = await route(await authedRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'IDEMPOTENCY_KEY_REQUIRED' })
    expect(handler).not.toHaveBeenCalled()
    expect(mockStore.calls).toHaveLength(0)
  })

  it('prefers Idempotency-Key over X-Idempotency-Key and requestId query when recording arc receipts', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    const handler = vi.fn(async (_req: Request, ctx) => Response.json({ requestId: ctx.requestId }))
    const route = withPayment('news', '0.0003', handler)

    const res = await route(await authedRequest({
      path: '/api/test?requestId=query-key',
      headers: {
        'Idempotency-Key': 'header-key',
        'X-Idempotency-Key': 'legacy-header-key',
      },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ requestId: 'header-key' })
    expect(mockStore.calls).toEqual([
      {
        address: '0xabcdef000000000000000000000000000000c1d3',
        source: 'news',
        amount: '0.0003',
        requestId: 'header-key',
      },
    ])
  })

  it('falls back to requestId query when idempotency headers are absent', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    const handler = vi.fn(async (_req: Request, ctx) => Response.json({ requestId: ctx.requestId }))
    const route = withPayment('sentiment', '0.0001', handler)

    const res = await route(await authedRequest({ path: '/api/test?requestId=query-key' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ requestId: 'query-key' })
    expect(mockStore.calls[0]?.requestId).toBe('query-key')
  })

  it('returns 400 and does not record or call the handler when the arc idempotency key is too long', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('news', '0.0003', handler)

    const res = await route(await authedRequest({
      headers: {
        'Idempotency-Key': 'a'.repeat(129),
      },
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'IDEMPOTENCY_KEY_INVALID' })
    expect(mockStore.calls).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    { label: 'invalid characters', key: 'invalid/key' },
  ])('returns 400 and does not record or call the handler when the arc idempotency key has $label', async ({ key }) => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('news', '0.0003', handler)

    const res = await route(await authedRequest({
      path: '/api/test?requestId=query-key',
      headers: {
        'Idempotency-Key': key,
      },
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'IDEMPOTENCY_KEY_INVALID' })
    expect(mockStore.calls).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    '/api/test?requestId=',
    '/api/test?requestId=%20%20',
    '/api/test?requestId=%20replay-key%20',
  ])('returns 400 for an explicit invalid requestId query %s even outside arc mode', async (path) => {
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('sentiment', '0.0001', handler)

    const res = await route(await authedRequest({ path }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'IDEMPOTENCY_KEY_INVALID' })
    expect(mockStore.calls).toHaveLength(0)
    expect(handler).not.toHaveBeenCalled()
  })

  it('replays the business handler for the same-scope idempotency key while reusing the original receipt', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    const handler = vi.fn(async (_req: Request, ctx) => Response.json({ requestId: ctx.requestId, txHash: ctx.txHash }))
    const route = withPayment('news', '0.0003', handler)

    const first = await route(await authedRequest({
      headers: {
        'Idempotency-Key': 'replay-key',
      },
    }))
    const second = await route(await authedRequest({
      headers: {
        'Idempotency-Key': 'replay-key',
      },
    }))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(first.json()).resolves.toEqual({
      requestId: 'replay-key',
      txHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
    })
    await expect(second.json()).resolves.toEqual({
      requestId: 'replay-key',
      txHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
    })
    expect(handler).toHaveBeenCalledTimes(2)
    expect(mockStore.entries).toHaveLength(1)
    expect(mockStore.calls).toEqual([
      {
        address: '0xabcdef000000000000000000000000000000c1d3',
        source: 'news',
        amount: '0.0003',
        requestId: 'replay-key',
      },
      {
        address: '0xabcdef000000000000000000000000000000c1d3',
        source: 'news',
        amount: '0.0003',
        requestId: 'replay-key',
      },
    ])
  })

  it('returns 502 and does not call the handler when payment receipt recording fails', async () => {
    mockStore.failNext()
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('news', '0.0003', handler)

    const res = await route(await authedRequest())
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body).toEqual({ error: 'PAYMENT_RECEIPT_FAILED' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 409 and does not call the handler when the idempotency key conflicts with another payment scope', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    mockStore.failNext('PAYMENT_IDEMPOTENCY_CONFLICT', 'scope mismatch')
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('news', '0.0003', handler)

    const res = await route(await authedRequest({
      headers: {
        'Idempotency-Key': 'req-conflict',
      },
    }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'PAYMENT_IDEMPOTENCY_CONFLICT' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 409 and does not call the handler when the matching payment is still pending', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    mockStore.failNext('PAYMENT_RECEIPT_PENDING', 'still pending')
    const handler = vi.fn(async () => Response.json({ ok: true }))
    const route = withPayment('twitter-signals', '0.0001', handler)

    const res = await route(await authedRequest({
      headers: {
        'Idempotency-Key': 'req-pending',
      },
    }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'PAYMENT_RECEIPT_PENDING' })
    expect(handler).not.toHaveBeenCalled()
  })
})
