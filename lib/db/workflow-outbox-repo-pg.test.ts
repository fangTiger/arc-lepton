import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const drizzleMock = vi.hoisted(() => ({
  eqCalls: [] as Array<{ left: unknown; right: unknown }>,
  gtCalls: [] as Array<{ left: unknown; right: unknown }>,
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ type: 'and', conditions }),
  asc: (value: unknown) => ({ type: 'asc', value }),
  count: () => ({ type: 'count' }),
  eq: (left: unknown, right: unknown) => {
    drizzleMock.eqCalls.push({ left, right })
    return { type: 'eq', left, right }
  },
  gt: (left: unknown, right: unknown) => {
    drizzleMock.gtCalls.push({ left, right })
    return { type: 'gt', left, right }
  },
  inArray: (left: unknown, values: unknown[]) => ({ type: 'inArray', left, values }),
  isNull: (value: unknown) => ({ type: 'isNull', value }),
  lte: (left: unknown, right: unknown) => ({ type: 'lte', left, right }),
  not: (condition: unknown) => ({ type: 'not', condition }),
  or: (...conditions: unknown[]) => ({ type: 'or', conditions }),
}))

describe('PgWorkflowOutboxRepo', () => {
  beforeEach(() => {
    vi.resetModules()
    drizzleMock.eqCalls.length = 0
    drizzleMock.gtCalls.length = 0
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renews a RUN lease only for the current owner, fencing token, and unexpired lease', async () => {
    const { PgWorkflowOutboxRepo } = await import('./workflow-outbox-repo-pg')
    const { workflowOutbox } = await import('./schema/workflow-outbox')
    const captured: { table?: unknown; set?: Record<string, unknown>; where?: unknown } = {}
    const row = workflowRow({
      leaseOwner: 'runner-a',
      leaseExpiresAt: new Date('2026-07-11T04:00:45.000Z'),
      updatedAt: new Date('2026-07-11T04:00:00.000Z'),
    })
    const database = {
      update(table: unknown) {
        captured.table = table
        return {
          set(values: Record<string, unknown>) {
            captured.set = values
            return {
              where(condition: unknown) {
                captured.where = condition
                return {
                  async returning() {
                    return [row]
                  },
                }
              },
            }
          },
        }
      },
    }

    const repo = new PgWorkflowOutboxRepo(database as never)

    await expect(repo.renewLease('op-1', 7, {
      leaseOwner: 'runner-a',
      leaseDurationMs: 45_000,
    })).resolves.toMatchObject({
      id: 'op-1',
      type: 'RUN',
      leaseOwner: 'runner-a',
      leaseExpiresAt: new Date('2026-07-11T04:00:45.000Z'),
      fencingToken: 7,
    })

    expect(captured.table).toBe(workflowOutbox)
    expect(captured.set).toMatchObject({
      leaseExpiresAt: new Date('2026-07-11T04:00:45.000Z'),
      updatedAt: new Date('2026-07-11T04:00:00.000Z'),
    })
    expect(captured.where).toMatchObject({ type: 'and' })
    expect(drizzleMock.eqCalls.map((call) => call.right)).toEqual([
      'op-1',
      7,
      'runner-a',
    ])
    expect(drizzleMock.gtCalls).toHaveLength(1)
    expect(drizzleMock.gtCalls[0].right).toEqual(new Date('2026-07-11T04:00:00.000Z'))
  })

  it('guards checkpoint writes with fencing token and unexpired lease', async () => {
    const { PgWorkflowOutboxRepo } = await import('./workflow-outbox-repo-pg')
    const database = {
      update() {
        return {
          set() {
            return {
              where() {
                return {
                  async returning() {
                    return []
                  },
                }
              },
            }
          },
        }
      },
    }
    const repo = new PgWorkflowOutboxRepo(database as never)

    await expect(repo.recordCheckpoint('op-1', 7, {
      phase: 'running',
      payloadHash: `0x${'aa'.repeat(32)}`,
    })).resolves.toBe(false)

    expect(drizzleMock.eqCalls.map((call) => call.right)).toEqual(['op-1', 7])
    expect(drizzleMock.gtCalls[0].right).toEqual(new Date('2026-07-11T04:00:00.000Z'))
  })
})

function workflowRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'op-1',
    operationKey: 'RUN:research-1',
    type: 'RUN',
    researchId: 'research-1',
    escrowAddress: '0x4444444444444444444444444444444444444444',
    phase: 'running',
    payloadHash: `0x${'aa'.repeat(32)}`,
    protectedPayloadDigest: `0x${'bb'.repeat(32)}`,
    protectedPayload: '{"secret":"redacted"}',
    leaseOwner: 'runner-a',
    leaseExpiresAt: new Date('2026-07-11T04:00:30.000Z'),
    fencingToken: 7,
    attempts: 2,
    nextAttemptAt: new Date('2026-07-11T04:00:00.000Z'),
    txHash: null,
    chainId: null,
    blockNumber: null,
    blockHash: null,
    logIndex: null,
    lastError: null,
    createdAt: new Date('2026-07-11T03:59:00.000Z'),
    updatedAt: new Date('2026-07-11T04:00:00.000Z'),
    ...overrides,
  }
}
