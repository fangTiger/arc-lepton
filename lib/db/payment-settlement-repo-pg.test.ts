import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => ({
  whereArgs: [] as unknown[],
  orderByArgs: [] as unknown[],
  rows: [
    {
      id: 'settlement-older',
      address: '0xabc',
      researchId: 'research-older',
      requestIds: ['req-older'],
      totalAmount: '0.0001',
      status: 'broadcasting',
      txHash: null,
      chainId: null,
      blockNumber: null,
      attempts: 1,
      errorMessage: null,
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
      updatedAt: new Date('2026-07-03T00:00:00.000Z'),
    },
  ],
  reset() {
    this.whereArgs.length = 0
    this.orderByArgs.length = 0
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ type: 'and', args }),
  asc: (column: unknown) => ({ direction: 'asc', column }),
  count: () => ({ type: 'count' }),
  eq: (left: unknown, right: unknown) => ({ type: 'eq', left, right }),
  gt: (left: unknown, right: unknown) => ({ type: 'gt', left, right }),
  isNull: (value: unknown) => ({ type: 'isNull', value }),
  like: (left: unknown, right: unknown) => ({ type: 'like', left, right }),
  lte: (left: unknown, right: unknown) => ({ type: 'lte', left, right }),
  not: (value: unknown) => ({ type: 'not', value }),
  or: (...args: unknown[]) => ({ type: 'or', args }),
  sql: (...args: unknown[]) => ({ type: 'sql', args }),
}))

function containsExpression(
  value: unknown,
  predicate: (value: unknown) => boolean,
  seen = new WeakSet<object>(),
): boolean {
  if (predicate(value)) return true
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => containsExpression(item, predicate, seen))
  return Object.values(value).some((item) => containsExpression(item, predicate, seen))
}

describe('PgPaymentSettlementRepo', () => {
  beforeEach(() => {
    vi.resetModules()
    mockState.reset()
  })

  it('orders retryable settlements by oldest updatedAt first', async () => {
    const { PgPaymentSettlementRepo } = await import('./payment-settlement-repo-pg')
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

    const repo = new PgPaymentSettlementRepo(database as never)
    const rows = await repo.listRetryableSettlements({
      staleBroadcastingBefore: new Date('2026-07-03T00:05:00.000Z'),
      limit: 1,
    })

    expect(mockState.orderByArgs).toEqual([
      expect.objectContaining({ direction: 'asc' }),
    ])
    expect(rows.map((row) => row.id)).toEqual(['settlement-older'])
  })

  it('filters retryable failed rows to settlements without a txHash', async () => {
    const [{ PgPaymentSettlementRepo }, { paymentSettlement }] = await Promise.all([
      import('./payment-settlement-repo-pg'),
      import('./schema/payment-settlement'),
    ])
    const database = {
      select() {
        return {
          from() {
            return {
              where(arg: unknown) {
                mockState.whereArgs.push(arg)
                return {
                  orderBy() {
                    return {
                      async limit() {
                        return mockState.rows.map((row) => ({ ...row, status: 'failed', txHash: null }))
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

    const repo = new PgPaymentSettlementRepo(database as never)
    await repo.listRetryableSettlements({ limit: 1 })

    expect(mockState.whereArgs).toHaveLength(1)
    expect(containsExpression(
      mockState.whereArgs[0],
      (value) => (
        Boolean(value)
        && typeof value === 'object'
        && (value as { type?: unknown; value?: unknown }).type === 'isNull'
        && (value as { value?: unknown }).value === paymentSettlement.txHash
      ),
    )).toBe(true)
  })

  it('orders confirmed settlements for reconciliation scans by oldest updatedAt first', async () => {
    const { PgPaymentSettlementRepo } = await import('./payment-settlement-repo-pg')
    const database = {
      select() {
        return {
          from() {
            return {
              where(arg: unknown) {
                mockState.whereArgs.push(arg)
                return {
                  orderBy(arg: unknown) {
                    mockState.orderByArgs.push(arg)
                    return {
                      async limit() {
                        return mockState.rows.map((row) => ({
                          ...row,
                          status: 'confirmed',
                          txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
                        }))
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

    const repo = new PgPaymentSettlementRepo(database as never)
    const rows = await repo.listConfirmedSettlementsNeedingReconcile({ limit: 1 })

    expect(mockState.whereArgs).toEqual([
      expect.objectContaining({ type: 'eq', right: 'confirmed' }),
    ])
    expect(mockState.orderByArgs).toEqual([
      expect.objectContaining({ direction: 'asc' }),
    ])
    expect(rows.map((row) => row.id)).toEqual(['settlement-older'])
  })

  it('uses txHash-null guard when atomically reclaiming a failed settlement', async () => {
    const [{ PgPaymentSettlementRepo }, { paymentSettlement }] = await Promise.all([
      import('./payment-settlement-repo-pg'),
      import('./schema/payment-settlement'),
    ])
    const existing = {
      ...mockState.rows[0],
      id: 'settlement-failed-without-txhash',
      researchId: 'research-failed-without-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
      status: 'failed',
      txHash: null,
      errorMessage: 'RPC timeout',
    }
    const database = {
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
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
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return [{ ...existing }]
                  },
                }
              },
            }
          },
        }
      },
      update() {
        return {
          set() {
            return {
              where(arg: unknown) {
                mockState.whereArgs.push(arg)
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

    const repo = new PgPaymentSettlementRepo(database as never)
    await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed-without-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })

    expect(mockState.whereArgs).toHaveLength(1)
    expect(containsExpression(
      mockState.whereArgs[0],
      (value) => (
        Boolean(value)
        && typeof value === 'object'
        && (value as { type?: unknown; value?: unknown }).type === 'isNull'
        && (value as { value?: unknown }).value === paymentSettlement.txHash
      ),
    )).toBe(true)
  })

  it('uses txHash-null guard when atomically claiming retryable failed settlements', async () => {
    const [{ PgPaymentSettlementRepo }, { paymentSettlement }] = await Promise.all([
      import('./payment-settlement-repo-pg'),
      import('./schema/payment-settlement'),
    ])
    const existing = {
      ...mockState.rows[0],
      id: 'settlement-retryable-without-txhash',
      researchId: 'research-retryable-without-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
      status: 'failed',
      txHash: null,
      errorMessage: 'RPC timeout',
    }
    const database = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return [{ ...existing }]
                  },
                }
              },
            }
          },
        }
      },
      update() {
        return {
          set() {
            return {
              where(arg: unknown) {
                mockState.whereArgs.push(arg)
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

    const repo = new PgPaymentSettlementRepo(database as never)
    await repo.claimRetryableSettlement('settlement-retryable-without-txhash')

    expect(mockState.whereArgs).toHaveLength(1)
    expect(containsExpression(
      mockState.whereArgs[0],
      (value) => (
        Boolean(value)
        && typeof value === 'object'
        && (value as { type?: unknown; value?: unknown }).type === 'isNull'
        && (value as { value?: unknown }).value === paymentSettlement.txHash
      ),
    )).toBe(true)
  })

  it('does not reclaim a failed settlement that already has a txHash', async () => {
    const { PgPaymentSettlementRepo } = await import('./payment-settlement-repo-pg')
    const existing = {
      ...mockState.rows[0],
      id: 'settlement-failed-with-txhash',
      researchId: 'research-failed-with-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
      status: 'failed',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 5_042_002,
      blockNumber: null,
      errorMessage: 'receipt polling timed out',
    }
    const database = {
      insert() {
        return {
          values() {
            return {
              onConflictDoNothing() {
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
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async limit() {
                    return [{ ...existing }]
                  },
                }
              },
            }
          },
        }
      },
      update() {
        throw new Error('failed settlement with txHash must not be reclaimed')
      },
    }

    const repo = new PgPaymentSettlementRepo(database as never)
    const result = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed-with-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })

    expect(result).toMatchObject({
      status: 'existing',
      settlement: {
        id: 'settlement-failed-with-txhash',
        status: 'failed',
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })
  })
})
