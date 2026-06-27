import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockKv = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    client: {
      async set(key: string, value: string) {
        store.set(key, value)
        return 'OK'
      },
      async get(key: string) {
        return store.get(key) ?? null
      },
      async getdel(key: string) {
        const value = store.get(key) ?? null
        store.delete(key)
        return value
      },
      async incr(key: string) {
        const next = Number.parseInt(store.get(key) ?? '0', 10) + 1
        store.set(key, String(next))
        return next
      },
      async incrby(key: string, increment: number) {
        const next = Number.parseInt(store.get(key) ?? '0', 10) + increment
        store.set(key, String(next))
        return next
      },
      async decr(key: string) {
        const next = Number.parseInt(store.get(key) ?? '0', 10) - 1
        store.set(key, String(next))
        return next
      },
      async expire() {
        return 1
      },
    },
    clear() {
      store.clear()
    },
  }
})

vi.mock('@/lib/kv', () => ({
  kv: mockKv.client,
}))

beforeEach(() => {
  mockKv.clear()
})

describe('global-stats', () => {
  it('tracks started and finished research aggregates', async () => {
    const { getPersistedGlobalStats, recordResearchFinished, recordResearchStarted } = await import('./global-stats')

    await recordResearchStarted()
    await recordResearchStarted()
    await recordResearchFinished()

    await expect(getPersistedGlobalStats()).resolves.toMatchObject({
      totalResearches: 2,
      activeAgents: 1,
    })
  })

  it('tracks only billable payment aggregates', async () => {
    const { getPersistedGlobalStats, recordPaymentAggregate } = await import('./global-stats')

    await recordPaymentAggregate('0.0001', 'confirmed')
    await recordPaymentAggregate('0.0002', 'mock')
    await recordPaymentAggregate('0.0003', 'failed')
    await recordPaymentAggregate('0.0004', 'pending')

    await expect(getPersistedGlobalStats()).resolves.toMatchObject({
      totalCallsAcrossAllUsers: 2,
      totalUsdcSpent: '0.0003',
    })
  })
})
