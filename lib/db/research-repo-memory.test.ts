import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryResearchRepo } from './research-repo-memory'

describe('MemoryResearchRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a running research record', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    const repo = new MemoryResearchRepo()

    const research = await repo.create({
      address: '0xabc',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
    })

    expect(research).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      address: '0xabc',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      spentUsdc: '0',
      status: 'running',
      reportMd: null,
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: null,
    })
  })

  it('updates status, report, and spent amount without floating point drift', async () => {
    const repo = new MemoryResearchRepo()
    const research = await repo.create({ address: '0xabc', topic: 'PEPE', budgetUsdc: '0.01' })

    await repo.appendSpent(research.id, '0.0001')
    await repo.appendSpent(research.id, '0.0002')
    await repo.setReport(research.id, '# Report')
    await repo.updateStatus(research.id, 'completed')

    expect(await repo.findById(research.id)).toMatchObject({
      spentUsdc: '0.0003',
      status: 'completed',
      reportMd: '# Report',
      completedAt: expect.any(Date),
    })
  })

  it('lists records by address newest first with a limit', async () => {
    vi.useFakeTimers()
    const repo = new MemoryResearchRepo()

    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    await repo.create({ address: '0xabc', topic: 'first', budgetUsdc: '0.01' })
    vi.setSystemTime(new Date('2026-06-25T00:01:00.000Z'))
    await repo.create({ address: '0xdef', topic: 'other', budgetUsdc: '0.01' })
    vi.setSystemTime(new Date('2026-06-25T00:02:00.000Z'))
    await repo.create({ address: '0xabc', topic: 'second', budgetUsdc: '0.01' })

    const items = await repo.listByAddress('0xabc', 1)

    expect(items).toHaveLength(1)
    expect(items[0].topic).toBe('second')
  })
})
