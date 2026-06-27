import { isProductionMemoryDbFallback, researchRepo, txLogRepo } from '@/lib/db'
import { decimalToUnits, unitsToDecimal } from '@/lib/db/tx-log-repo'
import { getGlobalQuotaStatus } from '@/lib/rate-limit/research-quota'
import { getPersistedGlobalStats } from '@/lib/stats/global-stats'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [totalResearches, activeAgents, totalCallsAcrossAllUsers, totalUsdcSpent, dailyResearchQuota, persistedStats] = await Promise.all([
    researchRepo.countAll(),
    researchRepo.countRunning(),
    txLogRepo.count(),
    txLogRepo.totalSpent(),
    getGlobalQuotaStatus(),
    getPersistedGlobalStats(),
  ])

  const repoSpentUnits = decimalToUnits(totalUsdcSpent)
  const shouldUsePersistedStats = isProductionMemoryDbFallback() || (
    totalResearches === 0
    && activeAgents === 0
    && totalCallsAcrossAllUsers === 0
    && repoSpentUnits === 0n
  )

  return Response.json({
    totalResearches: shouldUsePersistedStats ? persistedStats.totalResearches : totalResearches,
    totalCallsAcrossAllUsers: shouldUsePersistedStats ? persistedStats.totalCallsAcrossAllUsers : totalCallsAcrossAllUsers,
    totalUsdcSpent: shouldUsePersistedStats ? persistedStats.totalUsdcSpent : unitsToDecimal(repoSpentUnits),
    activeAgents: shouldUsePersistedStats ? persistedStats.activeAgents : activeAgents,
    dailyResearchQuota,
  })
}
