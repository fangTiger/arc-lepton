'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentEvent } from './types'
import { extractPreview, utcTime } from './types'
import { TerminalMarkdown } from './TerminalMarkdown'

type TimedEvent = AgentEvent & { receivedAt?: string }

function argsText(args: Record<string, unknown>) {
  return Object.entries(args).map(([key, value]) => `${key}=${String(value)}`).join(', ')
}

function eventLine(event: TimedEvent) {
  const time = event.receivedAt ?? utcTime()
  if (event.type === 'thinking') return { tone: 'text-text-secondary italic', text: `${time} ▸ THINKING: "${event.text}"` }
  if (event.type === 'tool_call') return { tone: 'text-amber', text: `${time} ▸ TOOL_CALL: ${event.name}(${argsText(event.args)})` }
  if (event.type === 'tool_result') return { tone: 'text-green', text: `${time} ▸ TOOL_RESULT: ${event.name} → ${extractPreview(event.dataPreview)}` }
  if (event.type === 'budget') return { tone: 'text-text-muted', text: `${time} ▸ BUDGET: spent ${event.spentUsdc}` }
  if (event.type === 'final') return { tone: 'text-green', text: `${time} ▸ COMPLETED: total ${event.totalSpentUsdc} USDC · calls ${event.totalCalls}` }
  if (event.type === 'error') return { tone: 'text-red', text: `${time} [ERR] ${event.message}` }
  return null
}

export function AgentLogStream({
  researchId,
  events,
  onEvent,
}: {
  researchId: string
  events: TimedEvent[]
  onEvent: (event: TimedEvent) => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [isUserPinned, setUserPinned] = useState(false)
  const hasTerminalEvent = useMemo(
    () => events.some((event) => event.type === 'final' || event.type === 'error'),
    [events],
  )
  const [connection, setConnection] = useState<'connecting' | 'online' | 'closed' | 'error'>(
    () => hasTerminalEvent ? 'closed' : 'connecting',
  )

  const report = useMemo(() => {
    const final = [...events].reverse().find((event): event is Extract<TimedEvent, { type: 'final' }> => event.type === 'final')
    if (final) return final.reportMd
    return events.filter((event) => event.type === 'report_chunk').map((event) => event.delta).join('')
  }, [events])

  useEffect(() => {
    if (hasTerminalEvent) {
      setConnection('closed')
      return
    }

    setConnection('connecting')
    const source = new EventSource(`/api/research/${researchId}/stream`, { withCredentials: true })
    source.onopen = () => setConnection('online')
    source.onerror = () => {
      setConnection(source.readyState === EventSource.CLOSED ? 'closed' : 'error')
    }
    source.addEventListener('agent_event', (message) => {
      const event = JSON.parse((message as MessageEvent).data) as AgentEvent
      onEvent({ ...event, receivedAt: utcTime() })
      if (event.type === 'final' || event.type === 'error') {
        setConnection('closed')
        source.close()
      }
    })
    return () => source.close()
  }, [hasTerminalEvent, onEvent, researchId])

  useEffect(() => {
    const node = scrollerRef.current
    if (!node || isUserPinned) return
    node.scrollTop = node.scrollHeight
  }, [events, isUserPinned])

  function handleScroll() {
    const node = scrollerRef.current
    if (!node) return
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight
    setUserPinned(distance > 48)
  }

  return (
    <section className="min-h-[520px] border border-border bg-bg-panel">
      <div className="flex items-center justify-between border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em]">
        <span className="text-amber">AGENT LOG</span>
        <span className={connection === 'online' ? 'text-cyan' : connection === 'error' ? 'text-red' : 'text-text-muted'}>
          {connection.toUpperCase()}
        </span>
      </div>
      <div ref={scrollerRef} onScroll={handleScroll} className="h-[calc(100vh-214px)] min-h-[500px] overflow-y-auto px-3 py-3 font-mono">
        <div className="space-y-1 text-[11px] leading-5">
          <div className="text-cyan">{utcTime()} ▸ STARTED: research #{researchId.slice(0, 8)}</div>
          {events.map((event, index) => {
            const line = eventLine(event)
            if (!line) return null
            return (
              <div key={`${event.type}-${index}`} className={line.tone}>
                {line.text}
              </div>
            )
          })}
          {connection !== 'closed' ? <div className="text-amber">▌</div> : null}
        </div>
        <div className="mt-5 border-t border-border pt-4">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.05em] text-amber">&gt; REPORT</div>
          {report ? <TerminalMarkdown content={report} /> : (
            <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">REPORT BUFFER EMPTY_</div>
          )}
          {connection !== 'closed' ? <span className="blink font-mono text-amber">▌</span> : null}
        </div>
      </div>
    </section>
  )
}
