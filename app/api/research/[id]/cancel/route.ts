import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo } from '@/lib/db'
import { abortResearch, publishResearchEvent } from '@/lib/agent/event-bus'

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

    abortResearch(params.id)
    await researchRepo.updateStatus(params.id, 'cancelled', 'Research cancelled')
    publishResearchEvent(params.id, { type: 'error', message: 'Research cancelled' })
    return Response.json({ researchId: params.id, status: 'cancelled' })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
