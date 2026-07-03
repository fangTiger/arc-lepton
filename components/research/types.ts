export type TxStatus = 'mock' | 'pending' | 'confirmed' | 'failed'

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; callId: string }
  | {
      type: 'tool_result'
      callId: string
      name: string
      payment: {
        amount: string
        txHash: string | null
        txStatus: TxStatus
        chainId: number | null
        blockNumber: string | null
        requestId: string
      }
      dataPreview: string
    }
  | { type: 'budget'; spentUsdc: string; remainingUsdc: string }
  | { type: 'report_chunk'; delta: string }
  | { type: 'final'; reportMd: string; totalSpentUsdc: string; totalCalls: number }
  | { type: 'error'; message: string }

export type ResearchRecord = {
  id: string
  address: string
  topic: string
  budgetUsdc: string
  spentUsdc: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  reportMd: string | null
  errorMessage: string | null
  startedAt: string
  completedAt: string | null
}

export type ResearchFollowUpRecord = {
  id: string
  researchId: string
  address: string
  question: string
  answerMd: string | null
  status: 'pending' | 'completed' | 'failed'
  spentUsdc: string
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}

export type TxLogRecord = {
  id: string
  address: string
  source: string
  amount: string
  txHash: string | null
  txStatus: TxStatus
  chainId: number | null
  blockNumber: string | null
  settlementId: string | null
  requestId: string | null
  errorMessage: string | null
  createdAt: string
}

function txLogRequestId(entry: TxLogRecord) {
  return entry.requestId ?? entry.id
}

function txLogDataPreview(entry: TxLogRecord) {
  return entry.errorMessage ?? '{}'
}

export function txLogToToolResultEvent(entry: TxLogRecord): Extract<AgentEvent, { type: 'tool_result' }> {
  const requestId = txLogRequestId(entry)
  return {
    type: 'tool_result',
    callId: requestId,
    name: entry.source,
    payment: {
      amount: entry.amount,
      txHash: entry.txHash,
      txStatus: entry.txStatus,
      chainId: entry.chainId,
      blockNumber: entry.blockNumber,
      requestId,
    },
    dataPreview: txLogDataPreview(entry),
  }
}

export function mergeTxLogIntoEvents<T extends AgentEvent>(events: T[], txLog: TxLogRecord[]): T[] {
  const txLogByRequestId = new Map<string, TxLogRecord>()
  for (const entry of txLog) {
    txLogByRequestId.set(txLogRequestId(entry), entry)
  }
  if (!txLogByRequestId.size) return events

  let changed = false
  const eventRequestIds = new Set<string>()
  const merged = events.map((event) => {
    if (event.type !== 'tool_result') return event
    eventRequestIds.add(event.payment.requestId)
    const txEntry = txLogByRequestId.get(event.payment.requestId)
    if (!txEntry) return event

    const nextPayment = {
      ...event.payment,
      txHash: txEntry.txHash,
      txStatus: txEntry.txStatus,
      chainId: txEntry.chainId,
      blockNumber: txEntry.blockNumber,
    }
    if (
      nextPayment.txHash === event.payment.txHash
      && nextPayment.txStatus === event.payment.txStatus
      && nextPayment.chainId === event.payment.chainId
      && nextPayment.blockNumber === event.payment.blockNumber
    ) {
      return event
    }

    changed = true
    return {
      ...event,
      payment: nextPayment,
    } as T
  })

  const missingEvents = txLog
    .filter((entry) => !eventRequestIds.has(txLogRequestId(entry)))
    .map((entry) => txLogToToolResultEvent(entry) as T)

  if (!missingEvents.length) return changed ? merged : events

  const terminalIndex = merged.findIndex((event) => event.type === 'final' || event.type === 'error')
  if (terminalIndex === -1) return [...merged, ...missingEvents]

  return [
    ...merged.slice(0, terminalIndex),
    ...missingEvents,
    ...merged.slice(terminalIndex),
  ]
}

export function isBillablePaymentStatus(status: TxStatus) {
  return status === 'mock' || status === 'confirmed'
}

export function shortHash(hash: string | null) {
  if (!hash) return 'not broadcast'
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

export function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 8)
}

export function paymentStatusLabel(status: TxStatus) {
  if (status === 'mock') return 'mock receipt'
  if (status === 'pending') return 'pending settlement'
  return status
}

export function utcTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  return date.toISOString().slice(11, 19)
}

export function utcDateTime(value: string | Date | null) {
  if (!value) return 'N/A'
  return new Date(value).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

export function durationSeconds(startedAt: string, completedAt: string | null) {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const start = new Date(startedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '0.0s'
  return `${((end - start) / 1000).toFixed(1)}s`
}

export function extractPreview(dataPreview: string) {
  try {
    const parsed = JSON.parse(dataPreview)
    if (typeof parsed.score === 'number') return `score ${parsed.score} (${parsed.trend ?? 'n/a'})`
    if (Array.isArray(parsed.topTweets)) return `${parsed.topTweets.length} tweets · sentiment ${parsed.overallSentiment}`
    if (Array.isArray(parsed.articles)) return `${parsed.articles.length} articles`
    if (Array.isArray(parsed.movements)) return `${parsed.movements.length} whale moves · net ${parsed.netFlowUsd}`
    if (parsed.pattern) return `${parsed.pattern} · confidence ${parsed.confidence}`
  } catch {
    return dataPreview.slice(0, 96)
  }
  return dataPreview.slice(0, 96)
}
