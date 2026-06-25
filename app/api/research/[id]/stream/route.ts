import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo } from '@/lib/db'
import {
  getResearchEvents,
  subscribeResearchEvents,
} from '@/lib/agent/event-bus'
import type { AgentEvent } from '@/lib/agent/research-agent'

type RouteContext = {
  params: {
    id: string
  }
}

function sse(event: AgentEvent) {
  return `event: agent_event\ndata: ${JSON.stringify(event)}\n\n`
}

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const research = await researchRepo.findById(params.id)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })

    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const history = getResearchEvents(params.id)
        for (const event of history.events) controller.enqueue(encoder.encode(sse(event)))
        if (history.done) {
          controller.close()
          return
        }

        const unsubscribe = subscribeResearchEvents(params.id, {
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
