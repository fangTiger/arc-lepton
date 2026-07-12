import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  orderByArgs: [] as unknown[],
  reset() {
    this.orderByArgs.length = 0
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  count: () => ({ type: 'count' }),
  desc: (column: unknown) => ({ direction: 'desc', column }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  inArray: (left: unknown, values: unknown[]) => ({ type: 'inArray', left, values }),
  isNotNull: (column: unknown) => ({ type: 'isNotNull', column }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings: [...strings], values }),
}))

function containsCoalesce(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => containsCoalesce(item, seen))
  const record = value as Record<string, unknown>
  if (Array.isArray(record.strings) && record.strings.some((part) => String(part).includes('coalesce'))) return true
  return Object.values(record).some((item) => containsCoalesce(item, seen))
}

describe('PgResearchRepo', () => {
  beforeEach(() => {
    vi.resetModules()
    mockState.reset()
  })

  it('orders lists by createdAt and id, not nullable startedAt', async () => {
    const [{ PgResearchRepo }, { research }] = await Promise.all([
      import('./research-repo-pg'),
      import('./schema/research'),
    ])
    const database = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  orderBy(...args: unknown[]) {
                    mockState.orderByArgs.push(...args)
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
      },
    }

    const repo = new PgResearchRepo(database as never)
    await repo.listByAddress('0xabc')

    expect(mockState.orderByArgs).toEqual([
      expect.objectContaining({ direction: 'desc', column: research.createdAt }),
      expect.objectContaining({ direction: 'desc', column: research.id }),
    ])
    expect(containsCoalesce(mockState.orderByArgs)).toBe(false)
  })

  it('reserves wallet/global quota and funding research in one transaction', async () => {
    const { PgResearchRepo } = await import('./research-repo-pg')
    const { research } = await import('./schema/research')
    const { researchQuotaUsage } = await import('./schema/research-quota')
    const operations: Array<Record<string, unknown>> = []
    const researchRow = {
      id: 'research-1',
      address: '0xabc',
      prepareRequestId: 'prepare-1',
      buyer: '0xabc',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      budgetUnits: '10000',
      spentUsdc: '0',
      status: 'funding',
      activationPhase: 'none',
      finalizationState: 'none',
      quotaReservationState: 'reserved',
      researchKey: '0xkey',
      expectedEscrowAddress: '0xescrow',
      escrowAddress: null,
      reportMd: null,
      errorMessage: null,
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      preparedAt: new Date('2026-07-11T00:00:00.000Z'),
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
      expectedExpiresAt: new Date('2026-07-12T00:00:00.000Z'),
      fundingDeadline: new Date('2026-07-11T00:15:00.000Z'),
      intentSigner: '0x5555555555555555555555555555555555555555',
      voucherNonce: '7',
      quotaDate: '2026-07-11',
      chainId: 5_042_002,
      startedAt: null,
      completedAt: null,
    }
    const tx = createFundingReservationDb({
      operations,
      findRows: [],
      insertResearchRows: [researchRow],
      quotaReturning: [{ used: 1 }, { used: 1 }],
    })
    const database = {
      ...tx,
      async transaction(callback: (client: unknown) => Promise<unknown>) {
        operations.push({ type: 'transaction:start' })
        const result = await callback(tx)
        operations.push({ type: 'transaction:commit' })
        return result
      },
    }

    const repo = new PgResearchRepo(database as never)
    const result = await repo.createFundingWithQuotaReservation({
      id: 'research-1',
      address: '0xAbC',
      prepareRequestId: 'prepare-1',
      buyer: '0xabc',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      budgetUnits: '10000',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
      expectedExpiresAt: new Date('2026-07-12T00:00:00.000Z'),
      fundingDeadline: new Date('2026-07-11T00:15:00.000Z'),
      quotaDate: '2026-07-11',
    }, {
      day: '2026-07-11',
      resetAt: new Date('2026-07-12T00:00:00.000Z'),
      walletLimit: 10,
      globalLimit: 100,
    })

    expect(result).toEqual({ ok: true, research: researchRow })
    expect(operations).toEqual([
      { type: 'transaction:start' },
      { type: 'select', table: research },
      expect.objectContaining({
        type: 'insert',
        table: researchQuotaUsage,
        values: expect.objectContaining({
          id: 'wallet:0xabc:2026-07-11',
          consumed: 0,
          reserved: 1,
          used: 1,
        }),
      }),
      expect.objectContaining({
        type: 'insert',
        table: researchQuotaUsage,
        values: expect.objectContaining({
          id: 'global:2026-07-11',
          consumed: 0,
          reserved: 1,
          used: 1,
        }),
      }),
      expect.objectContaining({
        type: 'insert',
        table: research,
        values: expect.objectContaining({
          address: '0xabc',
          prepareRequestId: 'prepare-1',
          quotaReservationState: 'reserved',
          quotaDate: '2026-07-11',
        }),
      }),
      { type: 'transaction:commit' },
    ])
  })

  it('returns an existing prepare on concurrent unique-key retry without surfacing an error', async () => {
    const [{ PgResearchRepo }] = await Promise.all([
      import('./research-repo-pg'),
      import('./schema/research'),
    ])
    const existing = {
      id: 'research-existing',
      address: '0xabc',
      prepareRequestId: 'prepare-1',
      buyer: '0xabc',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      budgetUnits: '10000',
      spentUsdc: '0',
      status: 'funding',
      activationPhase: 'none',
      finalizationState: 'none',
      quotaReservationState: 'reserved',
      researchKey: '0xkey',
      expectedEscrowAddress: '0xescrow',
      escrowAddress: null,
      reportMd: null,
      errorMessage: null,
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      preparedAt: new Date('2026-07-11T00:00:00.000Z'),
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
      expectedExpiresAt: new Date('2026-07-12T00:00:00.000Z'),
      fundingDeadline: new Date('2026-07-11T00:15:00.000Z'),
      intentSigner: '0x5555555555555555555555555555555555555555',
      voucherNonce: '7',
      quotaDate: '2026-07-11',
      chainId: 5_042_002,
      startedAt: null,
      completedAt: null,
    }
    const database = {
      ...createFundingReservationDb({
        findRows: [existing],
        insertResearchRows: [],
        quotaReturning: [],
      }),
      async transaction() {
        const error = new Error('duplicate key')
        ;(error as Error & { code?: string }).code = '23505'
        throw error
      },
    }

    const repo = new PgResearchRepo(database as never)
    await expect(repo.createFundingWithQuotaReservation({
      id: 'research-1',
      address: '0xAbC',
      prepareRequestId: 'prepare-1',
      topic: 'PEPE',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    }, {
      day: '2026-07-11',
      resetAt: new Date('2026-07-12T00:00:00.000Z'),
      walletLimit: 10,
      globalLimit: 100,
    })).resolves.toEqual({ ok: true, research: existing })
  })

  it('completes funding expiry, quota conversion, and RUN outbox in one transaction', async () => {
    const { PgResearchRepo } = await import('./research-repo-pg')
    const { research } = await import('./schema/research')
    const { researchQuotaUsage } = await import('./schema/research-quota')
    const { workflowOutbox } = await import('./schema/workflow-outbox')
    const operations: Array<Record<string, unknown>> = []
    const tx = createFundingExpiryCompletionDb({
      operations,
      updateResearchRows: [{ id: 'research-1', address: '0xabc', quotaDate: '2026-07-11' }],
    })
    const database = {
      ...tx,
      async transaction(callback: (client: unknown) => Promise<unknown>) {
        operations.push({ type: 'transaction:start' })
        const result = await callback(tx)
        operations.push({ type: 'transaction:commit' })
        return result
      },
    }

    const repo = new PgResearchRepo(database as never)
    await expect(repo.completeFundingExpiry({
      id: 'research-1',
      expected: { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
      next: { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      runOperation: {
        operationKey: 'research:research-1:RUN',
        type: 'RUN',
        researchId: 'research-1',
        escrowAddress: '0xescrow',
        phase: 'queued',
        payloadHash: 'run',
        protectedPayloadDigest: 'run',
        leaseOwner: 'worker',
        leaseDurationMs: 30_000,
      },
    })).resolves.toBe(true)

    expect(operations).toEqual([
      { type: 'transaction:start' },
      expect.objectContaining({
        type: 'update',
        table: research,
        values: expect.objectContaining({
          status: 'running',
          activationPhase: 'active',
          finalizationState: 'open',
          quotaReservationState: 'consumed',
        }),
      }),
      expect.objectContaining({ type: 'update', table: researchQuotaUsage }),
      expect.objectContaining({ type: 'update', table: researchQuotaUsage }),
      expect.objectContaining({
        type: 'insert',
        table: workflowOutbox,
        values: expect.objectContaining({
          operationKey: 'research:research-1:RUN',
          type: 'RUN',
          researchId: 'research-1',
          escrowAddress: '0xescrow',
          leaseOwner: 'worker',
        }),
      }),
      { type: 'transaction:commit' },
    ])
  })

  it('begins activation and writes protected ACTIVATE outbox in one transaction', async () => {
    const { PgResearchRepo } = await import('./research-repo-pg')
    const { research } = await import('./schema/research')
    const { workflowOutbox } = await import('./schema/workflow-outbox')
    const operations: Array<Record<string, unknown>> = []
    const tx = createFundingExpiryCompletionDb({
      operations,
      updateResearchRows: [{ id: 'research-1', address: '0xabc', quotaDate: '2026-07-11' }],
    })
    const database = {
      ...tx,
      async transaction(callback: (client: unknown) => Promise<unknown>) {
        operations.push({ type: 'transaction:start' })
        const result = await callback(tx)
        operations.push({ type: 'transaction:commit' })
        return result
      },
    }

    const repo = new PgResearchRepo(database as never)
    await expect(repo.beginActivation({
      id: 'research-1',
      expected: { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
      next: { activationPhase: 'activating', quotaReservationState: 'activating' },
      activateOperation: {
        operationKey: 'research:research-1:ACTIVATE',
        type: 'ACTIVATE',
        researchId: 'research-1',
        escrowAddress: '0xescrow',
        phase: 'queued',
        payloadHash: 'activate-public',
        protectedPayloadDigest: 'activate-digest',
        protectedPayload: 'raw-activation-payload',
        leaseOwner: 'start-api',
        leaseDurationMs: 30_000,
      },
    })).resolves.toBe(true)

    expect(operations).toEqual([
      { type: 'transaction:start' },
      expect.objectContaining({
        type: 'update',
        table: research,
        values: expect.objectContaining({
          status: 'funding',
          activationPhase: 'activating',
          finalizationState: 'none',
          quotaReservationState: 'activating',
        }),
      }),
      expect.objectContaining({
        type: 'insert',
        table: workflowOutbox,
        values: expect.objectContaining({
          operationKey: 'research:research-1:ACTIVATE',
          type: 'ACTIVATE',
          researchId: 'research-1',
          escrowAddress: '0xescrow',
          payloadHash: 'activate-public',
          protectedPayloadDigest: 'activate-digest',
          protectedPayload: 'raw-activation-payload',
          leaseOwner: 'start-api',
        }),
      }),
      { type: 'transaction:commit' },
    ])
  })

  it('requests cancellation and writes CLOSE outbox in one transaction', async () => {
    const { PgResearchRepo } = await import('./research-repo-pg')
    const { research } = await import('./schema/research')
    const { workflowOutbox } = await import('./schema/workflow-outbox')
    const operations: Array<Record<string, unknown>> = []
    const tx = createFundingExpiryCompletionDb({
      operations,
      updateResearchRows: [{ id: 'research-1', address: '0xabc', quotaDate: '2026-07-11' }],
    })
    const database = {
      ...tx,
      async transaction(callback: (client: unknown) => Promise<unknown>) {
        operations.push({ type: 'transaction:start' })
        const result = await callback(tx)
        operations.push({ type: 'transaction:commit' })
        return result
      },
    }

    const repo = new PgResearchRepo(database as never)
    await expect(repo.requestCancellation({
      id: 'research-1',
      expected: { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      next: { status: 'cancelled', finalizationState: 'closing' },
      closeOperation: {
        operationKey: 'CLOSE:research-1',
        type: 'CLOSE',
        researchId: 'research-1',
        escrowAddress: '0xescrow',
        phase: 'queued',
        payloadHash: 'cancel-public',
        protectedPayloadDigest: 'cancel-digest',
        leaseOwner: 'cancel-api',
        leaseDurationMs: 30_000,
      },
    })).resolves.toBe(true)

    expect(operations).toEqual([
      { type: 'transaction:start' },
      expect.objectContaining({
        type: 'update',
        table: research,
        values: expect.objectContaining({
          status: 'cancelled',
          activationPhase: 'active',
          finalizationState: 'closing',
          quotaReservationState: 'consumed',
          cancelRequestedAt: expect.any(Date),
          errorMessage: 'Research cancelled',
          completedAt: expect.any(Date),
        }),
      }),
      expect.objectContaining({
        type: 'insert',
        table: workflowOutbox,
        values: expect.objectContaining({
          operationKey: 'CLOSE:research-1',
          type: 'CLOSE',
          researchId: 'research-1',
          escrowAddress: '0xescrow',
          payloadHash: 'cancel-public',
          protectedPayloadDigest: 'cancel-digest',
          leaseOwner: 'cancel-api',
        }),
      }),
      { type: 'transaction:commit' },
    ])
  })
})

function createFundingReservationDb(input: {
  operations?: Array<Record<string, unknown>>
  findRows: unknown[]
  insertResearchRows: unknown[]
  quotaReturning: Array<{ used: number }>
}) {
  const operations = input.operations ?? []
  return {
    select() {
      return {
        from(table: unknown) {
          operations.push({ type: 'select', table })
          return {
            where() {
              return {
                async limit() {
                  return input.findRows
                },
              }
            },
          }
        },
      }
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          operations.push({ type: 'insert', table, values })
          return {
            onConflictDoUpdate() {
              return {
                async returning() {
                  return [input.quotaReturning.shift() ?? { used: 1 }]
                },
              }
            },
            async returning() {
              return input.insertResearchRows
            },
          }
        },
      }
    },
  }
}

function createFundingExpiryCompletionDb(input: {
  operations: Array<Record<string, unknown>>
  updateResearchRows: Array<{ id: string; address: string; quotaDate: string }>
}) {
  return {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          input.operations.push({ type: 'update', table, values })
          return {
            where() {
              return {
                async returning() {
                  return input.updateResearchRows.shift() ? [{ id: 'research-1', address: '0xabc', quotaDate: '2026-07-11' }] : []
                },
              }
            },
          }
        },
      }
    },
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          input.operations.push({ type: 'insert', table, values })
          return {
            onConflictDoNothing() {
              return {
                async returning() {
                  return [{ id: 'operation-1' }]
                },
              }
            },
          }
        },
      }
    },
  }
}
