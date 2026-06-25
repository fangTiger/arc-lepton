import { researchRepo, txLogRepo } from '@/lib/db'
import { getGlobalQuotaStatus } from '@/lib/rate-limit/research-quota'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [totalResearches, activeAgents, totalCallsAcrossAllUsers, totalUsdcSpent, dailyResearchQuota] = await Promise.all([
    researchRepo.countAll(),
    researchRepo.countRunning(),
    txLogRepo.count(),
    txLogRepo.totalSpent(),
    getGlobalQuotaStatus(),
  ])

  return Response.json({
    totalResearches,
    totalCallsAcrossAllUsers,
    totalUsdcSpent,
    activeAgents,
    dailyResearchQuota,
  })
}
