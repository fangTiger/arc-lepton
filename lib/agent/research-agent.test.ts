import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const txEntries: Array<{ address: string; source: string; amount: string; txHash: string }> = []
  const researchRecords = new Map<string, { spentUsdc: string; status: string; reportMd: string | null; errorMessage: string | null }>()
  let txCounter = 0
  let nonStreamCalls = 0

  function makeToolCall(id: string, name: string, token = 'PEPE') {
    return {
      id,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify({ token }),
      },
    }
  }

  async function* reportStream() {
    yield { choices: [{ delta: { content: '# PEPE 研究报告\n' } }] }
    yield { choices: [{ delta: { content: '建议：观望。' } }] }
  }

  const client = {
    chat: {
      completions: {
        create: vi.fn(async (params: { stream?: boolean }) => {
          if (params.stream) return reportStream()
          nonStreamCalls += 1
          if (nonStreamCalls === 1) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: '先看便宜信号。',
                    tool_calls: [
                      makeToolCall('call-1', 'sentiment'),
                      makeToolCall('call-2', 'twitter_signals'),
                    ],
                  },
                },
              ],
            }
          }
          return { choices: [{ message: { role: 'assistant', content: '可以生成报告。' } }] }
        }),
      },
    },
  }

  return {
    client,
    txEntries,
    researchRecords,
    reset() {
      txEntries.length = 0
      researchRecords.clear()
      txCounter = 0
      nonStreamCalls = 0
      client.chat.completions.create.mockClear()
    },
    txLogRepo: {
      async record(entry: { address: string; source: string; amount: string }) {
        txCounter += 1
        const txHash = `0x${txCounter.toString(16).padStart(64, '0')}`
        txEntries.push({ ...entry, txHash })
        return { id: `tx-${txCounter}`, txHash, createdAt: new Date('2026-06-25T00:00:00.000Z') }
      },
    },
    researchRepo: {
      async appendSpent(id: string, deltaUsdc: string) {
        const record = researchRecords.get(id) ?? { spentUsdc: '0', status: 'running', reportMd: null, errorMessage: null }
        record.spentUsdc = (Number(record.spentUsdc) + Number(deltaUsdc)).toFixed(4)
        researchRecords.set(id, record)
      },
      async setReport(id: string, reportMd: string) {
        const record = researchRecords.get(id) ?? { spentUsdc: '0', status: 'running', reportMd: null, errorMessage: null }
        record.reportMd = reportMd
        researchRecords.set(id, record)
      },
      async updateStatus(id: string, status: string, errorMessage?: string) {
        const record = researchRecords.get(id) ?? { spentUsdc: '0', status: 'running', reportMd: null, errorMessage: null }
        record.status = status
        record.errorMessage = errorMessage ?? null
        researchRecords.set(id, record)
      },
    },
  }
})

vi.mock('@/lib/llm/deepseek', () => ({
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  getDeepSeekClient: () => mockState.client,
}))

vi.mock('@/lib/db', () => ({
  txLogRepo: mockState.txLogRepo,
  researchRepo: mockState.researchRepo,
}))

beforeEach(() => {
  mockState.reset()
})

async function collectEvents(budgetUsdc = '0.01') {
  const { runResearchAgent } = await import('./research-agent')
  const events = []
  for await (const event of runResearchAgent({
    researchId: 'research-1',
    address: '0xabc',
    topic: 'PEPE 现在能进吗',
    budgetUsdc,
  })) {
    events.push(event)
  }
  return events
}

describe('runResearchAgent', () => {
  it('runs tool calls, records payments, streams report chunks, and finalizes research', async () => {
    const events = await collectEvents('0.01')

    expect(events.map((event) => event.type)).toContain('tool_call')
    expect(events.map((event) => event.type)).toContain('tool_result')
    expect(events.map((event) => event.type)).toContain('budget')
    expect(events.filter((event) => event.type === 'report_chunk')).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      reportMd: '# PEPE 研究报告\n建议：观望。',
      totalSpentUsdc: '0.0002',
      totalCalls: 2,
    })
    expect(mockState.txEntries.map((entry) => entry.source)).toEqual(['sentiment', 'twitter-signals'])
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'completed',
      spentUsdc: '0.0002',
      reportMd: '# PEPE 研究报告\n建议：观望。',
    })
  })

  it('stops tool execution when remaining budget is below the cheapest call', async () => {
    const events = await collectEvents('0.0001')

    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1)
    expect(mockState.txEntries.map((entry) => entry.source)).toEqual(['sentiment'])
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      totalSpentUsdc: '0.0001',
      totalCalls: 1,
    })
  })
})
