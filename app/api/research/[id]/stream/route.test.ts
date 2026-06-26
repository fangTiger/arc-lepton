import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'
import { signResearchRunToken } from '@/lib/agent/research-token'

const mockState = vi.hoisted(() => {
  const calls: Array<{ researchId: string; address: string; topic: string; budgetUsdc: string }> = []
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
  const statuses: Array<{ id: string; status: string; errorMessage?: string }> = []

  return {
    calls,
    statuses,
    reset() {
      calls.length = 0
      statuses.length = 0
    },
    researchRepo: {
      async findById(id: string) {
        if (id === record.id) return record
        if (id === errorRecord.id) return errorRecord
        return null
      },
      async updateStatus(id: string, status: string, errorMessage?: string) {
        statuses.push({ id, status, errorMessage })
      },
    },
    async *runResearchAgent(opts: { researchId: string; address: string; topic: string; budgetUsdc: string }) {
      calls.push(opts)
      if (opts.researchId === 'research-error') throw new Error('DEEPSEEK_API_KEY required in production')
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

async function authedRequest() {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request('http://localhost/api/research/research-1/stream', {
    headers: { cookie: `arc_session=${jwt}` },
  })
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
})
