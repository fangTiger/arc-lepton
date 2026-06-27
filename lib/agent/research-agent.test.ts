import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const paymentEntries: Array<{
    address: string
    source: string
    amount: string
    txHash: string
    txStatus: 'mock' | 'confirmed' | 'failed'
    chainId: number | null
    blockNumber: string | null
    requestId: string
    errorMessage: string | null
  }> = []
  const appendSpentEntries: Array<{ id: string; deltaUsdc: string }> = []
  const researchRecords = new Map<string, { spentUsdc: string; status: string; reportMd: string | null; errorMessage: string | null }>()
  let txCounter = 0
  let nonStreamCalls = 0
  let failPayment = false
  let reportStreamChunks = ['# PEPE Research Report\n', 'Action: wait for confirmation.']
  let reportStreamImpl: null | (() => AsyncIterable<{ choices: Array<{ delta: { content: string } }> }>) = null
  let scriptedMessages: Array<{
    role: 'assistant'
    content: string | null
    tool_calls?: Array<ReturnType<typeof makeToolCall>>
  }> = []
  let cancelBeforeComplete = false
  let completeBeforeFailureStatusUpdate = false
  let cancelBeforeFailureStatusUpdate = false
  let paymentRecorderImpl:
    | null
    | ((entry: {
        address: string
        source: string
        amount: string
        requestId?: string
        researchId?: string
        signal?: AbortSignal
      }) => Promise<{
        id: string
        address: string
        source: string
        amount: string
        txHash: string
        txStatus: 'mock' | 'confirmed' | 'failed'
        chainId: number | null
        blockNumber: string | null
        requestId: string
        errorMessage: string | null
        createdAt: Date
      }>)
    = null

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
    if (reportStreamImpl) {
      yield* reportStreamImpl()
      return
    }
    for (const content of reportStreamChunks) {
      yield { choices: [{ delta: { content } }] }
    }
  }

  type MockCompletionParams = {
    stream?: boolean
    messages?: Array<{
      role: string
      content: string | null
      name?: string
      tool_call_id?: string
      tool_calls?: Array<{ id: string }>
    }>
  }

  type MockRequestOptions = {
    signal?: AbortSignal
  }

  const client = {
    chat: {
      completions: {
        create: vi.fn(async (params: MockCompletionParams, _requestOptions?: MockRequestOptions) => {
          if (params.stream) return reportStream()
          nonStreamCalls += 1
          const scriptedMessage = scriptedMessages.shift()
          if (scriptedMessage) {
            return {
              choices: [{ message: scriptedMessage }],
            }
          }
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
    makeToolCall,
    paymentEntries,
    appendSpentEntries,
    researchRecords,
    reset() {
      paymentEntries.length = 0
      appendSpentEntries.length = 0
      researchRecords.clear()
      txCounter = 0
      nonStreamCalls = 0
      failPayment = false
      reportStreamChunks = ['# PEPE Research Report\n', 'Action: wait for confirmation.']
      reportStreamImpl = null
      scriptedMessages = []
      paymentRecorderImpl = null
      cancelBeforeComplete = false
      completeBeforeFailureStatusUpdate = false
      cancelBeforeFailureStatusUpdate = false
      client.chat.completions.create.mockClear()
    },
    setReportStreamChunks(chunks: string[]) {
      reportStreamChunks = [...chunks]
    },
    setReportStreamImpl(impl: typeof reportStreamImpl) {
      reportStreamImpl = impl
    },
    setAssistantMessages(messages: Array<{ role: 'assistant'; content: string | null; tool_calls?: Array<ReturnType<typeof makeToolCall>> }>) {
      scriptedMessages = [...messages]
    },
    paymentRecorder: {
      async recordPaymentReceipt(entry: {
        address: string
        source: string
        amount: string
        requestId?: string
        researchId?: string
        signal?: AbortSignal
      }) {
        if (paymentRecorderImpl) return paymentRecorderImpl(entry)
        if (failPayment) {
          throw Object.assign(new Error('ARC receipt failed'), { code: 'PAYMENT_RECEIPT_FAILED' })
        }
        txCounter += 1
        const txHash = `0x${txCounter.toString(16).padStart(64, '0')}`
        const payment = {
          id: `tx-${txCounter}`,
          address: entry.address,
          source: entry.source,
          amount: entry.amount,
          txHash,
          txStatus: 'mock' as const,
          chainId: null,
          blockNumber: null,
          requestId: entry.requestId ?? `call-${txCounter}`,
          errorMessage: null,
          createdAt: new Date('2026-06-25T00:00:00.000Z'),
        }
        paymentEntries.push(payment)
        return payment
      },
    },
    setPaymentFailure(value: boolean) {
      failPayment = value
    },
    setPaymentRecorderImpl(impl: typeof paymentRecorderImpl) {
      paymentRecorderImpl = impl
    },
    cancelBeforeComplete() {
      cancelBeforeComplete = true
    },
    completeBeforeFailureStatusUpdate() {
      completeBeforeFailureStatusUpdate = true
    },
    cancelBeforeFailureStatusUpdate() {
      cancelBeforeFailureStatusUpdate = true
    },
    researchRepo: {
      async findById(id: string) {
        const record = researchRecords.get(id)
        if (!record) return null
        return {
          id,
          address: '0xabc',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: record.spentUsdc,
          status: record.status,
          reportMd: record.reportMd,
          errorMessage: record.errorMessage,
          startedAt: new Date('2026-06-25T00:00:00.000Z'),
          completedAt: null,
        }
      },
      async appendSpent(id: string, deltaUsdc: string) {
        appendSpentEntries.push({ id, deltaUsdc })
        const record = researchRecords.get(id) ?? { spentUsdc: '0', status: 'running', reportMd: null, errorMessage: null }
        record.spentUsdc = (Number(record.spentUsdc) + Number(deltaUsdc)).toFixed(4)
        researchRecords.set(id, record)
      },
      async setReport(id: string, reportMd: string) {
        const record = researchRecords.get(id) ?? { spentUsdc: '0', status: 'running', reportMd: null, errorMessage: null }
        record.reportMd = reportMd
        researchRecords.set(id, record)
      },
      async completeIfRunning(id: string, reportMd: string) {
        const record = researchRecords.get(id) ?? { spentUsdc: '0', status: 'running', reportMd: null, errorMessage: null }
        if (cancelBeforeComplete) {
          record.status = 'cancelled'
          record.errorMessage = 'Research cancelled'
          researchRecords.set(id, record)
        }
        if (record.status !== 'running') return false
        record.reportMd = reportMd
        record.status = 'completed'
        record.errorMessage = null
        researchRecords.set(id, record)
        return true
      },
      async updateStatusIfCurrent(id: string, expectedStatus: string, status: string, errorMessage?: string) {
        const record = researchRecords.get(id) ?? { spentUsdc: '0', status: 'running', reportMd: null, errorMessage: null }
        if (completeBeforeFailureStatusUpdate) {
          completeBeforeFailureStatusUpdate = false
          record.status = 'completed'
          record.reportMd = '# Winner report'
          record.errorMessage = null
          researchRecords.set(id, record)
        }
        if (cancelBeforeFailureStatusUpdate) {
          cancelBeforeFailureStatusUpdate = false
          record.status = 'cancelled'
          record.errorMessage = 'Research cancelled'
          researchRecords.set(id, record)
        }
        if (record.status !== expectedStatus) return false
        record.status = status
        record.errorMessage = errorMessage ?? null
        researchRecords.set(id, record)
        return true
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
  researchRepo: mockState.researchRepo,
}))

vi.mock('@/lib/x402/payment-recorder', () => ({
  recordPaymentReceipt: mockState.paymentRecorder.recordPaymentReceipt,
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

async function collectEventsWithOptions(opts?: { budgetUsdc?: string; signal?: AbortSignal }) {
  const { runResearchAgent } = await import('./research-agent')
  const events = []
  for await (const event of runResearchAgent({
    researchId: 'research-1',
    address: '0xabc',
    topic: 'SHOULD I BUY PEPE?',
    budgetUsdc: opts?.budgetUsdc ?? '0.01',
    signal: opts?.signal,
  })) {
    events.push(event)
  }
  return events
}

function mergedReportChunks(events: Array<{ type: string; delta?: string }>) {
  return events.filter((event) => event.type === 'report_chunk').map((event) => event.delta ?? '').join('')
}

describe('runResearchAgent', () => {
  it('runs tool calls, records payments, streams report chunks, and finalizes research', async () => {
    const events = await collectEvents('0.01')
    const reportText = mergedReportChunks(events)
    const streamParams = mockState.client.chat.completions.create.mock.calls.at(-1)?.[0] as
      | {
          stream?: boolean
          messages?: Array<{
            role: string
            content: string | null
          }>
        }
      | undefined

    expect(events.map((event) => event.type)).toContain('tool_call')
    expect(events.map((event) => event.type)).toContain('tool_result')
    expect(events.map((event) => event.type)).toContain('budget')
    expect(events.filter((event) => event.type === 'report_chunk')).toEqual([
      { type: 'report_chunk', delta: '# PEPE Research Report\n' },
      { type: 'report_chunk', delta: 'Action: wait for confirmation.' },
    ])
    expect(reportText).toBe('# PEPE Research Report\nAction: wait for confirmation.')
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      reportMd: '# PEPE Research Report\nAction: wait for confirmation.',
      totalSpentUsdc: '0.0002',
      totalCalls: 2,
    })
    expect(mockState.paymentEntries.map((entry) => entry.source)).toEqual(['sentiment', 'twitter-signals'])
    expect(events.find((event) => event.type === 'tool_result')).toMatchObject({
      type: 'tool_result',
      payment: {
        txStatus: 'mock',
        chainId: null,
        blockNumber: null,
      },
    })
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'completed',
      spentUsdc: '0.0002',
      reportMd: '# PEPE Research Report\nAction: wait for confirmation.',
    })
    expect(mockState.client.chat.completions.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('You are the SIGNAL/LEDGER research agent.'),
          }),
        ]),
      }),
    )
    expect(streamParams?.messages?.at(-1)?.content).toContain('FINAL REPORT MODE')
    expect(streamParams?.messages?.at(-1)?.content).toContain('Do not call any tools')
  })

  it('replaces dirty final report streams with a deterministic fallback report', async () => {
    mockState.setReportStreamChunks([
      'Let me get some additional data with the remaining tools to enrich the report.\n',
      '<||DSML||tool_calls><invoke name="news"><parameter name="token">PEPE</parameter></invoke>',
    ])

    const events = await collectEvents('0.01')
    const reportText = mergedReportChunks(events)
    const finalEvent = events.at(-1)
    const forbiddenMarkers = [
      'DSML',
      'tool_calls',
      'invoke name',
      'parameter name',
      'Let me get some additional data',
    ]

    expect(finalEvent).toMatchObject({
      type: 'final',
      totalSpentUsdc: '0.0002',
      totalCalls: 2,
    })
    expect(reportText).toContain('Completed data sources')
    expect(reportText).toContain('Payment trace')
    expect(reportText).toContain('Limitations')
    expect(finalEvent).toMatchObject({
      reportMd: reportText,
    })
    for (const marker of forbiddenMarkers) {
      expect(reportText).not.toContain(marker)
      expect((finalEvent as { reportMd: string }).reportMd).not.toContain(marker)
    }
  })

  it('stops tool execution when remaining budget is below the cheapest call', async () => {
    const events = await collectEvents('0.0001')

    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1)
    expect(mockState.paymentEntries.map((entry) => entry.source)).toEqual(['sentiment'])
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      totalSpentUsdc: '0.0001',
      totalCalls: 1,
    })
  })

  it('keeps tool_call history balanced when budget skips later tool calls', async () => {
    await collectEvents('0.0001')

    const streamParams = mockState.client.chat.completions.create.mock.calls.at(-1)?.[0] as
      | {
          stream?: boolean
          messages?: Array<{
            role: string
            content: string | null
            name?: string
            tool_call_id?: string
            tool_calls?: Array<{ id: string }>
          }>
        }
      | undefined

    expect(streamParams?.stream).toBe(true)

    const toolMessages = (streamParams?.messages ?? []).filter((message) => message.role === 'tool')
    const toolMessagesById = new Map(toolMessages.map((message) => [message.tool_call_id, message]))

    expect(streamParams?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          tool_calls: expect.arrayContaining([
            expect.objectContaining({ id: 'call-1' }),
            expect.objectContaining({ id: 'call-2' }),
          ]),
        }),
      ]),
    )

    expect(JSON.parse(toolMessagesById.get('call-1')?.content ?? 'null')).toMatchObject({
      payment: {
        amount: '0.0001',
        requestId: 'call-1',
      },
    })
    expect(JSON.parse(toolMessagesById.get('call-2')?.content ?? 'null')).toMatchObject({
      status: 'skipped',
      reason: 'budget_exceeded',
      name: 'twitter_signals',
    })
  })

  it('keeps unknown_tool calls balanced without charging the research', async () => {
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Try a tool we do not support.',
        tool_calls: [mockState.makeToolCall('unknown-call-1', 'mystery_feed')],
      },
    ])

    const events = await collectEvents('0.01')

    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(0)
    expect(mockState.paymentEntries).toHaveLength(0)
    expect(mockState.appendSpentEntries).toHaveLength(0)

    const streamParams = mockState.client.chat.completions.create.mock.calls.at(-1)?.[0] as
      | {
          stream?: boolean
          messages?: Array<{
            role: string
            content: string | null
            name?: string
            tool_call_id?: string
          }>
        }
      | undefined

    expect(streamParams?.stream).toBe(true)
    const unknownToolMessage = (streamParams?.messages ?? []).find((message) => message.tool_call_id === 'unknown-call-1')
    expect(JSON.parse(unknownToolMessage?.content ?? 'null')).toMatchObject({
      status: 'error',
      reason: 'unknown_tool',
      name: 'mystery_feed',
    })
  })

  it('keeps duplicate_tool calls balanced without charging twice', async () => {
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Start with sentiment.',
        tool_calls: [mockState.makeToolCall('dup-call-1', 'sentiment', 'DOGE')],
      },
      {
        role: 'assistant',
        content: 'Check sentiment again.',
        tool_calls: [mockState.makeToolCall('dup-call-2', 'sentiment', ' doge ')],
      },
    ])

    const events = await collectEvents('0.01')

    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1)
    expect(mockState.paymentEntries.map((entry) => entry.requestId)).toEqual(['dup-call-1'])
    expect(mockState.appendSpentEntries).toEqual([{ id: 'research-1', deltaUsdc: '0.0001' }])

    const streamParams = mockState.client.chat.completions.create.mock.calls.at(-1)?.[0] as
      | {
          stream?: boolean
          messages?: Array<{
            role: string
            content: string | null
            name?: string
            tool_call_id?: string
          }>
        }
      | undefined

    expect(streamParams?.stream).toBe(true)
    const duplicateToolMessage = (streamParams?.messages ?? []).find((message) => message.tool_call_id === 'dup-call-2')
    expect(JSON.parse(duplicateToolMessage?.content ?? 'null')).toMatchObject({
      status: 'skipped',
      reason: 'duplicate_tool',
      name: 'sentiment',
      argsKey: 'sentiment:{"token":"DOGE"}',
      arguments: { token: 'DOGE' },
    })
  })

  it('allows the same tool to run for different tokens and still charges both calls', async () => {
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Check DOGE first.',
        tool_calls: [mockState.makeToolCall('doge-call', 'sentiment', 'DOGE')],
      },
      {
        role: 'assistant',
        content: 'Now compare SHIB.',
        tool_calls: [mockState.makeToolCall('shib-call', 'sentiment', 'SHIB')],
      },
    ])

    const events = await collectEvents('0.01')
    const toolResults = events.filter((event) => event.type === 'tool_result')

    expect(toolResults).toHaveLength(2)
    expect(events.filter((event) => event.type === 'tool_call')).toHaveLength(2)
    expect(mockState.paymentEntries.map((entry) => entry.requestId)).toEqual(['doge-call', 'shib-call'])
    expect(mockState.appendSpentEntries).toEqual([
      { id: 'research-1', deltaUsdc: '0.0001' },
      { id: 'research-1', deltaUsdc: '0.0001' },
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      totalSpentUsdc: '0.0002',
      totalCalls: 2,
    })
  })

  it('passes the shared abort signal into non-stream requests and stops before yielding late thinking', async () => {
    const abortController = new AbortController()

    mockState.client.chat.completions.create.mockImplementationOnce(async (_params, requestOptions?: { signal?: AbortSignal }) => {
      abortController.abort()
      return {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'This should never reach the UI.',
              tool_calls: [mockState.makeToolCall('late-call-1', 'sentiment')],
            },
          },
        ],
      }
    })

    const events = await collectEventsWithOptions({ signal: abortController.signal })

    expect(mockState.client.chat.completions.create.mock.calls[0]?.[1]).toMatchObject({
      signal: abortController.signal,
    })
    expect(events).toEqual([{ type: 'error', message: 'Research cancelled' }])
    expect(mockState.paymentEntries).toHaveLength(0)
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'cancelled',
      errorMessage: 'Research cancelled',
    })
  })

  it('passes the shared abort signal into the final report stream request', async () => {
    const abortController = new AbortController()

    await collectEventsWithOptions({ signal: abortController.signal })

    expect(mockState.client.chat.completions.create.mock.calls.at(-1)?.[1]).toMatchObject({
      signal: abortController.signal,
    })
  })

  it('stops final report streaming when cancellation happens after the first report chunk', async () => {
    const abortController = new AbortController()

    mockState.setReportStreamImpl(async function* () {
      yield { choices: [{ delta: { content: '# Partial report\n' } }] }
      abortController.abort()
      yield { choices: [{ delta: { content: 'This chunk should not be emitted.' } }] }
    })

    const events = await collectEventsWithOptions({ signal: abortController.signal })

    expect(events.filter((event) => event.type === 'report_chunk')).toEqual([
      { type: 'report_chunk', delta: '# Partial report\n' },
    ])
    expect(events.some((event) => event.type === 'final')).toBe(false)
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Research cancelled' })
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'cancelled',
      reportMd: null,
      errorMessage: 'Research cancelled',
    })
  })

  it('does not mark completed or emit final when the research is cancelled before final persistence', async () => {
    mockState.cancelBeforeComplete()

    const events = await collectEvents('0.01')

    expect(events.some((event) => event.type === 'final')).toBe(false)
    expect(mergedReportChunks(events)).toBe('# PEPE Research Report\nAction: wait for confirmation.')
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'cancelled',
      reportMd: null,
      errorMessage: 'Research cancelled',
    })
  })

  it('cancels cleanly after a tool payment returns and before any billing or terminal success is emitted', async () => {
    const abortController = new AbortController()

    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [mockState.makeToolCall('cancel-after-payment', 'sentiment')],
      },
    ])
    mockState.setPaymentRecorderImpl(async (entry) => {
      expect(entry.signal).toBe(abortController.signal)
      abortController.abort()
      return {
        id: 'tx-cancelled',
        address: entry.address,
        source: entry.source,
        amount: entry.amount,
        txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        txStatus: 'mock',
        chainId: null,
        blockNumber: null,
        requestId: entry.requestId ?? 'cancel-after-payment',
        errorMessage: null,
        createdAt: new Date('2026-06-25T00:00:00.000Z'),
      }
    })

    const events = await collectEventsWithOptions({ signal: abortController.signal })

    expect(events).toEqual([
      { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'cancel-after-payment' },
      { type: 'error', message: 'Research cancelled' },
    ])
    expect(mockState.appendSpentEntries).toEqual([])
    expect(events.some((event) => event.type === 'tool_result' || event.type === 'budget' || event.type === 'final')).toBe(false)
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'cancelled',
      spentUsdc: '0',
      reportMd: null,
      errorMessage: 'Research cancelled',
    })
  })

  it('marks research failed and emits an error when payment receipt recording fails', async () => {
    mockState.setPaymentFailure(true)

    const events = await collectEvents('0.01')
    const requestMessages = mockState.client.chat.completions.create.mock.calls.at(0)?.[0]?.messages as
      | Array<{
          role: string
          content: string | null
          name?: string
          tool_call_id?: string
        }>
      | undefined
    const failedToolMessage = (requestMessages ?? []).find((message) => message.tool_call_id === 'call-1')

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: 'ARC receipt failed',
    })
    expect(JSON.parse(failedToolMessage?.content ?? 'null')).toMatchObject({
      status: 'error',
      reason: 'execution_failed',
      name: 'sentiment',
      message: 'ARC receipt failed',
    })
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'failed',
      errorMessage: 'ARC receipt failed',
    })
  })

  it('does not overwrite a completed terminal state when failure cleanup loses the running-status race', async () => {
    mockState.setPaymentFailure(true)
    mockState.completeBeforeFailureStatusUpdate()

    const events = await collectEvents('0.01')

    expect(events).toEqual([
      { type: 'thinking', text: 'Check low-cost signals first.' },
      { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'call-1' },
    ])
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'completed',
      reportMd: '# Winner report',
      errorMessage: null,
    })
  })

  it('still emits a cancellation terminal event when the cancel route already won the status race', async () => {
    const abortController = new AbortController()

    mockState.cancelBeforeFailureStatusUpdate()
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [mockState.makeToolCall('route-cancel-race', 'sentiment')],
      },
    ])
    mockState.setPaymentRecorderImpl(async (entry) => {
      abortController.abort()
      return {
        id: 'tx-route-cancel-race',
        address: entry.address,
        source: entry.source,
        amount: entry.amount,
        txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        txStatus: 'mock',
        chainId: null,
        blockNumber: null,
        requestId: entry.requestId ?? 'route-cancel-race',
        errorMessage: null,
        createdAt: new Date('2026-06-25T00:00:00.000Z'),
      }
    })

    const events = await collectEventsWithOptions({ signal: abortController.signal })

    expect(events).toEqual([
      { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'route-cancel-race' },
      { type: 'error', message: 'Research cancelled' },
    ])
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'cancelled',
      errorMessage: 'Research cancelled',
    })
  })
})
