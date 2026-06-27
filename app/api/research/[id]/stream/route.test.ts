import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'
import { signResearchRunToken } from '@/lib/agent/research-token'

const mockState = vi.hoisted(() => {
  const calls: Array<{
    researchId: string
    address: string
    topic: string
    budgetUsdc: string
    signal?: AbortSignal
  }> = []
  const record = {
    id: 'research-1',
    address: '0xabcdef000000000000000000000000000000c1d3',
    topic: 'SHOULD I BUY PEPE?',
    budgetUsdc: '0.01',
    spentUsdc: '0',
    status: 'running',
    reportMd: null,
    errorMessage: null,
    startedAt: new Date('2026-06-25T00:00:00.000Z'),
    completedAt: null,
  }
  const errorRecord = {
    ...record,
    id: 'research-error',
    topic: 'THROW BEFORE STREAM',
  }
  const statusRaceErrorRecord = {
    ...record,
    id: 'research-error-status-race',
    topic: 'THROW AFTER ANOTHER TERMINAL STATUS WON',
  }
  const cancelRecord = {
    ...record,
    id: 'research-cancel',
    topic: 'CANCEL THIS RUN',
  }
  const completedRecord = {
    ...record,
    id: 'research-completed',
    topic: 'RESTORE STORED REPORT',
    spentUsdc: '0.0002',
    status: 'completed',
    reportMd: '# Stored report',
    completedAt: new Date('2026-06-25T00:05:00.000Z'),
  }
  const failedTerminalRecord = {
    ...record,
    id: 'research-failed-terminal',
    topic: 'FAILED BEFORE STREAM CONNECT',
    status: 'failed',
    errorMessage: 'Stored failure',
    completedAt: new Date('2026-06-25T00:05:00.000Z'),
  }
  const cancelledTerminalRecord = {
    ...record,
    id: 'research-cancelled-terminal',
    topic: 'CANCELLED BEFORE STREAM CONNECT',
    status: 'cancelled',
    completedAt: new Date('2026-06-25T00:05:00.000Z'),
  }
  const externallyCancelledRecord = {
    ...record,
    id: 'research-external-cancel',
    topic: 'CANCELLED FROM ANOTHER ENTRYPOINT',
  }
  const terminalHistoryRecord = {
    ...record,
    id: 'research-terminal-history',
    topic: 'TERMINAL HISTORY WITHOUT DONE',
  }
  const ownerRaceRecord = {
    ...record,
    id: 'research-owner-race',
    topic: 'ONLY ONE STREAM SHOULD RUN THE AGENT',
  }
  const statuses: Array<{ id: string; status: string; errorMessage?: string }> = []
  let statusRaceWon = false
  let releaseOwnerRace: (() => void) | null = null
  let ownerRaceGate = new Promise<void>((resolve) => {
    releaseOwnerRace = resolve
  })

  function resetOwnerRaceGate() {
    ownerRaceGate = new Promise<void>((resolve) => {
      releaseOwnerRace = resolve
    })
  }

  return {
    calls,
    statuses,
    reset() {
      calls.length = 0
      statuses.length = 0
      statusRaceWon = false
      resetOwnerRaceGate()
    },
    releaseOwnerRace() {
      releaseOwnerRace?.()
      releaseOwnerRace = null
    },
    researchRepo: {
      async findById(id: string) {
        if (id === record.id) return record
        if (id === errorRecord.id) return errorRecord
        if (id === statusRaceErrorRecord.id) {
          return statusRaceWon
            ? {
                ...statusRaceErrorRecord,
                status: 'completed',
                reportMd: '# Winner report',
                completedAt: new Date('2026-06-25T00:05:00.000Z'),
              }
            : statusRaceErrorRecord
        }
        if (id === cancelRecord.id) return cancelRecord
        if (id === completedRecord.id) return completedRecord
        if (id === failedTerminalRecord.id) return failedTerminalRecord
        if (id === cancelledTerminalRecord.id) return cancelledTerminalRecord
        if (id === externallyCancelledRecord.id) return externallyCancelledRecord
        if (id === terminalHistoryRecord.id) return terminalHistoryRecord
        if (id === ownerRaceRecord.id) return ownerRaceRecord
        return null
      },
      async updateStatus(id: string, status: string, errorMessage?: string) {
        statuses.push({ id, status, errorMessage })
      },
      async updateStatusIfCurrent(id: string, _expectedStatus: string, status: string, errorMessage?: string) {
        if (id === statusRaceErrorRecord.id) {
          statusRaceWon = true
          return false
        }
        statuses.push({ id, status, errorMessage })
        return true
      },
    },
    async *runResearchAgent(opts: {
      researchId: string
      address: string
      topic: string
      budgetUsdc: string
      signal?: AbortSignal
    }) {
      calls.push(opts)
      if (opts.researchId === 'research-error') throw new Error('DEEPSEEK_API_KEY required in production')
      if (opts.researchId === 'research-error-status-race') throw new Error('Late agent failure')
      if (opts.researchId === 'research-cancel') {
        await new Promise<never>((_resolve, reject) => {
          if (opts.signal?.aborted) {
            reject(new Error('Research cancelled'))
            return
          }
          opts.signal?.addEventListener('abort', () => reject(new Error('Research cancelled')), { once: true })
        })
      }
      if (opts.researchId === 'research-external-cancel') {
        const { publishResearchEvent } = await import('@/lib/agent/event-bus')
        publishResearchEvent(opts.researchId, { type: 'error', message: 'Research cancelled' })
        yield { type: 'error', message: 'Research cancelled' }
        return
      }
      if (opts.researchId === 'research-owner-race') {
        await ownerRaceGate
      }
      yield { type: 'thinking', text: 'Reading market context.' }
      yield { type: 'final', reportMd: '# Report', totalSpentUsdc: '0', totalCalls: 0 }
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockState.researchRepo,
}))

vi.mock('@/lib/agent/research-agent', () => ({
  runResearchAgent: mockState.runResearchAgent,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  mockState.reset()
})

async function authedRequest(id = 'research-1', signal?: AbortSignal) {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request(`http://localhost/api/research/${id}/stream`, {
    headers: { cookie: `arc_session=${jwt}` },
    signal,
  })
}

async function waitForAssertion(assertion: () => void) {
  let lastError: unknown
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  throw lastError
}

describe('GET /api/research/[id]/stream', () => {
  it('runs the research agent inside the stream request and emits SSE events', async () => {
    const { GET } = await import('./route')

    const res = await GET(await authedRequest(), { params: { id: 'research-1' } })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('event: agent_event')
    expect(text).toContain('"type":"thinking"')
    expect(text).toContain('"type":"final"')
    expect(mockState.calls[0]).toMatchObject({
      researchId: 'research-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
    })
  })

  it('emits an error event when the agent fails before yielding', async () => {
    const { GET } = await import('./route')

    const res = await GET(await authedRequest(), { params: { id: 'research-error' } })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('"type":"error"')
    expect(text).toContain('DEEPSEEK_API_KEY required in production')
    expect(mockState.statuses).toEqual([
      {
        id: 'research-error',
        status: 'failed',
        errorMessage: 'DEEPSEEK_API_KEY required in production',
      },
    ])
  })

  it('replays the persisted terminal event when route-level failure cleanup loses the status race', async () => {
    const { GET } = await import('./route')
    const { getResearchEvents } = await import('@/lib/agent/event-bus')

    const res = await GET(await authedRequest('research-error-status-race'), {
      params: { id: 'research-error-status-race' },
    })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('"type":"final"')
    expect(text).toContain('"reportMd":"# Winner report"')
    expect(text).not.toContain('Late agent failure')
    expect(mockState.statuses).toEqual([])
    expect(getResearchEvents('research-error-status-race')).toEqual({
      done: true,
      events: [{ type: 'final', reportMd: '# Winner report', totalSpentUsdc: '0', totalCalls: 0 }],
    })
  })

  it('recovers production memory fallback research input from a signed id', async () => {
    const { GET } = await import('./route')
    const researchId = await signResearchRunToken({
      id: 'research-lost',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'TOKEN RECOVERED TOPIC',
      budgetUsdc: '0.02',
    })

    const res = await GET(await authedRequest(), { params: { id: researchId } })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('"type":"final"')
    expect(mockState.calls[0]).toMatchObject({
      researchId: 'research-lost',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'TOKEN RECOVERED TOPIC',
      budgetUsdc: '0.02',
    })
  })

  it('replays a stored completed report as a terminal SSE event when no live history exists', async () => {
    const { GET } = await import('./route')
    const { getResearchEvents } = await import('@/lib/agent/event-bus')

    const res = await GET(await authedRequest('research-completed'), { params: { id: 'research-completed' } })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('"type":"final"')
    expect(text).toContain('"reportMd":"# Stored report"')
    expect(mockState.calls).toHaveLength(0)
    expect(getResearchEvents('research-completed')).toMatchObject({
      done: true,
      events: [
        { type: 'final', reportMd: '# Stored report', totalSpentUsdc: '0.0002', totalCalls: 0 },
      ],
    })
  })

  it('synthesizes a persisted terminal event when history is done but empty', async () => {
    const { GET } = await import('./route')
    const { markResearchDone } = await import('@/lib/agent/event-bus')
    markResearchDone('research-completed')

    const res = await GET(await authedRequest('research-completed'), { params: { id: 'research-completed' } })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('"type":"final"')
    expect(text).toContain('"reportMd":"# Stored report"')
    expect(mockState.calls).toHaveLength(0)
  })

  it.each([
    ['research-failed-terminal', 'Stored failure'],
    ['research-cancelled-terminal', 'Research cancelled'],
  ])('synthesizes a terminal error SSE event for %s when no live history exists', async (researchId, message) => {
    const { GET } = await import('./route')
    const { getResearchEvents } = await import('@/lib/agent/event-bus')

    const res = await GET(await authedRequest(researchId), { params: { id: researchId } })
    const text = await res.text()

    expect(res.status).toBe(200)
    expect(text).toContain('"type":"error"')
    expect(text).toContain(message)
    expect(mockState.calls).toHaveLength(0)
    expect(getResearchEvents(researchId)).toMatchObject({
      done: true,
      events: [{ type: 'error', message }],
    })
  })

  it('forwards request abort into the shared research signal without marking the run failed', async () => {
    const { GET } = await import('./route')
    const { getResearchAbortController } = await import('@/lib/agent/event-bus')
    const abortController = new AbortController()

    const res = await GET(await authedRequest('research-cancel', abortController.signal), {
      params: { id: 'research-cancel' },
    })

    const agentCall = mockState.calls[0]
    const sharedSignal = getResearchAbortController('research-cancel').signal

    expect(agentCall).toBeDefined()
    expect(agentCall?.signal).toBe(sharedSignal)
    expect(agentCall?.signal?.aborted).toBe(false)

    abortController.abort()
    await res.text()

    expect(agentCall?.signal?.aborted).toBe(true)
    expect(mockState.statuses).toEqual([])
  })

  it('still sends a terminal cancellation event to the direct stream when the event bus dedupes history', async () => {
    const { GET } = await import('./route')
    const { getResearchEvents } = await import('@/lib/agent/event-bus')

    const res = await GET(await authedRequest('research-external-cancel'), {
      params: { id: 'research-external-cancel' },
    })
    const text = await res.text()

    expect(text).toContain('"type":"error"')
    expect(text).toContain('Research cancelled')
    expect(getResearchEvents('research-external-cancel').events).toEqual([
      { type: 'error', message: 'Research cancelled' },
    ])
  })

  it('closes immediately when history already contains a terminal event but is not marked done', async () => {
    const { GET } = await import('./route')
    const { getResearchEvents, publishResearchEvent } = await import('@/lib/agent/event-bus')
    publishResearchEvent('research-terminal-history', { type: 'error', message: 'Research cancelled' })

    const res = await GET(await authedRequest('research-terminal-history'), {
      params: { id: 'research-terminal-history' },
    })
    const text = await Promise.race([
      res.text(),
      new Promise<string>((resolve) => setTimeout(() => resolve('STREAM_DID_NOT_CLOSE'), 50)),
    ])

    expect(text).toContain('"type":"error"')
    expect(text).toContain('Research cancelled')
    expect(text).not.toBe('STREAM_DID_NOT_CLOSE')
    expect(getResearchEvents('research-terminal-history')).toEqual({
      done: true,
      events: [{ type: 'error', message: 'Research cancelled' }],
    })
  })

  it('lets only one concurrent empty-history stream own the direct agent run', async () => {
    const { GET } = await import('./route')

    const firstRes = await GET(await authedRequest('research-owner-race'), {
      params: { id: 'research-owner-race' },
    })
    await waitForAssertion(() => expect(mockState.calls).toHaveLength(1))

    const secondRes = await GET(await authedRequest('research-owner-race'), {
      params: { id: 'research-owner-race' },
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(mockState.calls).toHaveLength(1)

    mockState.releaseOwnerRace()
    const [firstText, secondText] = await Promise.all([firstRes.text(), secondRes.text()])

    expect(firstText).toContain('"type":"final"')
    expect(secondText).toContain('"type":"final"')
    expect(mockState.calls).toHaveLength(1)
  })
})
