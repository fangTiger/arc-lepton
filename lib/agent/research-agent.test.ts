import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  type MockResearchRecord = {
    spentUsdc: string
    budgetUsdc?: string
    status: string
    activationPhase?: string
    finalizationState?: string
    cancelRequestedAt?: Date | null
    expectedExpiresAt?: Date | null
    reportMd: string | null
    errorMessage: string | null
  }
  const paymentEntries: Array<{
    address: string
    source: string
    amount: string
    txHash: string | null
    txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
    chainId: number | null
    blockNumber: string | null
    requestId: string
    errorMessage: string | null
  }> = []
  const paymentReceiptCalls: Array<{ address: string; source: string; amount: string; requestId?: string; researchId?: string; signal?: AbortSignal }> = []
  const researchPaymentIntentCalls: Array<{
    address: string
    source: string
    amount: string
    requestId?: string
    researchId?: string
    paymentIntentId?: string
    toolOrdinal?: number
    researchKey?: string
    escrowAddress?: string
    registryRevision?: string
    expectedPayout?: string
    maxUnitPrice?: string
    registryReadBlock?: string
    payload?: unknown
    signal?: AbortSignal
  }> = []
  const dataSourceCalls: Array<{ source: string; token: string }> = []
  const sideEffectOrder: string[] = []
  const settlementCalls: Array<{ address: string; researchId: string }> = []
  const appendSpentEntries: Array<{ id: string; deltaUsdc: string }> = []
  const researchRecords = new Map<string, MockResearchRecord>()
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
        paymentIntentId?: string
        toolOrdinal?: number
        researchKey?: string
        escrowAddress?: string
        registryRevision?: string
        expectedPayout?: string
        maxUnitPrice?: string
        registryReadBlock?: string
        payload?: unknown
        signal?: AbortSignal
      }) => Promise<{
        id: string
        address: string
        source: string
        amount: string
        txHash: string | null
        txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
        chainId: number | null
        blockNumber: string | null
        requestId: string
        errorMessage: string | null
        createdAt: Date
      }>)
    = null
  let settlementImpl: null | ((input: { address: string; researchId: string }) => Promise<unknown>) = null

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
    dataSourceCalls,
    sideEffectOrder,
    researchRecords,
    reset() {
      paymentEntries.length = 0
      paymentReceiptCalls.length = 0
      researchPaymentIntentCalls.length = 0
      dataSourceCalls.length = 0
      sideEffectOrder.length = 0
      settlementCalls.length = 0
      appendSpentEntries.length = 0
      researchRecords.clear()
      txCounter = 0
      nonStreamCalls = 0
      failPayment = false
      reportStreamChunks = ['# PEPE Research Report\n', 'Action: wait for confirmation.']
      reportStreamImpl = null
      scriptedMessages = []
      paymentRecorderImpl = null
      settlementImpl = null
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
        paymentReceiptCalls.push(entry)
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
      async recordResearchPaymentIntent(entry: {
        address: string
        source: string
        amount: string
        requestId?: string
        researchId?: string
        paymentIntentId?: string
        toolOrdinal?: number
        researchKey?: string
        escrowAddress?: string
        registryRevision?: string
        expectedPayout?: string
        maxUnitPrice?: string
        registryReadBlock?: string
        payload?: unknown
        signal?: AbortSignal
      }) {
        researchPaymentIntentCalls.push(entry)
        sideEffectOrder.push(`intent:${entry.source}`)
        if (paymentRecorderImpl) return paymentRecorderImpl(entry)
        if (failPayment) {
          throw Object.assign(new Error('ARC receipt failed'), { code: 'PAYMENT_INTENT_FAILED' })
        }
        txCounter += 1
        const payment = {
          id: `tx-${txCounter}`,
          address: entry.address,
          source: entry.source,
          amount: entry.amount,
          txHash: null,
          txStatus: 'pending' as const,
          chainId: null,
          blockNumber: null,
          requestId: entry.paymentIntentId ?? entry.requestId ?? `call-${txCounter}`,
          errorMessage: null,
          createdAt: new Date('2026-06-25T00:00:00.000Z'),
        }
        paymentEntries.push(payment)
        return payment
      },
    },
    paymentReceiptCalls,
    researchPaymentIntentCalls,
    settlementCalls,
    setPaymentFailure(value: boolean) {
      failPayment = value
    },
    setPaymentRecorderImpl(impl: typeof paymentRecorderImpl) {
      paymentRecorderImpl = impl
    },
    setSettlementImpl(impl: typeof settlementImpl) {
      settlementImpl = impl
    },
    paymentSettlement: {
      async settleResearchPayments(input: { address: string; researchId: string }) {
        settlementCalls.push(input)
        if (settlementImpl) return settlementImpl(input)
        return {
          status: 'confirmed',
          settlementId: 'settlement-1',
          settledCount: paymentEntries.filter((entry) => entry.txStatus === 'pending').length,
          txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          chainId: 5_042_002,
          blockNumber: '12345',
        }
      },
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
          budgetUsdc: record.budgetUsdc ?? '0.01',
          spentUsdc: record.spentUsdc,
          status: record.status,
          activationPhase: record.activationPhase ?? 'active',
          finalizationState: record.finalizationState ?? 'open',
          cancelRequestedAt: record.cancelRequestedAt ?? null,
          expectedExpiresAt: Object.prototype.hasOwnProperty.call(record, 'expectedExpiresAt')
            ? record.expectedExpiresAt ?? null
            : new Date(Date.now() + 24 * 60 * 60 * 1000),
          reportMd: record.reportMd,
          errorMessage: record.errorMessage,
          startedAt: new Date('2026-06-25T00:00:00.000Z'),
          completedAt: null,
        }
      },
      async appendSpent(id: string, deltaUsdc: string) {
        appendSpentEntries.push({ id, deltaUsdc })
        const record = researchRecords.get(id) ?? runningResearchRecord()
        record.spentUsdc = (Number(record.spentUsdc) + Number(deltaUsdc)).toFixed(4)
        researchRecords.set(id, record)
      },
      async setReport(id: string, reportMd: string) {
        const record = researchRecords.get(id) ?? runningResearchRecord()
        record.reportMd = reportMd
        researchRecords.set(id, record)
      },
      async completeIfRunning(id: string, reportMd: string) {
        const record = researchRecords.get(id) ?? runningResearchRecord()
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
        const record = researchRecords.get(id) ?? runningResearchRecord()
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
        const record = researchRecords.get(id) ?? runningResearchRecord()
        record.status = status
        record.errorMessage = errorMessage ?? null
        researchRecords.set(id, record)
      },
    },
  }

  function runningResearchRecord(overrides: Partial<MockResearchRecord> = {}): MockResearchRecord {
    return {
      spentUsdc: '0',
      budgetUsdc: '0.01',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      cancelRequestedAt: null,
      expectedExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      reportMd: null,
      errorMessage: null,
      ...overrides,
    }
  }
})

vi.mock('@/lib/llm/deepseek', () => ({
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  getDeepSeekClient: () => mockState.client,
}))

vi.mock('@/lib/db', () => ({
  researchRepo: mockState.researchRepo,
}))

vi.mock('@/lib/data/mock-sources', () => ({
  buildKlinePatternData: (token: string) => mockDataSource('kline-pattern', token),
  buildNewsData: (token: string) => mockDataSource('news', token),
  buildSentimentData: (token: string) => mockDataSource('sentiment', token),
  buildTwitterSignalsData: (token: string) => mockDataSource('twitter-signals', token),
  buildWhaleWatchData: (token: string) => mockDataSource('whale-watch', token),
}))

vi.mock('@/lib/x402/payment-recorder', () => ({
  recordPaymentReceipt: mockState.paymentRecorder.recordPaymentReceipt,
  recordResearchPaymentIntent: mockState.paymentRecorder.recordResearchPaymentIntent,
}))

vi.mock('@/lib/x402/payment-settlement', () => ({
  settleResearchPayments: mockState.paymentSettlement.settleResearchPayments,
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

async function collectEscrowEvents() {
  const { runResearchAgent } = await import('./research-agent')
  const events = []
  if (!mockState.researchRecords.has('research-1')) {
    mockState.researchRecords.set('research-1', {
      spentUsdc: '0',
      budgetUsdc: '0.01',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      cancelRequestedAt: null,
      reportMd: null,
      errorMessage: null,
    })
  }
  for await (const event of runResearchAgent({
    researchId: 'research-1',
    address: '0xabc',
    topic: 'SHOULD I BUY PEPE?',
    budgetUsdc: '0.01',
    escrowPayment: escrowPaymentContext(),
  } as never)) {
    events.push(event)
  }
  return events
}

function mockDataSource(source: string, token: string) {
  mockState.dataSourceCalls.push({ source, token })
  mockState.sideEffectOrder.push(`data:${source}`)
  return { source, token, snapshot: 'mock-data' }
}

function escrowPaymentContext() {
  return {
    researchKey: `0x${'42'.repeat(32)}`,
    escrowAddress: '0x4444444444444444444444444444444444444444',
    registrySnapshots: {
      sentiment: {
        registryRevision: '7',
        expectedPayout: '0x5555555555555555555555555555555555555555',
        maxUnitPrice: '100',
        registryReadBlock: '1999998700',
      },
    },
  }
}

function runningEscrowRecord(overrides: Record<string, unknown> = {}) {
  return {
    spentUsdc: '0',
    budgetUsdc: '0.01',
    status: 'running',
    activationPhase: 'active',
    finalizationState: 'open',
    cancelRequestedAt: null,
    expectedExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    reportMd: null,
    errorMessage: null,
    ...overrides,
  }
}

function mergedReportChunks(events: Array<{ type: string; delta?: string }>) {
  return events.filter((event) => event.type === 'report_chunk').map((event) => event.delta ?? '').join('')
}

describe('runResearchAgent', () => {
  it('records a stable escrow payment intent snapshot before executing a paid data source', async () => {
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Use one source.',
        tool_calls: [mockState.makeToolCall('volatile-llm-call-id', 'sentiment')],
      },
    ])

    const events = await collectEscrowEvents()

    expect(events).toContainEqual({ type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'volatile-llm-call-id' })
    expect(mockState.sideEffectOrder.slice(0, 2)).toEqual([
      'intent:sentiment',
      'data:sentiment',
    ])
    expect(mockState.dataSourceCalls).toEqual([{ source: 'sentiment', token: 'PEPE' }])
    expect(mockState.researchPaymentIntentCalls[0]).toMatchObject({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      paymentIntentId: expect.any(String),
      toolOrdinal: 0,
      researchKey: `0x${'42'.repeat(32)}`,
      escrowAddress: '0x4444444444444444444444444444444444444444',
      registryRevision: '7',
      expectedPayout: '0x5555555555555555555555555555555555555555',
      maxUnitPrice: '100',
      registryReadBlock: '1999998700',
      payload: {
        tool: 'sentiment',
        args: { token: 'PEPE' },
      },
    })
    expect(mockState.researchPaymentIntentCalls[0]?.requestId).not.toBe('volatile-llm-call-id')
    expect(mockState.researchPaymentIntentCalls[0]?.paymentIntentId).not.toBe('volatile-llm-call-id')
  })

  it('does not execute a paid data source when escrow payment intent persistence fails', async () => {
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Use one source.',
        tool_calls: [mockState.makeToolCall('volatile-failing-call-id', 'sentiment')],
      },
    ])
    mockState.setPaymentRecorderImpl(async () => {
      throw Object.assign(new Error('intent persistence failed'), { code: 'INTENT_PERSISTENCE_FAILED' })
    })

    const events = await collectEscrowEvents()

    expect(events).toEqual([
      { type: 'thinking', text: 'Use one source.' },
      { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'volatile-failing-call-id' },
      { type: 'error', message: 'intent persistence failed' },
    ])
    expect(mockState.sideEffectOrder).toEqual(['intent:sentiment'])
    expect(mockState.dataSourceCalls).toEqual([])
    expect(mockState.appendSpentEntries).toEqual([])
    expect(events.some((event) => event.type === 'tool_result' || event.type === 'budget' || event.type === 'final')).toBe(false)
  })

  it('does not create an escrow payment intent once the research is closing', async () => {
    mockState.researchRecords.set('research-1', {
      spentUsdc: '0',
      budgetUsdc: '0.01',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'closing',
      cancelRequestedAt: null,
      reportMd: null,
      errorMessage: null,
    })
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Use one source.',
        tool_calls: [mockState.makeToolCall('closing-call-id', 'sentiment')],
      },
    ])

    const events = await collectEscrowEvents()

    expect(events).toEqual([{ type: 'error', message: 'Escrow research is not open for new payment intents' }])
    expect(mockState.client.chat.completions.create).not.toHaveBeenCalled()
    expect(mockState.researchPaymentIntentCalls).toEqual([])
    expect(mockState.dataSourceCalls).toEqual([])
    expect(mockState.appendSpentEntries).toEqual([])
  })

  it('does not reserve an escrow payment intent that would exceed the initial budget', async () => {
    mockState.researchRecords.set('research-1', {
      spentUsdc: '0.00995',
      budgetUsdc: '0.01',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      cancelRequestedAt: null,
      reportMd: null,
      errorMessage: null,
    })
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Use one source.',
        tool_calls: [mockState.makeToolCall('budget-call-id', 'sentiment')],
      },
    ])

    const events = await collectEscrowEvents()

    expect(events).toEqual([
      { type: 'thinking', text: 'Use one source.' },
      { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'budget-call-id' },
      { type: 'error', message: 'Escrow budget reservation exceeds initial budget' },
    ])
    expect(mockState.researchPaymentIntentCalls).toEqual([])
    expect(mockState.dataSourceCalls).toEqual([])
    expect(mockState.appendSpentEntries).toEqual([])
  })

  it('checks durable cancellation before the next LLM request in escrow mode', async () => {
    mockState.researchRecords.set('research-1', {
      spentUsdc: '0',
      budgetUsdc: '0.01',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      cancelRequestedAt: new Date('2026-07-11T06:05:00.000Z'),
      reportMd: null,
      errorMessage: null,
    })
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'This LLM call should not happen.',
        tool_calls: [mockState.makeToolCall('cancelled-before-llm', 'sentiment')],
      },
    ])

    const events = await collectEscrowEvents()

    expect(events).toEqual([{ type: 'error', message: 'Research cancelled' }])
    expect(mockState.client.chat.completions.create).not.toHaveBeenCalled()
    expect(mockState.researchPaymentIntentCalls).toEqual([])
    expect(mockState.dataSourceCalls).toEqual([])
    expect(mockState.appendSpentEntries).toEqual([])
  })

  it('stops before requesting tools when escrow expiry is inside the settlement safety window', async () => {
    mockState.researchRecords.set('research-1', {
      spentUsdc: '0',
      budgetUsdc: '0.01',
      status: 'running',
      activationPhase: 'active',
      finalizationState: 'open',
      cancelRequestedAt: null,
      expectedExpiresAt: new Date(Date.now() + 14 * 60 * 1000),
      reportMd: null,
      errorMessage: null,
    })
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'This LLM call should not happen because expiry is too close.',
        tool_calls: [mockState.makeToolCall('expiry-window-call', 'sentiment')],
      },
    ])

    const events = await collectEscrowEvents()

    expect(events).toEqual([{ type: 'error', message: 'ESCROW_EXPIRY_SAFETY_WINDOW' }])
    expect(mockState.client.chat.completions.create).not.toHaveBeenCalled()
    expect(mockState.researchPaymentIntentCalls).toEqual([])
    expect(mockState.dataSourceCalls).toEqual([])
    expect(mockState.appendSpentEntries).toEqual([])
  })

  it('checks durable cancellation after an escrow intent is persisted and before tool side effects', async () => {
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Use one source.',
        tool_calls: [mockState.makeToolCall('cancel-after-intent', 'sentiment')],
      },
    ])
    mockState.setPaymentRecorderImpl(async (entry) => {
      mockState.researchRecords.set('research-1', runningEscrowRecord({
        status: 'cancelled',
        finalizationState: 'closing',
        cancelRequestedAt: new Date('2026-07-11T06:06:00.000Z'),
        errorMessage: 'Research cancelled',
      }))
      return {
        id: 'tx-cancel-after-intent',
        address: entry.address,
        source: entry.source,
        amount: entry.amount,
        txHash: null,
        txStatus: 'pending',
        chainId: null,
        blockNumber: null,
        requestId: entry.paymentIntentId ?? 'cancel-after-intent',
        errorMessage: null,
        createdAt: new Date('2026-07-11T06:06:00.000Z'),
      }
    })

    const events = await collectEscrowEvents()

    expect(events).toEqual([
      { type: 'thinking', text: 'Use one source.' },
      { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'cancel-after-intent' },
      { type: 'error', message: 'Research cancelled' },
    ])
    expect(mockState.sideEffectOrder).toEqual(['intent:sentiment'])
    expect(mockState.researchPaymentIntentCalls).toHaveLength(1)
    expect(mockState.dataSourceCalls).toEqual([])
    expect(mockState.appendSpentEntries).toEqual([])
    await vi.waitFor(() => {
      expect(mockState.settlementCalls).toEqual([
        { address: '0xabc', researchId: 'research-1' },
      ])
    })
  })

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
        txHash: null,
        txStatus: 'pending',
        chainId: null,
        blockNumber: null,
      },
    })
    expect(mockState.researchPaymentIntentCalls.map((entry) => entry.requestId)).toEqual(['call-1', 'call-2'])
    expect(mockState.paymentReceiptCalls).toEqual([])
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

  it('emits the final event without waiting for research payment settlement to resolve', async () => {
    let releaseSettlement: () => void = () => {
      throw new Error('missing releaseSettlement')
    }
    let settlementResolved = false
    const settlementGate = new Promise<void>((resolve) => {
      releaseSettlement = resolve
    })
    mockState.setSettlementImpl(async () => {
      await settlementGate
      settlementResolved = true
      return { status: 'confirmed' }
    })

    const result = await Promise.race([
      collectEvents('0.01'),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 20)),
    ])

    expect(result).not.toBe('timed-out')
    const events = result as Awaited<ReturnType<typeof collectEvents>>
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      totalSpentUsdc: '0.0002',
      totalCalls: 2,
    })
    await vi.waitFor(() => {
      expect(mockState.settlementCalls).toEqual([
        { address: '0xabc', researchId: 'research-1' },
      ])
    })
    expect(settlementResolved).toBe(false)

    releaseSettlement()
    await vi.waitFor(() => {
      expect(settlementResolved).toBe(true)
    })
  })

  it('keeps completed research completed when async settlement fails after final', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockState.setSettlementImpl(async () => {
      throw new Error('settlement RPC timeout')
    })

    const events = await collectEvents('0.01')

    expect(events.at(-1)).toMatchObject({
      type: 'final',
      totalSpentUsdc: '0.0002',
      totalCalls: 2,
    })
    await vi.waitFor(() => {
      expect(mockState.settlementCalls).toEqual([
        { address: '0xabc', researchId: 'research-1' },
      ])
    })
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'completed',
      spentUsdc: '0.0002',
    })
  })

  it('settles pending intents when the research fails after paid tool calls completed', async () => {
    mockState.setReportStreamImpl(async function* () {
      throw new Error('final report timeout')
    })

    const events = await collectEvents('0.01')

    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'final report timeout',
    })
    await vi.waitFor(() => {
      expect(mockState.settlementCalls).toEqual([
        { address: '0xabc', researchId: 'research-1' },
      ])
    })
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'failed',
      spentUsdc: '0.0002',
      errorMessage: 'final report timeout',
    })
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

  it('caps paid tool execution at three calls even when the model asks for more', async () => {
    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: 'Collect every available data source.',
        tool_calls: [
          mockState.makeToolCall('limit-call-1', 'sentiment'),
          mockState.makeToolCall('limit-call-2', 'twitter_signals'),
          mockState.makeToolCall('limit-call-3', 'whale_watch'),
          mockState.makeToolCall('limit-call-4', 'news'),
          mockState.makeToolCall('limit-call-5', 'kline_pattern'),
        ],
      },
    ])

    const events = await collectEvents('0.01')
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
    const toolMessages = (streamParams?.messages ?? []).filter((message) => message.role === 'tool')
    const toolMessagesById = new Map(toolMessages.map((message) => [message.tool_call_id, message]))

    expect(events.filter((event) => event.type === 'tool_call')).toHaveLength(3)
    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(3)
    expect(mockState.researchPaymentIntentCalls.map((entry) => entry.requestId)).toEqual([
      'limit-call-1',
      'limit-call-2',
      'limit-call-3',
    ])
    expect(mockState.appendSpentEntries).toEqual([
      { id: 'research-1', deltaUsdc: '0.0001' },
      { id: 'research-1', deltaUsdc: '0.0001' },
      { id: 'research-1', deltaUsdc: '0.0002' },
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'final',
      totalSpentUsdc: '0.0004',
      totalCalls: 3,
    })
    expect(JSON.parse(toolMessagesById.get('limit-call-4')?.content ?? 'null')).toMatchObject({
      status: 'skipped',
      reason: 'tool_call_limit_reached',
      name: 'news',
    })
    expect(JSON.parse(toolMessagesById.get('limit-call-5')?.content ?? 'null')).toMatchObject({
      status: 'skipped',
      reason: 'tool_call_limit_reached',
      name: 'kline_pattern',
    })
    expect(mockState.client.chat.completions.create.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('Use at most 3 paid data-source calls'),
          }),
        ]),
      }),
    )
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
        txHash: null,
        txStatus: 'pending',
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
    await vi.waitFor(() => {
      expect(mockState.settlementCalls).toEqual([
        { address: '0xabc', researchId: 'research-1' },
      ])
    })
    expect(mockState.researchRecords.get('research-1')).toMatchObject({
      status: 'cancelled',
      spentUsdc: '0',
      reportMd: null,
      errorMessage: 'Research cancelled',
    })
  })

  it('settles a pending intent when cancellation happens after the recorder claim and before it returns', async () => {
    const abortController = new AbortController()

    mockState.setAssistantMessages([
      {
        role: 'assistant',
        content: null,
        tool_calls: [mockState.makeToolCall('post-claim-abort', 'sentiment')],
      },
    ])
    mockState.setPaymentRecorderImpl(async (entry) => {
      mockState.paymentEntries.push({
        address: entry.address,
        source: entry.source,
        amount: entry.amount,
        txHash: null,
        txStatus: 'pending',
        chainId: null,
        blockNumber: null,
        requestId: entry.requestId ?? 'post-claim-abort',
        errorMessage: null,
      })
      abortController.abort()
      throw new Error('Research cancelled')
    })

    const events = await collectEventsWithOptions({ signal: abortController.signal })

    expect(events).toEqual([
      { type: 'tool_call', name: 'sentiment', args: { token: 'PEPE' }, callId: 'post-claim-abort' },
      { type: 'error', message: 'Research cancelled' },
    ])
    expect(mockState.appendSpentEntries).toEqual([])
    expect(events.some((event) => event.type === 'tool_result' || event.type === 'budget' || event.type === 'final')).toBe(false)
    await vi.waitFor(() => {
      expect(mockState.settlementCalls).toEqual([
        { address: '0xabc', researchId: 'research-1' },
      ])
    })
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
        txHash: null,
        txStatus: 'pending',
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
    await vi.waitFor(() => {
      expect(mockState.settlementCalls).toEqual([
        { address: '0xabc', researchId: 'research-1' },
      ])
    })
  })
})
