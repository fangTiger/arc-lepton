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
    yield { choices: [{ delta: { content: '# PEPE Research Report\n' } }] }
    yield { choices: [{ delta: { content: 'Action: wait for confirmation.' } }] }
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
                    content: 'Check low-cost signals first.',
                    tool_calls: [
                      makeToolCall('call-1', 'sentiment'),
                      makeToolCall('call-2', 'twitter_signals'),
                    ],
                  },
                },
              ],
            }
          }
          return { choices: [{ message: { role: 'assistant', content: 'Ready to generate the report.' } }] }
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
    topic: 'SHOULD I BUY PEPE?',
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
      reportMd: '# PEPE Research Report\nAction: wait for confirmation.',
      totalSpentUsdc: '0.0002',
      totalCalls: 2,
    })
    expect(mockState.txEntries.map((entry) => entry.source)).toEqual(['sentiment', 'twitter-signals'])
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'completed',
      spentUsdc: '0.0002',
      reportMd: '# PEPE Research Report\nAction: wait for confirmation.',
    })
    expect(mockState.client.chat.completions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('You are the SIGNAL/LEDGER research agent.'),
          }),
        ]),
      }),
    )
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
