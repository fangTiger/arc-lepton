import { requireAuth } from '@/lib/auth/middleware'
import { researchEventRepo, researchRepo } from '@/lib/db'
import { verifyResearchRunToken } from '@/lib/agent/research-token'
import {
  claimResearchRunner,
  getResearchEvents,
  getResearchAbortController,
  markResearchDone,
  publishResearchEvent,
  subscribeResearchEvents,
} from '@/lib/agent/event-bus'
import { runResearchAgent, type AgentEvent } from '@/lib/agent/research-agent'
import type { DurableResearchEvent, ResearchCheckpoint } from '@/lib/db/research-event-repo'
import type { Research } from '@/lib/db/research-repo'

type RouteContext = {
  params: {
    id: string
  }
}

export const maxDuration = 60

function sse(event: AgentEvent, eventId?: number) {
  const idLine = eventId === undefined ? '' : `id: ${eventId}\n`
  return `${idLine}event: agent_event\ndata: ${JSON.stringify(event)}\n\n`
}

function isTerminalEvent(event: AgentEvent) {
  return event.type === 'error' || event.type === 'final'
}

function persistedTerminalEvent(
  research: Pick<Research, 'status' | 'reportMd' | 'spentUsdc' | 'errorMessage'>,
) {
  if (research.status === 'completed' && research.reportMd) {
    return {
      type: 'final',
      reportMd: research.reportMd,
      totalSpentUsdc: research.spentUsdc,
      totalCalls: 0,
    } satisfies AgentEvent
  }
  if ((research.status === 'failed' || research.status === 'cancelled') && research.errorMessage) {
    return {
      type: 'error',
      message: research.errorMessage,
    } satisfies AgentEvent
  }
  if (research.status === 'cancelled') {
    return {
      type: 'error',
      message: 'Research cancelled',
    } satisfies AgentEvent
  }
  if (research.status !== 'running') {
    return {
      type: 'error',
      message: 'Research is no longer running',
    } satisfies AgentEvent
  }
  return null
}

function isEscrowBoundResearch(
  research: Partial<Pick<Research, 'activationPhase' | 'escrowAddress' | 'expectedEscrowAddress' | 'researchKey'>>,
) {
  const hasEscrowIdentity = Boolean(research.escrowAddress || research.expectedEscrowAddress || research.researchKey)
  return hasEscrowIdentity && research.activationPhase === 'active'
}

function lastEventCursor(req: Request) {
  const raw = req.headers.get('last-event-id')
  if (!raw) return 0
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function durableEventPayload(event: DurableResearchEvent): AgentEvent | null {
  if (!event.payload || typeof event.payload !== 'object') return null
  const payload = event.payload as { type?: unknown }
  if (payload.type !== event.type) return null
  return payload as AgentEvent
}

function terminalCheckpointReplay(checkpoint: ResearchCheckpoint | null, afterCursor: number) {
  if (!checkpoint) return null
  if (!checkpoint.state || typeof checkpoint.state !== 'object') return null
  const state = checkpoint.state as { phase?: unknown; terminalEventType?: unknown; lastEventCursor?: unknown; event?: unknown }
  const isTerminal = state.phase === 'terminal' && (state.terminalEventType === 'final' || state.terminalEventType === 'error')
  if (!isTerminal) return null
  const cursor = typeof state.lastEventCursor === 'number' && state.lastEventCursor > 0
    ? state.lastEventCursor
    : checkpoint.cursor
  if (cursor <= afterCursor) return { terminal: true, event: null, cursor }
  if (!state.event || typeof state.event !== 'object') return { terminal: true, event: null, cursor }
  const event = state.event as { type?: unknown }
  if (event.type !== state.terminalEventType) return { terminal: true, event: null, cursor }
  return { terminal: true, event: event as AgentEvent, cursor }
}

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const tokenPayload = await verifyResearchRunToken(params.id)
    const researchId = tokenPayload?.id ?? params.id
    const research = await researchRepo.findById(researchId) ?? (tokenPayload ? {
      id: tokenPayload.id,
      address: tokenPayload.address,
      topic: tokenPayload.topic,
      budgetUsdc: tokenPayload.budgetUsdc,
      spentUsdc: '0',
      status: 'running' as const,
      activationPhase: 'active' as const,
      finalizationState: 'open' as const,
      quotaReservationState: 'consumed' as const,
      reportMd: null,
      errorMessage: null,
      createdAt: new Date(tokenPayload.iat * 1000),
      preparedAt: null,
      fundingExpiresAt: null,
      startedAt: new Date(tokenPayload.iat * 1000),
      completedAt: null,
    } : null)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })

    const encoder = new TextEncoder()
    const sharedAbortController = getResearchAbortController(researchId)
    let closed = false
    let requestAbortListener: (() => void) | null = null
    let unsubscribe: (() => void) | null = null
    let ownsDirectRun = false

    const escrowBound = isEscrowBoundResearch(research)

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const safeEnqueue = (event: AgentEvent, eventId?: number) => {
          if (closed) return false
          try {
            controller.enqueue(encoder.encode(sse(event, eventId)))
            return true
          } catch {
            closed = true
            return false
          }
        }

        const safeClose = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {}
        }

        if (escrowBound) {
          const afterCursor = lastEventCursor(req)
          const durableEvents = await researchEventRepo.listByResearch(researchId, { afterCursor })
          let replayedTerminal = false
          for (const durableEvent of durableEvents) {
            const event = durableEventPayload(durableEvent)
            if (!event) continue
            safeEnqueue(event, durableEvent.cursor)
            if (isTerminalEvent(event)) replayedTerminal = true
          }
          const terminalCheckpoint = terminalCheckpointReplay(await researchEventRepo.latestCheckpoint(researchId), afterCursor)
          if (!replayedTerminal && terminalCheckpoint?.event) {
            safeEnqueue(terminalCheckpoint.event, terminalCheckpoint.cursor)
            replayedTerminal = true
          }
          if (replayedTerminal || terminalCheckpoint?.terminal) {
            safeClose()
            return
          }

          unsubscribe = subscribeResearchEvents(researchId, {
            onEvent(event, cursor) {
              safeEnqueue(event, cursor)
            },
            onDone() {
              unsubscribe?.()
              unsubscribe = null
              safeClose()
            },
          })

          requestAbortListener = () => {
            unsubscribe?.()
            unsubscribe = null
            safeClose()
          }

          if (req.signal.aborted) requestAbortListener()
          else req.signal.addEventListener('abort', requestAbortListener, { once: true })
          return
        }

        const history = getResearchEvents(researchId)
        for (const event of history.events) safeEnqueue(event)
        if (history.done || history.events.some(isTerminalEvent)) {
          if (history.done && !history.events.some(isTerminalEvent) && research.status !== 'running') {
            const event = persistedTerminalEvent(research)
            if (event) safeEnqueue(event)
          }
          if (!history.done) markResearchDone(researchId)
          safeClose()
          return
        }

        if (history.events.length === 0 && research.status !== 'running') {
          const event = persistedTerminalEvent(research)
          if (event) {
            publishResearchEvent(researchId, event)
            safeEnqueue(event)
          }
          markResearchDone(researchId)
          safeClose()
          return
        }

        if (
          history.events.length === 0
          && research.status === 'running'
          && claimResearchRunner(researchId)
        ) {
          ownsDirectRun = true
          requestAbortListener = () => {
            safeClose()
          }

          if (req.signal.aborted) requestAbortListener()
          else req.signal.addEventListener('abort', requestAbortListener, { once: true })

          void (async () => {
            try {
              for await (const event of runResearchAgent({
                researchId,
                address,
                topic: research.topic,
                budgetUsdc: research.budgetUsdc,
                signal: sharedAbortController.signal,
              })) {
                const published = publishResearchEvent(researchId, event)
                if (published || isTerminalEvent(event)) safeEnqueue(event)
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Research agent failed'
              const event: AgentEvent = { type: 'error', message }
              if (!sharedAbortController.signal.aborted && !closed) {
                const failed = await researchRepo.updateStatusIfCurrent(researchId, 'running', 'failed', message)
                if (!failed) {
                  const latest = await researchRepo.findById(researchId)
                  const terminal = latest ? persistedTerminalEvent(latest) : null
                  if (terminal) {
                    const published = publishResearchEvent(researchId, terminal)
                    if (published || isTerminalEvent(terminal)) safeEnqueue(terminal)
                  }
                  return
                }
                const published = publishResearchEvent(researchId, event)
                if (published || isTerminalEvent(event)) safeEnqueue(event)
              }
            } finally {
              if (requestAbortListener) {
                req.signal.removeEventListener('abort', requestAbortListener)
                requestAbortListener = null
              }
              markResearchDone(researchId)
              safeClose()
            }
          })()
          return
        }

        unsubscribe = subscribeResearchEvents(researchId, {
          onEvent(event) {
            safeEnqueue(event)
          },
          onDone() {
            unsubscribe?.()
            unsubscribe = null
            safeClose()
          },
        })

        requestAbortListener = () => {
          unsubscribe?.()
          unsubscribe = null
          safeClose()
        }

        if (req.signal.aborted) requestAbortListener()
        else req.signal.addEventListener('abort', requestAbortListener, { once: true })
      },
      cancel() {
        closed = true
        if (requestAbortListener) {
          req.signal.removeEventListener('abort', requestAbortListener)
          requestAbortListener = null
        }
        unsubscribe?.()
        unsubscribe = null
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
