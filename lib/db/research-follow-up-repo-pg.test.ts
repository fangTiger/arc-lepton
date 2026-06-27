import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  orderByArgs: [] as unknown[],
  rows: [
    {
      id: 'fu-3',
      researchId: 'research-1',
      address: '0xabc',
      question: 'Third follow-up',
      answerMd: 'Third answer',
      status: 'completed' as const,
      spentUsdc: '0',
      errorMessage: null,
      createdAt: new Date('2026-06-27T08:03:00.000Z'),
      completedAt: new Date('2026-06-27T08:03:05.000Z'),
    },
    {
      id: 'fu-2',
      researchId: 'research-1',
      address: '0xabc',
      question: 'Second follow-up',
      answerMd: 'Second answer',
      status: 'completed' as const,
      spentUsdc: '0',
      errorMessage: null,
      createdAt: new Date('2026-06-27T08:02:00.000Z'),
      completedAt: new Date('2026-06-27T08:02:05.000Z'),
    },
  ],
  reset() {
    this.orderByArgs.length = 0
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  asc: (column: unknown) => ({ direction: 'asc', column }),
  desc: (column: unknown) => ({ direction: 'desc', column }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
}))

describe('PgResearchFollowUpRepo', () => {
  beforeEach(() => {
    vi.resetModules()
    mockState.reset()
  })

  it('requests the latest N rows and returns them in chronological order', async () => {
    const { PgResearchFollowUpRepo } = await import('./research-follow-up-repo-pg')
    const database = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy(arg: unknown) {
                    mockState.orderByArgs.push(arg)
                    return {
                      async limit() {
                        return mockState.rows.map((row) => ({ ...row }))
                      },
                    }
                  },
                }
              },
            }
          },
        }
      },
    }

    const repo = new PgResearchFollowUpRepo(database as never)
    const items = await repo.listByResearchId('0xabc', 'research-1', 2)

    expect(mockState.orderByArgs).toEqual([
      expect.objectContaining({ direction: 'desc' }),
    ])
    expect(items.map((item) => item.question)).toEqual(['Second follow-up', 'Third follow-up'])
  })
})
