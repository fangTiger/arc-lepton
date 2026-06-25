import { requireAuth } from '@/lib/auth/middleware'
import { txLogRepo } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const entries = await txLogRepo.listByAddress(address, Number.MAX_SAFE_INTEGER)
    const totalSpentUsdc = await txLogRepo.totalSpentByAddress(address)
    const lastResearchAt = entries[0]?.createdAt.toISOString() ?? null

    return Response.json({
      totalSpentUsdc,
      totalCalls: entries.length,
      lastResearchAt,
    })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
