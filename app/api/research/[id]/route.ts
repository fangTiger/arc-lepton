import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo, txLogRepo } from '@/lib/db'

type RouteContext = {
  params: {
    id: string
  }
}

function serializeResearch(research: NonNullable<Awaited<ReturnType<typeof researchRepo.findById>>>) {
  return {
    ...research,
    startedAt: research.startedAt.toISOString(),
    completedAt: research.completedAt?.toISOString() ?? null,
  }
}

function serializeTxLog(entry: Awaited<ReturnType<typeof txLogRepo.listByResearchId>>[number]) {
  return {
    ...entry,
    createdAt: entry.createdAt.toISOString(),
  }
}

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const research = await researchRepo.findById(params.id)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })

    const txLog = (await txLogRepo.listByResearchId(address, params.id, 200)).map(serializeTxLog)

    return Response.json({ research: serializeResearch(research), txLog })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
