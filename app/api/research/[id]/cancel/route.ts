import { createHash } from 'node:crypto'
import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo, workflowOutboxRepo } from '@/lib/db'
import { abortResearch, markResearchDone, publishResearchEvent } from '@/lib/agent/event-bus'
import { recordResearchFinished } from '@/lib/stats/global-stats'

type RouteContext = {
  params: {
    id: string
  }
}

function isActiveEscrowResearch(research: Awaited<ReturnType<typeof researchRepo.findById>>) {
  return Boolean(
    research
      && research.status === 'running'
      && research.activationPhase === 'active'
      && research.finalizationState === 'open'
      && research.quotaReservationState === 'consumed'
      && research.researchKey
      && (research.escrowAddress ?? research.expectedEscrowAddress),
  )
}

function cancelDigest(researchId: string, escrowAddress: string | null) {
  return `0x${createHash('sha256')
    .update(JSON.stringify({ type: 'CLOSE', reason: 'cancelled', researchId, escrowAddress }))
    .digest('hex')}`
}

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const research = await researchRepo.findById(params.id)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })
    if (research.status !== 'running') {
      return Response.json({ researchId: params.id, status: research.status, finalizationState: research.finalizationState })
    }

    if (isActiveEscrowResearch(research)) {
      const escrowAddress = research.escrowAddress ?? research.expectedEscrowAddress ?? null
      const digest = cancelDigest(params.id, escrowAddress)
      const cancelled = await researchRepo.requestCancellation({
        id: params.id,
        expected: {
          status: 'running',
          activationPhase: 'active',
          finalizationState: 'open',
          quotaReservationState: 'consumed',
        },
        next: { status: 'cancelled', finalizationState: 'closing' },
        closeOperation: {
          operationKey: `CLOSE:${params.id}`,
          type: 'CLOSE',
          researchId: params.id,
          escrowAddress,
          phase: 'queued',
          payloadHash: digest,
          protectedPayloadDigest: digest,
          leaseOwner: 'cancel-api',
          leaseDurationMs: 30_000,
        },
        workflowOutboxRepo,
      })
      if (!cancelled) {
        const latest = await researchRepo.findById(params.id)
        return Response.json({
          researchId: params.id,
          status: latest?.status ?? research.status,
          finalizationState: latest?.finalizationState ?? research.finalizationState,
        })
      }

      abortResearch(params.id)
      await recordResearchFinished().catch((error) => {
        console.warn('记录全局研究结束统计失败', error)
      })
      publishResearchEvent(params.id, { type: 'error', message: 'Research cancelled' })
      markResearchDone(params.id)
      const latest = await researchRepo.findById(params.id)
      return Response.json({
        researchId: params.id,
        status: latest?.status ?? 'cancelled',
        finalizationState: latest?.finalizationState ?? 'closing',
      })
    }

    const cancelled = await researchRepo.updateStatusIfCurrent(params.id, 'running', 'cancelled', 'Research cancelled')
    if (!cancelled) {
      const latest = await researchRepo.findById(params.id)
      return Response.json({ researchId: params.id, status: latest?.status ?? research.status })
    }

    abortResearch(params.id)
    await recordResearchFinished().catch((error) => {
      console.warn('记录全局研究结束统计失败', error)
    })
    publishResearchEvent(params.id, { type: 'error', message: 'Research cancelled' })
    markResearchDone(params.id)
    return Response.json({ researchId: params.id, status: 'cancelled' })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
