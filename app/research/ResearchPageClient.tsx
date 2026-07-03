'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AgentLogStream } from '@/components/research/AgentLogStream'
import { BudgetMeter } from '@/components/research/BudgetMeter'
import { TerminalMarkdown } from '@/components/research/TerminalMarkdown'
import { TxFeed } from '@/components/research/TxFeed'
import type { AgentEvent, ResearchFollowUpRecord, ResearchRecord, TxLogRecord } from '@/components/research/types'
import { mergeTxLogIntoEvents, utcDateTime, utcTime } from '@/components/research/types'

type TimedEvent = AgentEvent & { receivedAt?: string }

type QuotaBucket = {
  used: number
  limit: number
  remaining: number
  resetAt: string
}

type QuotaStatus = {
  wallet: QuotaBucket
  global: QuotaBucket
}

const promptPool = [
  'SHOULD I BUY PEPE?',
  'BTC PRICE PREDICTION',
  'SOL ECOSYSTEM HEALTH',
  'MEME COIN MOMENTUM',
  'ETH GAS TREND',
  'DOGE VS SHIB',
  'IS THIS ALT SZN?',
  'STABLECOIN RISK CHECK',
  'WHO LEADS L2 FLOW?',
  'CAN BASE KEEP RUNNING?',
  'WHAT ARE WHALES BUYING?',
  'WHICH NARRATIVE IS HOT?',
]

const TOPIC_ROTATE_MS = 4_500
const VISIBLE_QUICK_PROMPTS = 6
const TX_LOG_POLL_MS = 5_000
const MAX_ESTIMATED_PAID_CALLS = 3

function shufflePrompts(prompts: string[]) {
  const shuffled = [...prompts]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
  }
  return shuffled
}

function estimatedCalls(budget: string) {
  const numeric = Number(budget)
  if (!Number.isFinite(numeric)) return '0'
  const baseline = Math.min(MAX_ESTIMATED_PAID_CALLS, Math.max(1, Math.floor(numeric / 0.0012)))
  const upper = Math.min(MAX_ESTIMATED_PAID_CALLS, baseline + 2)
  return baseline === upper ? String(baseline) : `${baseline}-${upper}`
}

function formatBudget(value: number) {
  return value.toFixed(4)
}

function quotaBar(bucket: QuotaBucket) {
  const width = 10
  const ratio = bucket.limit > 0 ? bucket.used / bucket.limit : 1
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)))
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

function quotaTone(bucket: QuotaBucket) {
  const ratio = bucket.limit > 0 ? bucket.used / bucket.limit : 1
  if (ratio >= 1) return 'text-red'
  if (ratio >= 0.8) return 'text-yellow'
  return 'text-amber'
}

function resetIn(resetAt: string) {
  const ms = Math.max(0, Date.parse(resetAt) - Date.now())
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return `${hours}h ${minutes}m`
}

function quotaExceededReason(quota: QuotaStatus | null) {
  if (!quota) return null
  if (quota.wallet.remaining <= 0) return 'Wallet daily quota reached'
  if (quota.global.remaining <= 0) return 'Global daily quota reached'
  return null
}

function persistedEvent(record: ResearchRecord): TimedEvent | null {
  const receivedAt = record.completedAt ? utcTime(new Date(record.completedAt)) : utcTime()
  if (record.status === 'completed' && record.reportMd) {
    return {
      type: 'final',
      reportMd: record.reportMd,
      totalSpentUsdc: record.spentUsdc,
      totalCalls: 0,
      receivedAt,
    }
  }
  if ((record.status === 'failed' || record.status === 'cancelled') && record.errorMessage) {
    return { type: 'error', message: record.errorMessage, receivedAt }
  }
  if (record.status === 'cancelled') return { type: 'error', message: 'Research cancelled', receivedAt }
  return null
}

function hasTerminalEvent(events: TimedEvent[]) {
  return events.some((event) => event.type === 'final' || event.type === 'error')
}

function hasPendingPayment(events: TimedEvent[]) {
  return events.some((event) => event.type === 'tool_result' && event.payment.txStatus === 'pending')
}

function followUpStatusTone(status: ResearchFollowUpRecord['status']) {
  if (status === 'completed') return 'text-green'
  if (status === 'failed') return 'text-red'
  return 'text-cyan'
}

function followUpStatusLabel(status: ResearchFollowUpRecord['status']) {
  if (status === 'completed') return 'COMPLETED'
  if (status === 'failed') return 'FAILED'
  return 'PENDING'
}

function followUpErrorMessage(code: string) {
  if (code === 'BUDGET_EXHAUSTED') return 'No remaining budget is available for follow-up questions.'
  if (code === 'REPORT_NOT_READY') return 'This report is not ready for follow-up questions yet.'
  if (code === 'INVALID_BODY') return 'Enter a follow-up question between 1 and 500 characters.'
  if (code === 'FOLLOW_UP_FAILED') return 'The follow-up answer could not be generated. Please try again.'
  return 'Failed to submit the follow-up question.'
}

type LiveFollowUpResponse = {
  error?: string
  followUp?: ResearchFollowUpRecord
}

type LiveFollowUpsResponse = {
  error?: string
  followUps?: ResearchFollowUpRecord[]
}

type ResearchDetailResponse = {
  research?: ResearchRecord
  txLog?: TxLogRecord[]
}

function mergeFollowUps(current: ResearchFollowUpRecord[], incoming: ResearchFollowUpRecord[]) {
  const byId = new Map<string, ResearchFollowUpRecord>()
  for (const followUp of incoming) byId.set(followUp.id, followUp)
  for (const followUp of current) byId.set(followUp.id, followUp)
  return Array.from(byId.values()).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

function QuotaPanel({ quota }: { quota: QuotaStatus | null }) {
  if (!quota) {
    return (
      <div className="border border-border bg-bg-base p-3 font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">
        DAILY QUOTA: LOADING...
      </div>
    )
  }

  return (
    <div className="border border-border bg-bg-base p-3 font-mono text-[11px] uppercase tracking-[0.05em]">
      <div className="mb-2 font-bold text-amber">DAILY QUOTA</div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className={quotaTone(quota.wallet)}>
          WALLET: <span className="tabular-nums">{quotaBar(quota.wallet)} {quota.wallet.used}/{quota.wallet.limit}</span>
        </div>
        <div className={quotaTone(quota.global)}>
          GLOBAL: <span className="tabular-nums">{quotaBar(quota.global)} {quota.global.used}/{quota.global.limit}</span>
        </div>
      </div>
      <div className="mt-2 text-text-secondary">RESETS IN: {resetIn(quota.wallet.resetAt)}</div>
      <div className="my-2 border-t border-border" />
      <div className="normal-case tracking-normal text-text-muted">Rate limits will be relaxed after mainnet launch.</div>
    </div>
  )
}

function ResearchForm({ onStarted }: { onStarted: (id: string, budget: string) => void }) {
  const router = useRouter()
  const [promptDeck, setPromptDeck] = useState(promptPool)
  const [topicIndex, setTopicIndex] = useState(0)
  const [topic, setTopic] = useState(promptPool[0] ?? '')
  const [hasEditedTopic, setHasEditedTopic] = useState(false)
  const [budget, setBudget] = useState('0.0100')
  const [error, setError] = useState<string | null>(null)
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  const [isSubmitting, setSubmitting] = useState(false)
  const quotaReason = quotaExceededReason(quota)
  const visibleQuickPrompts = useMemo(() => promptDeck.slice(0, VISIBLE_QUICK_PROMPTS), [promptDeck])

  useEffect(() => {
    const shuffledPrompts = shufflePrompts(promptPool)
    setPromptDeck(shuffledPrompts)
    setTopic(shuffledPrompts[0] ?? '')
  }, [])

  const loadQuota = useCallback(async () => {
    const res = await fetch('/api/quota', { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return
    setQuota(await res.json() as QuotaStatus)
  }, [])

  useEffect(() => {
    loadQuota().catch(() => {})
    const timer = window.setInterval(() => loadQuota().catch(() => {}), 30_000)
    return () => window.clearInterval(timer)
  }, [loadQuota])

  useEffect(() => {
    if (hasEditedTopic) return
    if (promptDeck.length <= 1) return
    const timer = window.setInterval(() => {
      setTopicIndex((current) => (current + 1) % promptDeck.length)
    }, TOPIC_ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [hasEditedTopic, promptDeck.length])

  useEffect(() => {
    if (!hasEditedTopic) setTopic(promptDeck[topicIndex] ?? promptDeck[0] ?? '')
  }, [hasEditedTopic, promptDeck, topicIndex])

  async function submit() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/research/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topic, budgetUsdc: budget }),
      })
      if (res.status === 429) {
        const body = await res.json() as { quota?: QuotaStatus }
        if (body.quota) setQuota(body.quota)
        const resetAt = body.quota?.wallet.resetAt ?? quota?.wallet.resetAt ?? new Date().toISOString()
        throw new Error(`Quota exceeded. Resets in ${resetIn(resetAt)}.`)
      }
      if (res.status === 401) {
        router.replace('/login?redirect=%2Fresearch')
        throw new Error('Authentication expired. Please sign in again.')
      }
      if (!res.ok) throw new Error(`START_FAILED_${res.status}`)
      const body = await res.json() as { researchId: string }
      onStarted(body.researchId, budget)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'START_FAILED')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-[640px] border border-border bg-bg-panel">
      <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
        &gt; NEW RESEARCH REQUEST
      </div>
      <div className="space-y-6 p-4 md:p-6">
        <label className="block">
          <span className="mb-2 block font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">TOPIC</span>
          <textarea
            value={topic}
            onChange={(event) => {
              setHasEditedTopic(true)
              setTopic(event.target.value)
            }}
            placeholder={`_ ${promptDeck[topicIndex] ?? promptDeck[0] ?? ''}`}
            rows={3}
            className="w-full resize-none border border-amber bg-bg-base px-3 py-3 font-mono text-sm text-text-primary outline-none placeholder:text-amber-dim focus:bg-bg-cell"
          />
        </label>

        <div>
          <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">&gt; QUICK PROMPTS</div>
          <div className="grid gap-2 min-[540px]:grid-cols-2">
            {visibleQuickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setHasEditedTopic(true)
                  setTopic(prompt)
                }}
                className="border border-border bg-bg-base px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-text-secondary hover:border-amber hover:text-amber"
              >
                [{prompt}]
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">BUDGET</div>
          <div className="grid gap-3 md:grid-cols-[150px_1fr] md:items-center">
            <input
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              className="h-11 border border-border bg-bg-base px-3 font-mono text-sm font-bold tabular-nums text-amber outline-none focus:border-amber"
            />
            <div className="flex items-center gap-3 font-mono text-[11px] text-text-muted">
              <span>$0.001</span>
              <input
                type="range"
                min="0.001"
                max="0.1"
                step="0.001"
                value={Number(budget)}
                onChange={(event) => setBudget(formatBudget(Number(event.target.value)))}
                className="h-1 flex-1 accent-amber"
              />
              <span>$0.10</span>
            </div>
          </div>
          <div className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-text-secondary">
            ESTIMATED CALLS: <span className="text-amber">{estimatedCalls(budget)}</span>
          </div>
        </div>

        <QuotaPanel quota={quota} />

        <button
          type="button"
          onClick={submit}
          disabled={isSubmitting || !topic.trim() || Boolean(quotaReason)}
          title={quotaReason ? `${quotaReason}. Resets in ${resetIn(quota?.wallet.resetAt ?? new Date().toISOString())}.` : undefined}
          className="terminal-button h-12 w-full bg-amber px-4 text-sm text-bg-base hover:bg-bg-base hover:text-amber disabled:border-red disabled:bg-bg-cell disabled:text-red"
        >
          {quotaReason ? '[ QUOTA EXCEEDED ]' : isSubmitting ? '[ STARTING... ]' : '[ ▸ START RESEARCH ]'}
        </button>
        {error ? <div className="font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-red">[ERR] {error}</div> : null}
      </div>
    </section>
  )
}

function LiveFollowUpPanel({ researchId }: { researchId: string }) {
  const router = useRouter()
  const [followUps, setFollowUps] = useState<ResearchFollowUpRecord[]>([])
  const [followUpQuestion, setFollowUpQuestion] = useState('')
  const [followUpError, setFollowUpError] = useState<string | null>(null)
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [followUpsLoading, setFollowUpsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadFollowUps() {
      setFollowUpsLoading(true)
      try {
        const res = await fetch(`/api/research/${researchId}/follow-ups`, { credentials: 'include' })
        if (res.status === 401) {
          router.replace(`/login?redirect=${encodeURIComponent(`/research?id=${researchId}`)}`)
          throw new Error('Authentication expired. Please sign in again.')
        }

        const body = await res.json().catch(() => ({})) as LiveFollowUpsResponse
        if (!res.ok) throw new Error(followUpErrorMessage(body.error ?? 'FOLLOW_UP_FAILED'))
        const loadedFollowUps = Array.isArray(body.followUps) ? body.followUps : []
        if (!cancelled) {
          setFollowUps((current) => mergeFollowUps(current, loadedFollowUps))
        }
      } catch (err) {
        if (!cancelled) {
          setFollowUpError(err instanceof Error ? err.message : followUpErrorMessage('FOLLOW_UP_FAILED'))
        }
      } finally {
        if (!cancelled) setFollowUpsLoading(false)
      }
    }

    loadFollowUps().catch(() => {})

    return () => {
      cancelled = true
    }
  }, [researchId])

  async function submitFollowUp() {
    const question = followUpQuestion.trim()
    if (!question) {
      setFollowUpError(followUpErrorMessage('INVALID_BODY'))
      return
    }

    setFollowUpError(null)
    setSubmittingFollowUp(true)
    setPendingQuestion(question)

    try {
      const res = await fetch(`/api/research/${researchId}/follow-ups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      if (res.status === 401) {
        router.replace(`/login?redirect=${encodeURIComponent(`/research?id=${researchId}`)}`)
        throw new Error('Authentication expired. Please sign in again.')
      }

      const body = await res.json().catch(() => ({})) as LiveFollowUpResponse
      if (body.followUp) setFollowUps((current) => [...current, body.followUp as ResearchFollowUpRecord])
      if (!res.ok) throw new Error(followUpErrorMessage(body.error ?? 'FOLLOW_UP_FAILED'))

      setFollowUpQuestion('')
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : followUpErrorMessage('FOLLOW_UP_FAILED'))
    } finally {
      setPendingQuestion(null)
      setSubmittingFollowUp(false)
    }
  }

  return (
    <div className="border-t border-border px-3 pb-3 pt-0">
      <div className="border border-border bg-bg-panel">
        <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
          &gt; FOLLOW-UP Q&amp;A
        </div>
        <div className="space-y-4 p-3">
          <div className="space-y-3">
            {followUps.length ? (
              followUps.map((followUp, index) => (
                <div key={followUp.id} className="border border-border bg-bg-base">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.05em]">
                    <span className="font-bold text-amber">Q{index + 1}</span>
                    <span className={followUpStatusTone(followUp.status)}>{followUpStatusLabel(followUp.status)}</span>
                    <span className="text-text-muted">{utcDateTime(followUp.createdAt)}</span>
                  </div>
                  <div className="px-3 py-3">
                    <div className="mb-3 whitespace-pre-wrap font-mono text-sm text-text-primary">{followUp.question}</div>
                    {followUp.answerMd ? (
                      <div className="border-t border-border pt-3">
                        <TerminalMarkdown content={followUp.answerMd} />
                      </div>
                    ) : null}
                    {followUp.status === 'failed' ? (
                      <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-red">
                        Follow-up answer failed. Please try again.
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : followUpsLoading ? (
              <div className="border border-border bg-bg-base px-3 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-text-secondary">
                Loading follow-up history...
              </div>
            ) : (
              <div className="border border-border bg-bg-base px-3 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-text-secondary">
                No follow-up questions yet. Ask a focused follow-up about this report.
              </div>
            )}

            {pendingQuestion ? (
              <div className="border border-border bg-bg-base">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.05em]">
                  <span className="font-bold text-amber">NEW QUESTION</span>
                  <span className="text-cyan blink">PENDING</span>
                </div>
                <div className="px-3 py-3">
                  <div className="mb-3 whitespace-pre-wrap font-mono text-sm text-text-primary">{pendingQuestion}</div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-cyan blink">
                    Generating follow-up answer...
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3">
            <label className="block">
              <span className="mb-2 block font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">QUESTION</span>
              <textarea
                value={followUpQuestion}
                onChange={(event) => setFollowUpQuestion(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="_ Ask a follow-up about this report"
                className="w-full resize-none border border-amber bg-bg-base px-3 py-3 font-mono text-sm text-text-primary outline-none placeholder:text-amber-dim focus:bg-bg-cell"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">
                {(followUpQuestion.trim() || '').length}/500
              </div>
              <button
                type="button"
                onClick={() => submitFollowUp().catch(() => {})}
                disabled={submittingFollowUp}
                className="terminal-button h-9 px-3 text-[11px] disabled:border-red disabled:text-red"
              >
                [SUBMIT FOLLOW-UP]
              </button>
            </div>
            {followUpError ? <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-red">{followUpError}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function LiveResearch({
  researchId,
  initialBudget,
}: {
  researchId: string
  initialBudget: string
}) {
  const router = useRouter()
  const routerReplace = router.replace
  const [events, setEvents] = useState<TimedEvent[]>([])
  const [research, setResearch] = useState<ResearchRecord | null>(null)
  const [isCancelling, setCancelling] = useState(false)
  const stoppedRef = useRef(false)
  const final = events.find((event) => event.type === 'final')
  const isTerminal = hasTerminalEvent(events)
  const hasPendingSettlement = hasPendingPayment(events)

  const onEvent = useCallback((event: TimedEvent) => {
    if (stoppedRef.current) return
    setEvents((current) => (hasTerminalEvent(current) ? current : [...current, event]))
  }, [])

  const loadResearchDetail = useCallback(async (shouldIgnore?: () => boolean) => {
    const res = await fetch(`/api/research/${researchId}`, { credentials: 'include', cache: 'no-store' })
    if (res.status === 401) {
      routerReplace(`/login?redirect=${encodeURIComponent(`/research?id=${researchId}`)}`)
      throw new Error('Authentication expired. Please sign in again.')
    }
    if (!res.ok) return

    const body = await res.json().catch(() => null) as ResearchDetailResponse | null
    if (shouldIgnore?.()) return
    if (!body?.research) return

    const record = body.research
    const txLog = Array.isArray(body.txLog) ? body.txLog : []
    setResearch((current) => (
      current?.status === 'cancelled' && record.status === 'running' ? current : record
    ))
    setEvents((current) => {
      const merged = mergeTxLogIntoEvents(current, txLog)
      const restored = persistedEvent(record)
      if (!restored || hasTerminalEvent(merged)) return merged
      return [...merged, restored]
    })
  }, [researchId, routerReplace])

  useEffect(() => {
    let cancelled = false
    loadResearchDetail(() => cancelled).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [loadResearchDetail])

  useEffect(() => {
    if (!isTerminal || !hasPendingSettlement) return undefined
    const timer = window.setInterval(() => {
      loadResearchDetail().catch(() => {})
    }, TX_LOG_POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasPendingSettlement, isTerminal, loadResearchDetail])

  async function cancel() {
    if (isTerminal || stoppedRef.current) return
    stoppedRef.current = true
    const cancelledAt = new Date().toISOString()
    const cancelledEvent: TimedEvent = { type: 'error', message: 'Research cancelled', receivedAt: utcTime(new Date(cancelledAt)) }
    setResearch((current) => current ? {
      ...current,
      status: 'cancelled',
      errorMessage: 'Research cancelled',
      completedAt: current.completedAt ?? cancelledAt,
    } : current)
    setEvents((current) => (
      hasTerminalEvent(current) ? current : [...current, cancelledEvent]
    ))
    setCancelling(true)
    try {
      const res = await fetch(`/api/research/${researchId}/cancel`, { method: 'POST', credentials: 'include' }).catch(() => null)
      if (!res?.ok) return
    } finally {
      setCancelling(false)
    }
  }

  const budget = research?.budgetUsdc ?? initialBudget

  return (
    <section className="mx-auto w-full max-w-[1480px] border border-border bg-bg-base">
      <div className="flex items-center justify-between border-b border-amber px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em]">
        <div className="min-w-0 text-amber">
          &gt; LIVE RESEARCH <span className="ml-3 text-text-muted">#{researchId.slice(0, 8)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {final ? (
            <>
              <button type="button" onClick={() => router.push(`/research/${researchId}#follow-up`)} className="terminal-button h-8 px-3 text-[11px]">
                [ASK FOLLOW-UP →]
              </button>
              <button type="button" onClick={() => router.push(`/research/${researchId}`)} className="terminal-button h-8 px-3 text-[11px]">
                [VIEW FULL REPORT →]
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={cancel}
            disabled={isCancelling || isTerminal}
            className="h-8 border border-red bg-bg-base px-3 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-red hover:bg-red hover:text-bg-base disabled:border-border disabled:text-text-muted disabled:hover:bg-bg-base"
          >
            [CANCEL]
          </button>
        </div>
      </div>
      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1.1fr)_minmax(190px,0.7fr)]">
        <AgentLogStream researchId={researchId} events={events} onEvent={onEvent} />
        <TxFeed events={events} />
        <BudgetMeter events={events} budgetUsdc={budget} />
      </div>
      {final ? <LiveFollowUpPanel researchId={researchId} /> : null}
    </section>
  )
}

export function ResearchPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const researchId = searchParams.get('id')
  const [lastBudget, setLastBudget] = useState('0.0100')

  function handleStarted(id: string, budget: string) {
    setLastBudget(budget)
    router.push(`/research?id=${id}`)
  }

  return (
    <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
      <div className="mx-auto mb-3 flex w-full max-w-[1480px] justify-end">
        <a href="/dashboard" className="terminal-button h-9 px-3 text-[11px]">
          [VIEW HISTORY]
        </a>
      </div>
      {researchId ? <LiveResearch key={researchId} researchId={researchId} initialBudget={lastBudget} /> : <ResearchForm onStarted={handleStarted} />}
    </main>
  )
}
