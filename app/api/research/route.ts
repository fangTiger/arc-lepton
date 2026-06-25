import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo } from '@/lib/db'

function serializeResearch(record: Awaited<ReturnType<typeof researchRepo.listByAddress>>[number]) {
  return {
    ...record,
    startedAt: record.startedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  }
}

export async function GET(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const url = new URL(req.url)
    const limitParam = Number(url.searchParams.get('limit') ?? 50)
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.trunc(limitParam), 1), 100) : 50
    const researches = await researchRepo.listByAddress(address, limit)

    return Response.json({ researches: researches.map(serializeResearch) })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
