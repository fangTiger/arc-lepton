import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo } from '@/lib/db'
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

type RouteContext = {
  params: {
    id: string
  }
}

export const maxDuration = 60

function sse(event: AgentEvent) {
  return `event: agent_event\ndata: ${JSON.stringify(event)}\n\n`
}

function isTerminalEvent(event: AgentEvent) {
  return event.type === 'error' || event.type === 'final'
}

function persistedTerminalEvent(research: {
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  reportMd: string | null
  spentUsdc: string
  errorMessage: string | null
}) {
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
      reportMd: null,
      errorMessage: null,
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

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const safeEnqueue = (event: AgentEvent) => {
          if (closed) return false
          try {
            controller.enqueue(encoder.encode(sse(event)))
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

        if (history.events.length === 0 && research.status === 'running' && claimResearchRunner(researchId)) {
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
