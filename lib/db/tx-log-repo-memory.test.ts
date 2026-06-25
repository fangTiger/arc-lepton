import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryTxLogRepo } from './tx-log-repo-memory'

describe('MemoryTxLogRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records tx_log entries with generated id, txHash, and createdAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    const repo = new MemoryTxLogRepo()

    const tx = await repo.record({
      address: '0xabc',
      source: 'whale-watch',
      amount: '0.0002',
    })

    expect(tx.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(tx.txHash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(tx.createdAt).toEqual(new Date('2026-06-25T00:00:00.000Z'))
  })

  it('lists entries by address in newest-first order with a limit', async () => {
    vi.useFakeTimers()
    const repo = new MemoryTxLogRepo()

    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    await repo.record({ address: '0xabc', source: 'sentiment', amount: '0.0001' })
    vi.setSystemTime(new Date('2026-06-25T00:01:00.000Z'))
    await repo.record({ address: '0xdef', source: 'news', amount: '0.0003' })
    vi.setSystemTime(new Date('2026-06-25T00:02:00.000Z'))
    await repo.record({ address: '0xabc', source: 'kline-pattern', amount: '0.0005' })

    const entries = await repo.listByAddress('0xabc', 1)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      address: '0xabc',
      source: 'kline-pattern',
      amount: '0.0005',
      createdAt: new Date('2026-06-25T00:02:00.000Z'),
    })
  })

  it('sums total spend by address as a decimal string', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({ address: '0xabc', source: 'sentiment', amount: '0.0001' })
    await repo.record({ address: '0xabc', source: 'whale-watch', amount: '0.0002' })
    await repo.record({ address: '0xdef', source: 'news', amount: '0.0003' })

    expect(await repo.totalSpentByAddress('0xabc')).toBe('0.0003')
  })
})
