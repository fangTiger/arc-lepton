export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: Record<string, unknown>; callId: string }
  | { type: 'tool_result'; callId: string; name: string; payment: { amount: string; txHash: string }; dataPreview: string }
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

export type TxLogRecord = {
  id: string
  address: string
  source: string
  amount: string
  txHash: string
  createdAt: string
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 6)}...${hash.slice(-4)}`
}

export function shortId(id: string) {
  return id.replace(/-/g, '').slice(0, 8)
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
