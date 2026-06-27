'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TerminalMarkdown } from '@/components/research/TerminalMarkdown'
import type { ResearchFollowUpRecord, ResearchRecord, TxLogRecord } from '@/components/research/types'
import { durationSeconds, isBillablePaymentStatus, paymentStatusLabel, shortHash, shortId, utcDateTime } from '@/components/research/types'

type DetailResponse = {
  research: ResearchRecord
  txLog: TxLogRecord[]
}

type FollowUpResponse = {
  followUps: ResearchFollowUpRecord[]
}

function StatusText({ status }: { status: ResearchRecord['status'] }) {
  const tone = status === 'completed' ? 'text-green' : status === 'failed' || status === 'cancelled' ? 'text-red' : 'text-cyan'
  return <span className={tone}>● {status === 'completed' ? 'COMPLETED' : status.toUpperCase()}</span>
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
  if (code === 'LOAD_FAILED') return 'Failed to load follow-up history.'
  return 'Failed to submit the follow-up question.'
}

function detailErrorMessage(status: number) {
  if (status === 401) return 'Authentication expired. Please sign in again.'
  if (status === 403) return 'Access denied for this research report.'
  if (status === 404) return 'Research report not found.'
  return 'Failed to load the research report.'
}

export function ResearchDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [followUps, setFollowUps] = useState<ResearchFollowUpRecord[]>([])
  const [followUpQuestion, setFollowUpQuestion] = useState('')
  const [followUpError, setFollowUpError] = useState<string | null>(null)
  const [followUpsLoading, setFollowUpsLoading] = useState(true)
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const followUpSectionRef = useRef<HTMLDivElement | null>(null)
  const followUpInputRef = useRef<HTMLTextAreaElement | null>(null)
  const explorerBase = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL?.replace(/\/$/, '')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setError(null)
      setFollowUpError(null)
      setDetailLoading(true)
      setFollowUpsLoading(true)

      try {
        const detailRes = await fetch(`/api/research/${id}`, { credentials: 'include' })
        if (!detailRes.ok) {
          if (detailRes.status === 401) {
            router.replace(`/login?redirect=${encodeURIComponent(`/research/${id}`)}`)
          }
          throw new Error(detailErrorMessage(detailRes.status))
        }
        const detailBody = await detailRes.json() as DetailResponse
        if (cancelled) return
        setDetail(detailBody)
      } catch (err) {
        if (cancelled) return
        setDetail(null)
        setError(err instanceof Error ? err.message : detailErrorMessage(500))
        setDetailLoading(false)
        setFollowUpsLoading(false)
        return
      }

      if (!cancelled) setDetailLoading(false)

      try {
        const followUpRes = await fetch(`/api/research/${id}/follow-ups`, { credentials: 'include' })
        if (!followUpRes.ok) throw new Error('LOAD_FAILED')
        const followUpBody = await followUpRes.json() as FollowUpResponse
        if (cancelled) return
        setFollowUps(followUpBody.followUps)
      } catch (err) {
        if (cancelled) return
        setFollowUpError(followUpErrorMessage(err instanceof Error ? err.message : 'LOAD_FAILED'))
      } finally {
        if (!cancelled) setFollowUpsLoading(false)
      }
    }

    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!detail || typeof window === 'undefined' || window.location.hash !== '#follow-up') return

    const run = () => {
      followUpSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
      followUpInputRef.current?.focus({ preventScroll: true })
    }

    const frameId = window.requestAnimationFrame(run)
    return () => window.cancelAnimationFrame(frameId)
  }, [detail])

  const totalCalls = detail?.txLog.filter((entry) => isBillablePaymentStatus(entry.txStatus)).length ?? 0
  const header = useMemo(() => {
    if (!detail) return null
    return [
      ['TOPIC:', detail.research.topic],
      ['STATUS:', detail.research.status],
      ['STARTED:', utcDateTime(detail.research.startedAt)],
      ['DURATION:', durationSeconds(detail.research.startedAt, detail.research.completedAt)],
      ['COST:', `$${detail.research.spentUsdc} USDC (${totalCalls} calls)`],
    ]
  }, [detail, totalCalls])

  async function share() {
    await navigator.clipboard?.writeText(window.location.href)
    setToast('[COPIED] SHARE LINK READY')
    window.setTimeout(() => setToast(null), 1800)
  }

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
      const res = await fetch(`/api/research/${id}/follow-ups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      if (res.status === 401) {
        router.replace(`/login?redirect=${encodeURIComponent(`/research/${id}`)}`)
        throw new Error('Authentication expired. Please sign in again.')
      }

      const body = await res.json().catch(() => ({})) as { error?: string; followUp?: ResearchFollowUpRecord }
      if (!res.ok) {
        if (body.followUp) setFollowUps((current) => [...current, body.followUp as ResearchFollowUpRecord])
        throw new Error(followUpErrorMessage(body.error ?? 'FOLLOW_UP_FAILED'))
      }

      if (body.followUp) setFollowUps((current) => [...current, body.followUp as ResearchFollowUpRecord])
      setFollowUpQuestion('')
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : followUpErrorMessage('FOLLOW_UP_FAILED'))
    } finally {
      setPendingQuestion(null)
      setSubmittingFollowUp(false)
    }
  }

  if (detailLoading) {
    return (
      <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
        <section className="mx-auto w-full max-w-[1180px] border border-border bg-bg-panel">
          <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
            &gt; RESEARCH #{shortId(id)}
          </div>
          <div className="p-8 font-mono text-amber blink">&gt; LOADING REPORT_</div>
        </section>
      </main>
    )
  }

  if (error || !detail) {
    return (
      <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
        <section className="mx-auto w-full max-w-[1180px] border border-border bg-bg-panel">
          <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
            &gt; RESEARCH #{shortId(id)}
          </div>
          <div className="p-4 font-mono text-red">{error ?? detailErrorMessage(500)}</div>
        </section>
      </main>
    )
  }

  const detailData = detail

  return (
    <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
      <section className="mx-auto w-full max-w-[1180px] border border-border bg-bg-panel">
        <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
          &gt; RESEARCH #{shortId(id)}
        </div>
        <>
          <div className="border-b border-border px-4 py-4 font-mono text-xs uppercase tracking-[0.05em]">
            <div className="grid gap-2">
              {header?.map(([label, value]) => (
                <div key={label} className="grid gap-3 md:grid-cols-[96px_1fr]">
                  <span className="font-bold text-amber">{label}</span>
                  <span className={label === 'STATUS:' ? '' : 'text-text-primary'}>
                    {label === 'STATUS:' ? <StatusText status={detailData.research.status} /> : value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="border-b border-border px-4 py-6">
            <TerminalMarkdown content={detailData.research.reportMd || '[REPORT NOT READY]'} />
          </div>

          <div id="follow-up" ref={followUpSectionRef} className="scroll-mt-8 border-b border-border px-4 py-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">&gt; FOLLOW-UP Q&amp;A</div>
              {submittingFollowUp ? <div className="font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-cyan blink">ANSWERING...</div> : null}
            </div>

            <div className="space-y-3">
              {followUpsLoading ? (
                <div className="border border-border bg-bg-base px-3 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-cyan blink">
                  Loading follow-up history...
                </div>
              ) : followUps.length ? (
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

            <div className="mt-4 grid gap-3">
              <label className="block">
                <span className="mb-2 block font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">QUESTION</span>
                <textarea
                  ref={followUpInputRef}
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

          <div className="px-4 py-4">
            <div className="mb-3 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">&gt; DATA SOURCES USED</div>
            <div className="overflow-x-auto border border-border">
              <table className="w-full border-collapse font-mono text-[11px] uppercase tracking-[0.05em]">
                <thead className="bg-bg-cell text-amber">
                  <tr>
                    <th className="border-b border-border px-3 py-2 text-left">SOURCE</th>
                    <th className="border-b border-border px-3 py-2 text-left">COST</th>
                    <th className="border-b border-border px-3 py-2 text-left">STATUS</th>
                    <th className="border-b border-border px-3 py-2 text-left">TX HASH</th>
                  </tr>
                </thead>
                <tbody>
                  {detailData.txLog.map((tx) => (
                    <tr key={tx.id} className="hover:bg-bg-hover">
                      <td className="border-b border-border px-3 py-2 text-text-primary">{tx.source}</td>
                      <td className="border-b border-border px-3 py-2 tabular-nums text-amber">{tx.amount}</td>
                      <td className="border-b border-border px-3 py-2">
                        <span title={tx.errorMessage ?? undefined}>{paymentStatusLabel(tx.txStatus)}</span>
                      </td>
                      <td className="border-b border-border px-3 py-2">
                        {tx.txStatus === 'confirmed' && explorerBase && tx.txHash ? (
                          <a
                            href={`${explorerBase}/tx/${tx.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan hover:text-amber"
                          >
                            {shortHash(tx.txHash)} ↗
                          </a>
                        ) : (
                          <span className="text-text-secondary">{shortHash(tx.txHash)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => router.push(`/research?id=${id}`)} className="terminal-button h-9 px-3 text-[11px]">[← BACK TO SESSION]</button>
              <button type="button" onClick={() => router.push('/dashboard')} className="terminal-button h-9 px-3 text-[11px]">[VIEW HISTORY]</button>
              <button type="button" onClick={share} className="terminal-button h-9 px-3 text-[11px]">[SHARE LINK]</button>
              <button type="button" onClick={() => router.push(`/research?topic=${encodeURIComponent(detailData.research.topic)}`)} className="terminal-button h-9 px-3 text-[11px]">[↻ RUN AGAIN]</button>
            </div>
            {toast ? <div className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">{toast}</div> : null}
          </div>
        </>
      </section>
    </main>
  )
}
