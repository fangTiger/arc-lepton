import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  const records = new Map<string, {
    id: string
    address: string
    topic: string
    budgetUsdc: string
    spentUsdc: string
    status: 'running' | 'completed' | 'failed' | 'cancelled'
    activationPhase?: 'none' | 'active'
    finalizationState?: 'none' | 'open' | 'closing' | 'closed'
    quotaReservationState?: 'none' | 'consumed'
    researchKey?: string | null
    escrowAddress?: string | null
    cancelRequestedAt?: Date | null
    reportMd: string | null
    errorMessage: string | null
    startedAt: Date
    completedAt: Date | null
  }>()
  const statusUpdates: Array<{ id: string; status: string; errorMessage?: string }> = []
  const durableCancelRequests: Array<{
    id: string
    closeOperation: {
      operationKey: string
      type: string
      researchId: string
      escrowAddress?: string | null
    }
  }> = []
  const completeOnNextConditionalUpdate = new Set<string>()

  function researchRecord(id: string, status: 'running' | 'completed' | 'failed' | 'cancelled') {
    return {
      id,
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      spentUsdc: status === 'completed' ? '0.0002' : '0',
      status,
      activationPhase: 'none' as const,
      finalizationState: status === 'running' ? 'none' as const : 'closed' as const,
      quotaReservationState: 'none' as const,
      researchKey: null,
      escrowAddress: null,
      cancelRequestedAt: null,
      reportMd: status === 'completed' ? '# Completed report' : null,
      errorMessage: status === 'failed' ? 'Stored failure' : null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: status === 'running' ? null : new Date('2026-06-25T00:01:00.000Z'),
    }
  }

  return {
    records,
    statusUpdates,
    reset() {
      records.clear()
      statusUpdates.length = 0
      durableCancelRequests.length = 0
      completeOnNextConditionalUpdate.clear()
      records.set('research-running', researchRecord('research-running', 'running'))
      records.set('research-escrow-running', {
        ...researchRecord('research-escrow-running', 'running'),
        activationPhase: 'active',
        finalizationState: 'open',
        quotaReservationState: 'consumed',
        researchKey: `0x${'42'.repeat(32)}`,
        escrowAddress: '0x4444444444444444444444444444444444444444',
      })
      records.set('research-completed', researchRecord('research-completed', 'completed'))
      records.set('research-failed', researchRecord('research-failed', 'failed'))
      records.set('research-cancelled', researchRecord('research-cancelled', 'cancelled'))
      records.set('research-race', researchRecord('research-race', 'running'))
    },
    completeBeforeNextConditionalUpdate(id: string) {
      completeOnNextConditionalUpdate.add(id)
    },
    durableCancelRequests,
    researchRepo: {
      async findById(id: string) {
        return records.get(id) ?? null
      },
      async requestCancellation(input: {
        id: string
        closeOperation: {
          operationKey: string
          type: string
          researchId: string
          escrowAddress?: string | null
        }
      }) {
        const record = records.get(input.id)
        if (!record || record.status !== 'running' || record.finalizationState !== 'open') return false
        durableCancelRequests.push(input)
        records.set(input.id, {
          ...record,
          status: 'cancelled',
          finalizationState: 'closing',
          cancelRequestedAt: new Date('2026-07-11T06:00:00.000Z'),
          errorMessage: 'Research cancelled',
          completedAt: new Date('2026-07-11T06:00:00.000Z'),
        })
        return true
      },
      async updateStatusIfCurrent(
        id: string,
        expectedStatus: 'running' | 'completed' | 'failed' | 'cancelled',
        status: 'running' | 'completed' | 'failed' | 'cancelled',
        errorMessage?: string,
      ) {
        if (completeOnNextConditionalUpdate.delete(id)) {
          const current = records.get(id)
          if (current) {
            records.set(id, {
              ...current,
              status: 'completed',
              reportMd: '# Completed during race',
              completedAt: new Date('2026-06-25T00:01:30.000Z'),
            })
          }
        }
        const record = records.get(id)
        if (!record || record.status !== expectedStatus) return false
        statusUpdates.push({ id, status, errorMessage })
        records.set(id, {
          ...record,
          status,
          errorMessage: errorMessage ?? null,
          completedAt: status === 'running' ? null : new Date('2026-06-25T00:02:00.000Z'),
        })
        return true
      },
      async updateStatus(id: string, status: 'running' | 'completed' | 'failed' | 'cancelled', errorMessage?: string) {
        statusUpdates.push({ id, status, errorMessage })
        const record = records.get(id)
        if (record) {
          record.status = status
          record.errorMessage = errorMessage ?? null
          record.completedAt = new Date('2026-06-25T00:02:00.000Z')
        }
      },
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockStore.researchRepo,
  workflowOutboxRepo: {},
}))

const eventBusGlobal = globalThis as typeof globalThis & {
  __arcLeptonResearchEventBus?: unknown
}

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  mockStore.reset()
})

afterEach(() => {
  delete eventBusGlobal.__arcLeptonResearchEventBus
})

async function authedRequest(id: string) {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request(`http://localhost/api/research/${id}/cancel`, {
    method: 'POST',
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('POST /api/research/[id]/cancel', () => {
  it('cancels a running research and marks the event stream done', async () => {
    const { POST } = await import('./route')
    const { getResearchEvents } = await import('@/lib/agent/event-bus')

    const res = await POST(await authedRequest('research-running'), { params: { id: 'research-running' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ researchId: 'research-running', status: 'cancelled' })
    expect(mockStore.statusUpdates).toEqual([
      { id: 'research-running', status: 'cancelled', errorMessage: 'Research cancelled' },
    ])
    expect(getResearchEvents('research-running')).toEqual({
      done: true,
      events: [{ type: 'error', message: 'Research cancelled' }],
    })
  })

  it('durably records cancelRequestedAt and finalization outbox for an active escrow research', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest('research-escrow-running'), { params: { id: 'research-escrow-running' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      researchId: 'research-escrow-running',
      status: 'cancelled',
      finalizationState: 'closing',
    })
    expect(mockStore.durableCancelRequests).toEqual([
      expect.objectContaining({
        id: 'research-escrow-running',
        closeOperation: expect.objectContaining({
          operationKey: 'CLOSE:research-escrow-running',
          type: 'CLOSE',
          researchId: 'research-escrow-running',
          escrowAddress: '0x4444444444444444444444444444444444444444',
        }),
      }),
    ])
    expect(mockStore.records.get('research-escrow-running')).toMatchObject({
      status: 'cancelled',
      finalizationState: 'closing',
      cancelRequestedAt: new Date('2026-07-11T06:00:00.000Z'),
    })
    expect(mockStore.statusUpdates).toEqual([])
  })

  it.each([
    ['research-completed', 'completed'],
    ['research-failed', 'failed'],
    ['research-cancelled', 'cancelled'],
  ])('does not overwrite an already terminal %s research', async (researchId, status) => {
    const { POST } = await import('./route')
    const { getResearchEvents } = await import('@/lib/agent/event-bus')

    const res = await POST(await authedRequest(researchId), { params: { id: researchId } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ researchId, status })
    expect(mockStore.statusUpdates).toEqual([])
    expect(mockStore.records.get(researchId)).toMatchObject({ status })
    expect(getResearchEvents(researchId)).toEqual({ done: false, events: [] })
  })

  it('does not overwrite a research that completes between the initial read and conditional cancel update', async () => {
    const { POST } = await import('./route')
    const { getResearchEvents } = await import('@/lib/agent/event-bus')
    mockStore.completeBeforeNextConditionalUpdate('research-race')

    const res = await POST(await authedRequest('research-race'), { params: { id: 'research-race' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ researchId: 'research-race', status: 'completed' })
    expect(mockStore.statusUpdates).toEqual([])
    expect(mockStore.records.get('research-race')).toMatchObject({
      status: 'completed',
      reportMd: '# Completed during race',
    })
    expect(getResearchEvents('research-race')).toEqual({ done: false, events: [] })
  })
})
