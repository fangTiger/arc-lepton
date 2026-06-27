import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryResearchFollowUpRepo } from './research-follow-up-repo-memory'

describe('MemoryResearchFollowUpRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates a pending follow-up record with zero spent by default', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-27T08:00:00.000Z'))
    const repo = new MemoryResearchFollowUpRepo()

    const record = await repo.create({
      researchId: 'research-1',
      address: '0xabc',
      question: 'What would invalidate the bullish case?',
    })

    expect(record).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      researchId: 'research-1',
      address: '0xabc',
      question: 'What would invalidate the bullish case?',
      answerMd: null,
      status: 'pending',
      spentUsdc: '0',
      errorMessage: null,
      createdAt: new Date('2026-06-27T08:00:00.000Z'),
      completedAt: null,
    })
  })

  it('completes and fails follow-ups with persisted answers, cost, and timestamps', async () => {
    vi.useFakeTimers()
    const repo = new MemoryResearchFollowUpRepo()

    vi.setSystemTime(new Date('2026-06-27T08:00:00.000Z'))
    const completed = await repo.create({
      researchId: 'research-1',
      address: '0xabc',
      question: 'Summarize the main risk.',
    })

    vi.setSystemTime(new Date('2026-06-27T08:02:00.000Z'))
    const failed = await repo.create({
      researchId: 'research-1',
      address: '0xabc',
      question: 'What if volume fades?',
    })

    vi.setSystemTime(new Date('2026-06-27T08:05:00.000Z'))
    const completedRecord = await repo.complete(completed.id, {
      answerMd: 'Liquidity is still the biggest risk.',
      spentUsdc: '0.0003',
    })
    const failedRecord = await repo.fail(failed.id, 'Model timeout')

    expect(completedRecord).toMatchObject({
      id: completed.id,
      status: 'completed',
      answerMd: 'Liquidity is still the biggest risk.',
      spentUsdc: '0.0003',
      errorMessage: null,
      completedAt: new Date('2026-06-27T08:05:00.000Z'),
    })
    expect(failedRecord).toMatchObject({
      id: failed.id,
      status: 'failed',
      answerMd: null,
      spentUsdc: '0',
      errorMessage: 'Model timeout',
      completedAt: new Date('2026-06-27T08:05:00.000Z'),
    })
  })

  it('returns the latest N matching research follow-ups while keeping chronological order', async () => {
    vi.useFakeTimers()
    const repo = new MemoryResearchFollowUpRepo()

    vi.setSystemTime(new Date('2026-06-27T08:00:00.000Z'))
    await repo.create({ researchId: 'research-1', address: '0xabc', question: 'First follow-up' })
    vi.setSystemTime(new Date('2026-06-27T08:01:00.000Z'))
    await repo.create({ researchId: 'research-2', address: '0xabc', question: 'Other research' })
    vi.setSystemTime(new Date('2026-06-27T08:02:00.000Z'))
    await repo.create({ researchId: 'research-1', address: '0xdef', question: 'Other wallet' })
    vi.setSystemTime(new Date('2026-06-27T08:03:00.000Z'))
    await repo.create({ researchId: 'research-1', address: '0xabc', question: 'Second follow-up' })
    vi.setSystemTime(new Date('2026-06-27T08:04:00.000Z'))
    await repo.create({ researchId: 'research-1', address: '0xabc', question: 'Third follow-up' })

    const items = await repo.listByResearchId('0xabc', 'research-1', 2)

    expect(items.map((item) => item.question)).toEqual(['Second follow-up', 'Third follow-up'])
  })
})
