import { requireAuth } from '@/lib/auth/middleware'
import { txLogRepo } from '@/lib/db'
import { isBillableTxStatus } from '@/lib/db/tx-log-repo'

export async function GET(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const entries = await txLogRepo.listByAddress(address, Number.MAX_SAFE_INTEGER)
    const totalSpentUsdc = await txLogRepo.totalSpentByAddress(address)
    const lastResearchAt = entries[0]?.createdAt.toISOString() ?? null
    const totalCalls = entries.filter((entry) => isBillableTxStatus(entry.txStatus)).length

    return Response.json({
      totalSpentUsdc,
      totalCalls,
      lastResearchAt,
    })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
