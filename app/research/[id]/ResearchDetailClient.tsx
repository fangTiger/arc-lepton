'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TerminalMarkdown } from '@/components/research/TerminalMarkdown'
import type { ResearchRecord, TxLogRecord } from '@/components/research/types'
import { durationSeconds, shortHash, shortId, utcDateTime } from '@/components/research/types'

type DetailResponse = {
  research: ResearchRecord
  txLog: TxLogRecord[]
}

function StatusText({ status }: { status: ResearchRecord['status'] }) {
  const tone = status === 'completed' ? 'text-green' : status === 'failed' || status === 'cancelled' ? 'text-red' : 'text-cyan'
  return <span className={tone}>● {status === 'completed' ? 'COMPLETED' : status.toUpperCase()}</span>
}

export function ResearchDetailClient({ id }: { id: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const explorerBase = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL?.replace(/\/$/, '')

  useEffect(() => {
    fetch(`/api/research/${id}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`LOAD_FAILED_${res.status}`)
        return res.json()
      })
      .then(setDetail)
      .catch((err) => setError(err instanceof Error ? err.message : 'LOAD_FAILED'))
  }, [id])

  const totalCalls = detail?.txLog.length ?? 0
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

  return (
    <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
      <section className="mx-auto w-full max-w-[1180px] border border-border bg-bg-panel">
        <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
          &gt; RESEARCH #{shortId(id)}
        </div>
        {error ? <div className="p-4 font-mono text-red">[ERR] {error}</div> : null}
        {!detail ? (
          <div className="p-8 font-mono text-amber blink">&gt; LOADING REPORT_</div>
        ) : (
          <>
            <div className="border-b border-border px-4 py-4 font-mono text-xs uppercase tracking-[0.05em]">
              <div className="grid gap-2">
                {header?.map(([label, value]) => (
                  <div key={label} className="grid gap-3 md:grid-cols-[96px_1fr]">
                    <span className="font-bold text-amber">{label}</span>
                    <span className={label === 'STATUS:' ? '' : 'text-text-primary'}>
                      {label === 'STATUS:' ? <StatusText status={detail.research.status} /> : value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-b border-border px-4 py-6">
              <TerminalMarkdown content={detail.research.reportMd || '[REPORT NOT READY]'} />
            </div>

            <div className="px-4 py-4">
              <div className="mb-3 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">&gt; DATA SOURCES USED</div>
              <div className="overflow-x-auto border border-border">
                <table className="w-full border-collapse font-mono text-[11px] uppercase tracking-[0.05em]">
                  <thead className="bg-bg-cell text-amber">
                    <tr>
                      <th className="border-b border-border px-3 py-2 text-left">SOURCE</th>
                      <th className="border-b border-border px-3 py-2 text-left">COST</th>
                      <th className="border-b border-border px-3 py-2 text-left">TX HASH</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.txLog.map((tx) => (
                      <tr key={tx.id} className="hover:bg-bg-hover">
                        <td className="border-b border-border px-3 py-2 text-text-primary">{tx.source}</td>
                        <td className="border-b border-border px-3 py-2 tabular-nums text-amber">{tx.amount}</td>
                        <td className="border-b border-border px-3 py-2">
                          <a
                            href={explorerBase ? `${explorerBase}/tx/${tx.txHash}` : '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan hover:text-amber"
                          >
                            {shortHash(tx.txHash)} ↗
                          </a>
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
                <button type="button" onClick={() => router.push(`/research?topic=${encodeURIComponent(detail.research.topic)}`)} className="terminal-button h-9 px-3 text-[11px]">[↻ RUN AGAIN]</button>
              </div>
              {toast ? <div className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">{toast}</div> : null}
            </div>
          </>
        )}
      </section>
    </main>
  )
}
