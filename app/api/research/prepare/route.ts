import { z } from 'zod'
import { requireAuth } from '@/lib/auth/middleware'
import { assertDurableDbAvailableForEscrow, researchRepo } from '@/lib/db'
import { getResearchBackendConfig } from '@/lib/research/backend-config'
import { assertEscrowPrepareRuntimeReady, prepareResearch, ResearchPrepareError } from '@/lib/research/prepare'

const prepareSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  budgetUsdc: z.string().trim(),
})

export async function POST(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const config = getResearchBackendConfig()
    if (config.settlementBackend !== 'escrow') {
      return Response.json({ error: 'ESCROW_BACKEND_DISABLED' }, { status: 409 })
    }
    assertDurableDbAvailableForEscrow('research prepare')
    assertEscrowPrepareRuntimeReady()

    const body = prepareSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return Response.json({ error: 'INVALID_BODY' }, { status: 400 })

    const idempotencyKey = req.headers.get('Idempotency-Key') ?? ''
    const response = await prepareResearch({
      buyer: address,
      topic: body.data.topic,
      budgetUsdc: body.data.budgetUsdc,
      idempotencyKey,
      repo: researchRepo,
    })

    return Response.json(response)
  } catch (error) {
    if (error instanceof Response) return error
    if (error instanceof ResearchPrepareError) {
      return Response.json({ error: error.code }, { status: error.status })
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'DURABLE_DB_REQUIRED') {
      return Response.json({ error: 'DURABLE_DB_REQUIRED' }, { status: 503 })
    }
    throw error
  }
}
