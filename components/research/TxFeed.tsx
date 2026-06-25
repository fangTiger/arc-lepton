'use client'

import type { AgentEvent } from './types'
import { shortHash } from './types'

export function TxFeed({ events }: { events: AgentEvent[] }) {
  const explorerBase = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL?.replace(/\/$/, '')
  const txEvents = events
    .filter((event): event is Extract<AgentEvent, { type: 'tool_result' }> => event.type === 'tool_result')
    .slice()
    .reverse()

  return (
    <section className="min-h-[520px] border border-border bg-bg-panel">
      <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
        TX FEED
      </div>
      <div className="divide-y divide-border">
        {txEvents.length ? txEvents.map((event, index) => {
          const href = explorerBase ? `${explorerBase}/tx/${event.payment.txHash}` : '#'
          return (
            <div key={`${event.callId}-${event.payment.txHash}`} className="bg-bg-cell px-3 py-3 font-mono uppercase tracking-[0.05em]">
              <div className="mb-2 text-[11px] font-bold text-amber">TX #{txEvents.length - index}</div>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-text-primary">{event.name}</span>
                <span className="tabular-nums text-amber">${event.payment.amount}</span>
              </div>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="mt-2 block break-all text-[11px] text-cyan hover:text-amber"
              >
                {shortHash(event.payment.txHash)} ↗
              </a>
              <div className="mt-2 text-[10px] text-green">✓ confirmed</div>
            </div>
          )
        }) : (
          <div className="px-3 py-8 font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">
            WAITING FOR TOOL PAYMENTS_
          </div>
        )}
      </div>
    </section>
  )
}
