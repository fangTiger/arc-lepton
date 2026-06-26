import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo } from '@/lib/db'
import { verifyResearchRunToken } from '@/lib/agent/research-token'
import {
  getResearchEvents,
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

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const history = getResearchEvents(researchId)
        for (const event of history.events) controller.enqueue(encoder.encode(sse(event)))
        if (history.done) {
          controller.close()
          return
        }

        if (history.events.length === 0 && research.status === 'running') {
          void (async () => {
            try {
              for await (const event of runResearchAgent({
                researchId,
                address,
                topic: research.topic,
                budgetUsdc: research.budgetUsdc,
                signal: req.signal,
              })) {
                publishResearchEvent(researchId, event)
                controller.enqueue(encoder.encode(sse(event)))
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Research agent failed'
              const event: AgentEvent = { type: 'error', message }
              await researchRepo.updateStatus(researchId, 'failed', message)
              publishResearchEvent(researchId, event)
              controller.enqueue(encoder.encode(sse(event)))
            } finally {
              markResearchDone(researchId)
              controller.close()
            }
          })()
          return
        }

        const unsubscribe = subscribeResearchEvents(researchId, {
          onEvent(event) {
            controller.enqueue(encoder.encode(sse(event)))
          },
          onDone() {
            unsubscribe()
            controller.close()
          },
        })

        req.signal.addEventListener('abort', () => unsubscribe(), { once: true })
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
