import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockKv = vi.hoisted(() => {
  type Value = { value: string; expiresAt: number | null }
  const store = new Map<string, Value>()

  return {
    async get(key: string) {
      const item = store.get(key)
      if (!item) return null
      if (item.expiresAt && Date.now() > item.expiresAt) {
        store.delete(key)
        return null
      }
      return item.value
    },
    async incr(key: string) {
      const current = Number.parseInt((await this.get(key)) ?? '0', 10)
      const next = current + 1
      const existing = store.get(key)
      store.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null })
      return next
    },
    async decr(key: string) {
      const current = Number.parseInt((await this.get(key)) ?? '0', 10)
      const next = current - 1
      const existing = store.get(key)
      store.set(key, { value: String(next), expiresAt: existing?.expiresAt ?? null })
      return next
    },
    async expire(key: string, seconds: number) {
      const item = store.get(key)
      if (!item) return 0
      item.expiresAt = Date.now() + seconds * 1000
      return 1
    },
    _clear() {
      store.clear()
    },
  }
})

vi.mock('@/lib/kv', () => ({ kv: mockKv }))

const address = '0xAbCdEf000000000000000000000000000000C1d3'

describe('research quota', () => {
  beforeEach(() => {
    mockKv._clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects the 11th research creation for one wallet', async () => {
    const { consumeQuota, getQuotaStatus } = await import('./research-quota')

    for (let i = 0; i < 10; i += 1) {
      expect(await consumeQuota(address)).toEqual({ ok: true })
    }

    expect(await consumeQuota(address)).toEqual({ ok: false, reason: 'WALLET_LIMIT' })
    expect(await getQuotaStatus(address)).toMatchObject({
      wallet: { used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { used: 10, limit: 100, remaining: 90, resetAt: '2026-06-26T00:00:00.000Z' },
    })
  })

  it('rejects the 101st research creation globally', async () => {
    const { consumeQuota, getQuotaStatus } = await import('./research-quota')

    for (let i = 0; i < 100; i += 1) {
      const wallet = `0x${String(i + 1).padStart(40, '0')}`
      expect(await consumeQuota(wallet)).toEqual({ ok: true })
    }

    expect(await consumeQuota('0x' + 'f'.repeat(40))).toEqual({ ok: false, reason: 'GLOBAL_LIMIT' })
    expect(await getQuotaStatus(address)).toMatchObject({
      global: { used: 100, limit: 100, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
    })
  })

  it('resets usage at the next UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-06-25T23:59:30.000Z'))
    const { consumeQuota, getQuotaStatus } = await import('./research-quota')

    expect(await consumeQuota(address)).toEqual({ ok: true })
    expect((await getQuotaStatus(address)).wallet.used).toBe(1)

    vi.setSystemTime(new Date('2026-06-26T00:00:01.000Z'))

    expect(await getQuotaStatus(address)).toMatchObject({
      wallet: { used: 0, limit: 10, remaining: 10, resetAt: '2026-06-27T00:00:00.000Z' },
      global: { used: 0, limit: 100, remaining: 100, resetAt: '2026-06-27T00:00:00.000Z' },
    })
  })
})
