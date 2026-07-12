import { z } from 'zod'
import { requireAuth } from '@/lib/auth/middleware'
import { answerResearchFollowUp } from '@/lib/agent/research-follow-up'
import { researchFollowUpRepo, researchRepo } from '@/lib/db'
import { decimalToUnits } from '@/lib/db/tx-log-repo'

type RouteContext = {
  params: {
    id: string
  }
}

const followUpSchema = z.object({
  question: z.string().trim().min(1).max(500),
})

function serializeFollowUp(record: Awaited<ReturnType<typeof researchFollowUpRepo.listByResearchId>>[number]) {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
  }
}

function followUpConflict(error: 'REPORT_NOT_READY' | 'BUDGET_EXHAUSTED') {
  return Response.json({ error }, { status: 409 })
}

function isEscrowBoundResearch(research: NonNullable<Awaited<ReturnType<typeof researchRepo.findById>>>) {
  return Boolean(research.researchKey && research.escrowAddress)
}

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const research = await researchRepo.findById(params.id)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })

    const followUps = await researchFollowUpRepo.listByResearchId(address, params.id, 200)
    return Response.json({ followUps: followUps.map(serializeFollowUp) })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const body = followUpSchema.safeParse(await req.json().catch(() => null))
    if (!body.success) return Response.json({ error: 'INVALID_BODY' }, { status: 400 })

    const research = await researchRepo.findById(params.id)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
    if (research.status !== 'completed' || !research.reportMd?.trim()) return followUpConflict('REPORT_NOT_READY')

    if (!isEscrowBoundResearch(research)) {
      const remainingBudget = decimalToUnits(research.budgetUsdc) - decimalToUnits(research.spentUsdc)
      if (remainingBudget <= 0n) return followUpConflict('BUDGET_EXHAUSTED')
    }

    const history = await researchFollowUpRepo.listByResearchId(address, params.id, 50)
    const followUp = await researchFollowUpRepo.create({
      researchId: params.id,
      address,
      question: body.data.question,
    })

    try {
      const answerMd = await answerResearchFollowUp({
        topic: research.topic,
        reportMd: research.reportMd,
        history: history
          .filter((entry) => entry.status === 'completed' && Boolean(entry.answerMd))
          .map((entry) => ({
            question: entry.question,
            answerMd: entry.answerMd as string,
          })),
        question: followUp.question,
      })

      const completed = await researchFollowUpRepo.complete(followUp.id, {
        answerMd,
        spentUsdc: '0',
      })

      return Response.json({
        followUp: serializeFollowUp(completed ?? {
          ...followUp,
          answerMd,
          status: 'completed',
          spentUsdc: '0',
          errorMessage: null,
          completedAt: new Date(),
        }),
      })
    } catch (error) {
      const message = 'Follow-up answer generation failed'
      const failed = await researchFollowUpRepo.fail(followUp.id, message)
      return Response.json(
        {
          error: 'FOLLOW_UP_FAILED',
          followUp: failed ? serializeFollowUp(failed) : undefined,
        },
        { status: 502 },
      )
    }
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
