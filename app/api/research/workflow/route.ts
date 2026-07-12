import { z } from 'zod'
import { assertDurableDbAvailable, researchRepo, txLogRepo, workflowManualRecoveryAuditRepo, workflowOutboxRepo } from '@/lib/db'
import { requireResearchWorkerAuth, ResearchWorkerAuthError } from '@/lib/research/worker-auth'
import { processActivationOperation } from '@/lib/research/activation-worker'
import { processClaimedRunOperation } from '@/lib/research/run-worker'
import { settleEscrowResearchPayments, type SettlementChainClient, type SettlementSigner } from '@/lib/research/settlement-client'
import { canonicalSettlementIdFromOperationKey, processSettlementOperation } from '@/lib/research/settlement-worker'
import {
  createResearchWorkflowHandlers,
  processDueWorkflowOperations,
  recoverManualWorkflowOperation,
} from '@/lib/research/workflow-worker'

const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000'

const unconfiguredSettlementSigner: SettlementSigner = {
  async signSettlementAuthorization() {
    throw new Error('ESCROW_SETTLEMENT_SIGNER_NOT_CONFIGURED')
  },
}

const unconfiguredSettlementChainClient: SettlementChainClient = {
  async simulateSettleBatch() {
    throw new Error('ESCROW_SETTLEMENT_CHAIN_CLIENT_NOT_CONFIGURED')
  },
  async writeSettleBatch() {
    throw new Error('ESCROW_SETTLEMENT_CHAIN_CLIENT_NOT_CONFIGURED')
  },
  async waitForSettlementReceipt() {
    throw new Error('ESCROW_SETTLEMENT_CHAIN_CLIENT_NOT_CONFIGURED')
  },
}

const processWorkflowSchema = z.object({
  action: z.literal('process_due').optional(),
  limit: z.number().int().min(1).max(50).optional(),
  workerId: z.string().trim().min(1).max(128).optional(),
})

const manualRecoverySchema = z.object({
  action: z.literal('recover_manual'),
  operationKey: z.string().trim().min(1),
  recoveryAction: z.enum(['requeue', 'mark_closed']),
  operator: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(500),
  evidenceDigest: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
})

const workflowWorkerSchema = z.union([processWorkflowSchema, manualRecoverySchema])

async function submitSettlementFromRoute(operation: { researchId: string; operationKey: string }) {
  const research = await researchRepo.findById(operation.researchId)
  if (!research) throw new Error(`Research missing for SETTLE operation ${operation.researchId}`)
  if (!research.researchKey || !research.escrowAddress || !research.chainId) {
    throw new Error(`Research ${research.id} is missing escrow settlement fields`)
  }

  return settleEscrowResearchPayments({
    research: {
      id: research.id,
      address: research.address,
      researchKey: research.researchKey,
      escrowAddress: research.escrowAddress,
      chainId: research.chainId,
    },
    settlementId: canonicalSettlementIdFromOperationKey(operation.operationKey),
    officialUsdc: ARC_TESTNET_USDC,
    txLogRepo,
    signer: unconfiguredSettlementSigner,
    chainClient: unconfiguredSettlementChainClient,
  })
}

export async function POST(req: Request) {
  try {
    requireResearchWorkerAuth(req)
    assertDurableDbAvailable('research workflow worker')

    let rawBody: unknown
    try {
      rawBody = await req.json()
    } catch {
      return Response.json({ error: 'INVALID_BODY' }, { status: 400 })
    }
    const body = workflowWorkerSchema.safeParse(rawBody)
    if (!body.success) return Response.json({ error: 'INVALID_BODY' }, { status: 400 })

    if (body.data.action === 'recover_manual') {
      const result = await recoverManualWorkflowOperation({
        workflowOutboxRepo,
        researchRepo,
        operationKey: body.data.operationKey,
        action: body.data.recoveryAction,
        operator: body.data.operator,
        reason: body.data.reason,
        evidenceDigest: body.data.evidenceDigest,
        verifyClosedEvidence: async (operation, evidenceDigest) => (
          operation.type === 'CLOSE'
          && Boolean(operation.txHash)
          && Boolean(operation.blockNumber)
          && operation.payloadHash.toLowerCase() === evidenceDigest.toLowerCase()
        ),
        audit: async (entry) => {
          await workflowManualRecoveryAuditRepo.record({
            operationKey: entry.operationKey,
            action: entry.action,
            operator: entry.operator,
            reason: entry.reason,
            evidenceDigest: entry.evidenceDigest,
            previousPhase: entry.previousPhase,
            nextPhase: entry.nextPhase,
            createdAt: entry.at,
          })
        },
      })
      return Response.json(result)
    }

    const summary = await processDueWorkflowOperations({
      workflowOutboxRepo,
      handlers: createResearchWorkflowHandlers({
        researchRepo,
        activate: async (operation) => {
          await processActivationOperation(operation, {
            researchRepo,
            workflowOutboxRepo,
            submitActivation: async () => {
              throw new Error('ACTIVATION_SUBMIT_NOT_CONFIGURED')
            },
            confirmActivation: async () => ({ status: 'unknown' }),
            workerId: operation.leaseOwner ?? undefined,
          })
        },
        run: async (operation, research) => {
          await processClaimedRunOperation({ operation, research })
        },
        settle: async (operation) => {
          await processSettlementOperation(operation, {
            researchRepo,
            txLogRepo,
            workflowOutboxRepo,
            officialUsdc: ARC_TESTNET_USDC,
            submitSettlement: () => submitSettlementFromRoute(operation),
            recoverSettlement: async () => ({ status: 'unknown' }),
          })
        },
        reconcile: async (operation) => {
          await processSettlementOperation(operation, {
            researchRepo,
            txLogRepo,
            workflowOutboxRepo,
            officialUsdc: ARC_TESTNET_USDC,
            submitSettlement: () => submitSettlementFromRoute(operation),
            recoverSettlement: async () => ({ status: 'unknown' }),
          })
        },
        close: async () => {
          throw new Error('CLOSE_HANDLER_NOT_CONFIGURED')
        },
      }),
      onManual: async (operation) => {
        const research = await researchRepo.findById(operation.researchId)
        if (!research || research.finalizationState !== 'closing') return
        await researchRepo.transitionLifecycle(
          research.id,
          {
            status: research.status,
            activationPhase: research.activationPhase,
            finalizationState: research.finalizationState,
            quotaReservationState: research.quotaReservationState,
          },
          { finalizationState: 'manual' },
        )
      },
      workerId: body.data.workerId,
      limit: body.data.limit,
    })
    return Response.json(summary)
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
