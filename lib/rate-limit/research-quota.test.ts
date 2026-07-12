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

const mockQuotaRepo = vi.hoisted(() => ({
  consume: vi.fn(),
  release: vi.fn(),
  status: vi.fn(),
  reset() {
    this.consume.mockReset()
    this.release.mockReset()
    this.status.mockReset()
  },
}))

vi.mock('@/lib/db', () => ({
  researchQuotaRepo: mockQuotaRepo,
}))

const address = '0xAbCdEf000000000000000000000000000000C1d3'

describe('research quota', () => {
  beforeEach(() => {
    mockKv._clear()
    mockQuotaRepo.reset()
    delete process.env.ARC_RESEARCH_QUOTA_SHADOW_ENABLED
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
      wallet: { consumed: 10, reserved: 0, used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { consumed: 10, reserved: 0, used: 10, limit: 100, remaining: 90, resetAt: '2026-06-26T00:00:00.000Z' },
      backend: 'kv',
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
      global: { consumed: 100, reserved: 0, used: 100, limit: 100, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
      backend: 'kv',
    })
  })

  it('resets usage at the next UTC midnight', async () => {
    vi.setSystemTime(new Date('2026-06-25T23:59:30.000Z'))
    const { consumeQuota, getQuotaStatus } = await import('./research-quota')

    expect(await consumeQuota(address)).toEqual({ ok: true })
    expect((await getQuotaStatus(address)).wallet.used).toBe(1)

    vi.setSystemTime(new Date('2026-06-26T00:00:01.000Z'))

    expect(await getQuotaStatus(address)).toMatchObject({
      wallet: { consumed: 0, reserved: 0, used: 0, limit: 10, remaining: 10, resetAt: '2026-06-27T00:00:00.000Z' },
      global: { consumed: 0, reserved: 0, used: 0, limit: 100, remaining: 100, resetAt: '2026-06-27T00:00:00.000Z' },
      backend: 'kv',
    })
  })

  it('dual-writes quota usage to the Postgres shadow repo when enabled', async () => {
    process.env.ARC_RESEARCH_QUOTA_SHADOW_ENABLED = 'true'
    mockQuotaRepo.consume.mockResolvedValueOnce({ walletUsed: 1, globalUsed: 1 })
    mockQuotaRepo.status.mockResolvedValueOnce({
      wallet: { consumed: 1, reserved: 0, used: 1, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { consumed: 1, reserved: 0, used: 1, resetAt: '2026-06-26T00:00:00.000Z' },
    })
    const { consumeQuota, getQuotaStatus } = await import('./research-quota')

    expect(await consumeQuota(address)).toEqual({ ok: true })
    expect(mockQuotaRepo.consume).toHaveBeenCalledWith({
      address: address.toLowerCase(),
      day: '2026-06-25',
      resetAt: '2026-06-26T00:00:00.000Z',
    })
    expect(await getQuotaStatus(address)).toMatchObject({
      wallet: { consumed: 1, reserved: 0, used: 1, limit: 10, remaining: 9 },
      global: { consumed: 1, reserved: 0, used: 1, limit: 100, remaining: 99 },
      backend: 'postgres',
    })
    expect(mockQuotaRepo.status).toHaveBeenCalledWith({
      address: address.toLowerCase(),
      day: '2026-06-25',
      resetAt: '2026-06-26T00:00:00.000Z',
    })
  })

  it('returns reserved quota from the Postgres quota backend for strong reservation reads', async () => {
    process.env.ARC_RESEARCH_QUOTA_SHADOW_ENABLED = 'true'
    mockQuotaRepo.status.mockResolvedValueOnce({
      wallet: { consumed: 2, reserved: 1, used: 3, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { consumed: 20, reserved: 4, used: 24, resetAt: '2026-06-26T00:00:00.000Z' },
    })
    const { getQuotaStatus } = await import('./research-quota')

    await expect(getQuotaStatus(address)).resolves.toEqual({
      wallet: { consumed: 2, reserved: 1, used: 3, limit: 10, remaining: 7, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { consumed: 20, reserved: 4, used: 24, limit: 100, remaining: 76, resetAt: '2026-06-26T00:00:00.000Z' },
      backend: 'postgres',
    })
  })

  it('fails closed and rolls back when shadow quota counts diverge', async () => {
    process.env.ARC_RESEARCH_QUOTA_SHADOW_ENABLED = 'true'
    mockQuotaRepo.consume.mockResolvedValueOnce({ walletUsed: 99, globalUsed: 1 })
    mockQuotaRepo.status.mockResolvedValueOnce({
      wallet: { consumed: 0, reserved: 0, used: 0, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { consumed: 0, reserved: 0, used: 0, resetAt: '2026-06-26T00:00:00.000Z' },
    })
    const { consumeQuota, getQuotaStatus } = await import('./research-quota')

    expect(await consumeQuota(address)).toEqual({ ok: false, reason: 'QUOTA_SHADOW_MISMATCH' })
    expect(mockQuotaRepo.release).toHaveBeenCalledWith({
      address: address.toLowerCase(),
      day: '2026-06-25',
    })
    expect(await getQuotaStatus(address)).toMatchObject({
      wallet: { consumed: 0, reserved: 0, used: 0, remaining: 10 },
      global: { consumed: 0, reserved: 0, used: 0, remaining: 100 },
      backend: 'postgres',
    })
  })
})
