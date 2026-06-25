import { researchRepo, txLogRepo } from '@/lib/db'

export async function GET() {
  const [totalResearches, activeAgents, totalCallsAcrossAllUsers, totalUsdcSpent] = await Promise.all([
    researchRepo.countAll(),
    researchRepo.countRunning(),
    txLogRepo.count(),
    txLogRepo.totalSpent(),
  ])

  return Response.json({
    totalResearches,
    totalCallsAcrossAllUsers,
    totalUsdcSpent,
    activeAgents,
  })
}
