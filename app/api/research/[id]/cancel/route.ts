import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo } from '@/lib/db'
import { abortResearch, markResearchDone, publishResearchEvent } from '@/lib/agent/event-bus'

type RouteContext = {
  params: {
    id: string
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const research = await researchRepo.findById(params.id)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
    if (research.status !== 'running') {
      return Response.json({ researchId: params.id, status: research.status })
    }

    const cancelled = await researchRepo.updateStatusIfCurrent(params.id, 'running', 'cancelled', 'Research cancelled')
    if (!cancelled) {
      const latest = await researchRepo.findById(params.id)
      return Response.json({ researchId: params.id, status: latest?.status ?? research.status })
    }

    abortResearch(params.id)
    publishResearchEvent(params.id, { type: 'error', message: 'Research cancelled' })
    markResearchDone(params.id)
    return Response.json({ researchId: params.id, status: 'cancelled' })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
