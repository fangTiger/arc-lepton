import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('drizzle-orm', () => ({
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings: [...strings], values }),
}))

describe('PgResearchQuotaRepo', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('reads consumed, reserved, and used from research_quota_usage rows', async () => {
    const { PgResearchQuotaRepo } = await import('./research-quota-repo-pg')
    const { researchQuotaUsage } = await import('./schema/research-quota')
    const selectedIds: unknown[] = []
    const rows = new Map([
      ['wallet:0xabcdef000000000000000000000000000000c1d3:2026-07-11', {
        consumed: 2,
        reserved: 1,
        used: 3,
        resetAt: new Date('2026-07-12T00:00:00.000Z'),
      }],
      ['global:2026-07-11', {
        consumed: 20,
        reserved: 4,
        used: 24,
        resetAt: new Date('2026-07-12T00:00:00.000Z'),
      }],
    ])
    const database = {
      select() {
        return {
          from(table: unknown) {
            expect(table).toBe(researchQuotaUsage)
            return {
              where(condition: { right?: unknown }) {
                selectedIds.push(condition.right)
                return {
                  async limit() {
                    const row = rows.get(String(condition.right))
                    return row ? [row] : []
                  },
                }
              },
            }
          },
        }
      },
    }

    const repo = new PgResearchQuotaRepo(database as never)

    await expect(repo.status({
      address: '0xAbCdEf000000000000000000000000000000C1d3',
      day: '2026-07-11',
      resetAt: '2026-07-12T00:00:00.000Z',
    })).resolves.toEqual({
      wallet: { consumed: 2, reserved: 1, used: 3, resetAt: '2026-07-12T00:00:00.000Z' },
      global: { consumed: 20, reserved: 4, used: 24, resetAt: '2026-07-12T00:00:00.000Z' },
    })
    expect(selectedIds).toEqual([
      'wallet:0xabcdef000000000000000000000000000000c1d3:2026-07-11',
      'global:2026-07-11',
    ])
  })

  it('returns zero buckets when quota rows do not exist yet', async () => {
    const { PgResearchQuotaRepo } = await import('./research-quota-repo-pg')
    const database = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return []
                  },
                }
              },
            }
          },
        }
      },
    }

    const repo = new PgResearchQuotaRepo(database as never)

    await expect(repo.status({
      address: '0xabc',
      day: '2026-07-11',
      resetAt: '2026-07-12T00:00:00.000Z',
    })).resolves.toEqual({
      wallet: { consumed: 0, reserved: 0, used: 0, resetAt: '2026-07-12T00:00:00.000Z' },
      global: { consumed: 0, reserved: 0, used: 0, resetAt: '2026-07-12T00:00:00.000Z' },
    })
  })
})
