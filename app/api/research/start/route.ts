import { z } from 'zod'
import { requireAuth } from '@/lib/auth/middleware'
import { isProductionMemoryDbFallback, researchRepo } from '@/lib/db'
import { signResearchRunToken } from '@/lib/agent/research-token'
import { consumeQuota, getQuotaStatus } from '@/lib/rate-limit/research-quota'

const startSchema = z.object({
  topic: z.string().trim().min(1).max(200),
  budgetUsdc: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,8})?$/)
    .refine((value) => {
      const numeric = Number(value)
      return numeric >= 0.001 && numeric <= 1
    }, 'budgetUsdc must be between 0.001 and 1'),
})

export async function POST(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const body = startSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return Response.json({ error: 'INVALID_BODY' }, { status: 400 })

    const quota = await consumeQuota(address)
    if (!quota.ok) {
      return Response.json(
        { error: quota.reason, quota: await getQuotaStatus(address) },
        { status: 429 },
      )
    }

    const research = await researchRepo.create({
      address,
      topic: body.data.topic,
      budgetUsdc: body.data.budgetUsdc,
    })
    const researchId = isProductionMemoryDbFallback()
      ? await signResearchRunToken({
          id: research.id,
          address,
          topic: research.topic,
          budgetUsdc: research.budgetUsdc,
        })
      : research.id

    return Response.json({ researchId, status: 'running' })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
