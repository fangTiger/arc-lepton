'use client'

import type { AgentEvent } from './types'

function decimal(value: string | number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return numeric
}

function bar(percent: number) {
  const cells = 10
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return `${'█'.repeat(filled)}${'░'.repeat(cells - filled)}`
}

export function BudgetMeter({ events, budgetUsdc }: { events: AgentEvent[]; budgetUsdc: string }) {
  const budgetEvent = [...events].reverse().find((event): event is Extract<AgentEvent, { type: 'budget' }> => event.type === 'budget')
  const final = [...events].reverse().find((event): event is Extract<AgentEvent, { type: 'final' }> => event.type === 'final')
  const spent = final?.totalSpentUsdc ?? budgetEvent?.spentUsdc ?? '0'
  const remaining = budgetEvent?.remainingUsdc ?? Math.max(decimal(budgetUsdc) - decimal(spent), 0).toFixed(4)
  const percent = budgetUsdc ? Math.min(100, (decimal(spent) / decimal(budgetUsdc)) * 100) : 0
  const calls = events.filter((event) => event.type === 'tool_result').length

  return (
    <section className="border border-border bg-bg-panel">
      <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
        BUDGET
      </div>
      <div className="space-y-5 p-3 font-mono uppercase tracking-[0.05em]">
        <div>
          <div className="text-[10px] text-text-muted">SPENT:</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-amber">{spent} USDC</div>
        </div>
        <div>
          <div className="text-[10px] text-text-muted">REMAINING:</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-cyan">{remaining} USDC</div>
        </div>
        <div>
          <div className="ascii-progress text-sm">{bar(percent)}</div>
          <div className="mt-1 text-[11px] tabular-nums text-text-secondary">{percent.toFixed(0)}% / 100%</div>
        </div>
        <div>
          <div className="text-[10px] text-text-muted">CALLS:</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-text-primary">{calls}</div>
        </div>
      </div>
    </section>
  )
}
