import { z } from 'zod'
import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo } from '@/lib/db'
import { runAgentInBackground } from '@/lib/agent/research-agent'

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

    const research = await researchRepo.create({
      address,
      topic: body.data.topic,
      budgetUsdc: body.data.budgetUsdc,
    })

    void runAgentInBackground(research.id)
    return Response.json({ researchId: research.id, status: 'running' })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
