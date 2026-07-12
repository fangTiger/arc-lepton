import { z } from 'zod'
import { assertDurableDbAvailable, researchRepo, workflowOutboxRepo } from '@/lib/db'
import { handleFundingExpiry } from '@/lib/research/funding-expiry'
import { requireResearchWorkerAuth, ResearchWorkerAuthError } from '@/lib/research/worker-auth'

const fundingExpirySchema = z.object({
  researchId: z.string().trim().min(1),
})

export async function POST(req: Request) {
  try {
    requireResearchWorkerAuth(req)
    assertDurableDbAvailable('research funding expiry')

    const body = fundingExpirySchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return Response.json({ error: 'INVALID_BODY' }, { status: 400 })

    const result = await handleFundingExpiry(body.data.researchId, {
      researchRepo,
      workflowOutboxRepo,
      reconcileActivation: async () => ({ status: 'unknown' }),
    })

    return Response.json(result)
  } catch (error) {
    if (error instanceof ResearchWorkerAuthError) {
      return Response.json({ error: error.code }, { status: error.status })
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'DURABLE_DB_REQUIRED') {
      return Response.json({ error: 'DURABLE_DB_REQUIRED' }, { status: 503 })
    }
    throw error
  }
}
