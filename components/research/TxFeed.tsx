'use client'

import { useId } from 'react'
import type { AgentEvent, TxStatus } from './types'
import { paymentStatusLabel, shortHash } from './types'

function statusTone(status: TxStatus) {
  if (status === 'confirmed') return 'text-green'
  if (status === 'failed') return 'text-red'
  if (status === 'pending') return 'text-yellow'
  return 'text-amber'
}

export function TxFeed({ events }: { events: AgentEvent[] }) {
  const headingId = useId()
  const explorerBase = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL?.replace(/\/$/, '')
  const txEvents = events
    .filter((event): event is Extract<AgentEvent, { type: 'tool_result' }> => event.type === 'tool_result')
    .slice()
    .reverse()

  return (
    <section className="flex h-[calc(100vh-214px)] min-h-[500px] flex-col border border-border bg-bg-panel">
      <div id={headingId} className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
        TX FEED
      </div>
      <div
        role="region"
        aria-labelledby={headingId}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-amber"
      >
        <div className="divide-y divide-border">
          {txEvents.length ? txEvents.map((event, index) => {
            const href = event.payment.txHash && explorerBase ? `${explorerBase}/tx/${event.payment.txHash}` : '#'
            const isConfirmed = event.payment.txStatus === 'confirmed' && Boolean(event.payment.txHash)
            return (
              <div key={`${event.callId}-${event.payment.requestId}`} className="bg-bg-cell px-3 py-3 font-mono uppercase tracking-[0.05em]">
                <div className="mb-2 text-[11px] font-bold text-amber">TX #{txEvents.length - index}</div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-text-primary">{event.name}</span>
                  <span className="tabular-nums text-amber">${event.payment.amount}</span>
                </div>
                {isConfirmed && explorerBase ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block break-all text-[11px] text-cyan hover:text-amber"
                  >
                    {shortHash(event.payment.txHash)} ↗
                  </a>
                ) : (
                  <div className="mt-2 break-all text-[11px] text-text-secondary">
                    {shortHash(event.payment.txHash)}
                  </div>
                )}
                <div className={`mt-2 text-[10px] ${statusTone(event.payment.txStatus)}`}>
                  {paymentStatusLabel(event.payment.txStatus)}
                </div>
              </div>
            )
          }) : (
            <div className="px-3 py-8 font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">
              WAITING FOR TOOL PAYMENTS_
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
