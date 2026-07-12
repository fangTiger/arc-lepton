import { z } from 'zod'
import { keccak256, toBytes, verifyTypedData } from 'viem'
import { requireAuth } from '@/lib/auth/middleware'
import { assertDurableDbAvailableForEscrow, isProductionMemoryDbFallback, researchRepo, workflowOutboxRepo } from '@/lib/db'
import { signResearchRunToken } from '@/lib/agent/research-token'
import { consumeQuota, getQuotaStatus } from '@/lib/rate-limit/research-quota'
import { recordResearchStarted } from '@/lib/stats/global-stats'
import { getResearchBackendConfig } from '@/lib/research/backend-config'
import { activationOperationKey } from '@/lib/research/funding-expiry'

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

const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/)
const hexAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const decimalUintSchema = z.string().regex(/^[0-9]+$/)

const escrowStartSchema = z.object({
  researchId: z.string().trim().min(1),
  fundingTxHash: hex32Schema,
  fundingLogIndex: z.number().int().nonnegative(),
  activationAuthorization: z.object({
    escrow: hexAddressSchema,
    researchKey: hex32Schema,
    buyer: hexAddressSchema,
    intentSigner: hexAddressSchema,
    initialBudget: decimalUintSchema,
    expectedExpiresAt: decimalUintSchema,
    activationNonce: decimalUintSchema,
    deadline: decimalUintSchema,
  }),
  activationSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
})

const activationAuthorizationTypes = {
  ActivationAuthorization: [
    { name: 'escrow', type: 'address' },
    { name: 'researchKey', type: 'bytes32' },
    { name: 'buyer', type: 'address' },
    { name: 'intentSigner', type: 'address' },
    { name: 'initialBudget', type: 'uint256' },
    { name: 'expectedExpiresAt', type: 'uint64' },
    { name: 'activationNonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const

export async function POST(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const rawBody = await req.json().catch(() => null)
    if (getResearchBackendConfig().settlementBackend === 'escrow') {
      return startEscrowResearch(address, rawBody)
    }

    const body = startSchema.safeParse(rawBody)
    if (!body.success) return Response.json({ error: 'INVALID_BODY' }, { status: 400 })

    if (isProductionMemoryDbFallback() && !isMockReceiptMode()) {
      return Response.json({ error: 'DURABLE_DB_REQUIRED' }, { status: 503 })
    }

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
    await recordResearchStarted().catch((error) => {
      console.warn('记录全局研究统计失败', error)
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

function isMockReceiptMode() {
  return process.env.ARC_RECEIPT_MODE?.trim().toLowerCase() !== 'arc'
}

async function startEscrowResearch(address: string, rawBody: unknown) {
  assertDurableDbAvailableForEscrow('research start')

  const body = escrowStartSchema.safeParse(rawBody)
  if (!body.success) {
    return Response.json({ error: 'ESCROW_START_REQUIRES_FUNDING_RECEIPT' }, { status: 400 })
  }

  const research = await researchRepo.findById(body.data.researchId)
  if (!research) {
    return Response.json({ error: 'RESEARCH_NOT_FOUND' }, { status: 404 })
  }
  if (research.address.toLowerCase() !== address.toLowerCase()) {
    return Response.json({ error: 'BUYER_MISMATCH' }, { status: 403 })
  }
  if (shouldReturnExistingEscrowState(research)) {
    return Response.json({
      researchId: research.id,
      status: research.status,
      activationPhase: research.activationPhase,
      finalizationState: research.finalizationState,
    })
  }
  if (research.status === 'running' && research.activationPhase === 'active') {
    return Response.json({
      researchId: research.id,
      status: 'running',
      activationPhase: 'active',
    })
  }
  if (
    research.status === 'funding'
    && research.activationPhase === 'activating'
    && research.quotaReservationState === 'activating'
  ) {
    if (!activationMatchesResearch(body.data.activationAuthorization, research)) {
      return Response.json({ error: 'ACTIVATION_AUTHORIZATION_MISMATCH' }, { status: 409 })
    }
    return Response.json({
      researchId: research.id,
      status: 'funding',
      activationPhase: 'activating',
    }, { status: 202 })
  }
  if (research.status !== 'funding' || research.activationPhase !== 'funded') {
    return Response.json({ error: 'START_NOT_ALLOWED' }, { status: 409 })
  }
  if (!activationMatchesResearch(body.data.activationAuthorization, research)) {
    return Response.json({ error: 'ACTIVATION_AUTHORIZATION_MISMATCH' }, { status: 409 })
  }

  const configuredChainId = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID)
  if (research.chainId && Number.isFinite(configuredChainId) && research.chainId !== configuredChainId) {
    return Response.json({ error: 'FUNDING_EVIDENCE_MISMATCH' }, { status: 409 })
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const expectedExpiresAtSeconds = Number(body.data.activationAuthorization.expectedExpiresAt)
  if (expectedExpiresAtSeconds - nowSeconds < 60 * 60) {
    return Response.json({ error: 'ESCROW_TTL_TOO_SHORT' }, { status: 409 })
  }
  const activationDeadlineSeconds = Number(body.data.activationAuthorization.deadline)
  const fundingDeadlineSeconds = research.fundingDeadline
    ? Math.floor(research.fundingDeadline.getTime() / 1000)
    : null
  if (!fundingDeadlineSeconds || activationDeadlineSeconds > fundingDeadlineSeconds) {
    return Response.json({ error: 'ACTIVATION_DEADLINE_AFTER_FUNDING_DEADLINE' }, { status: 409 })
  }
  if (activationDeadlineSeconds - nowSeconds < 2 * 60) {
    return Response.json({ error: 'ACTIVATION_WINDOW_TOO_SHORT' }, { status: 409 })
  }
  if (!await verifyActivationSignature(body.data, configuredChainId)) {
    return Response.json({ error: 'ACTIVATION_SIGNATURE_INVALID' }, { status: 401 })
  }

  const publicPayload = {
    researchId: research.id,
    fundingTxHash: body.data.fundingTxHash,
    fundingLogIndex: body.data.fundingLogIndex,
    activationAuthorization: body.data.activationAuthorization,
  }
  const protectedPayload = stableJson({
    ...publicPayload,
    activationSignature: body.data.activationSignature,
  })

  const begun = await researchRepo.beginActivation({
    id: research.id,
    expected: {
      status: 'funding',
      activationPhase: research.activationPhase,
      finalizationState: 'none',
      quotaReservationState: 'reserved',
    },
    next: { activationPhase: 'activating', quotaReservationState: 'activating' },
    activateOperation: {
      operationKey: activationOperationKey(research.id),
      type: 'ACTIVATE',
      researchId: research.id,
      escrowAddress: research.escrowAddress ?? research.expectedEscrowAddress,
      phase: 'queued',
      payloadHash: digestJson(publicPayload),
      protectedPayloadDigest: digestString(protectedPayload),
      protectedPayload,
      leaseOwner: 'start-api',
      leaseDurationMs: 30_000,
    },
    workflowOutboxRepo,
  })
  if (!begun) {
    return Response.json({ error: 'START_RACE_LOST' }, { status: 409 })
  }

  return Response.json({
    researchId: research.id,
    status: 'funding',
    activationPhase: 'activating',
  }, { status: 202 })
}

function normalizeHex(value: string | null) {
  return value?.toLowerCase() ?? null
}

function epochSeconds(value: Date | null) {
  return value ? String(Math.floor(value.getTime() / 1000)) : null
}

function shouldReturnExistingEscrowState(
  research: NonNullable<Awaited<ReturnType<typeof researchRepo.findById>>>,
) {
  return research.status === 'completed'
    || research.status === 'failed'
    || research.status === 'cancelled'
    || research.status === 'funding_expired'
    || research.finalizationState === 'closing'
    || research.finalizationState === 'closed'
    || research.finalizationState === 'manual'
}

function activationMatchesResearch(
  authorization: z.infer<typeof escrowStartSchema>['activationAuthorization'],
  research: NonNullable<Awaited<ReturnType<typeof researchRepo.findById>>>,
) {
  return normalizeHex(research.escrowAddress) === normalizeHex(authorization.escrow)
    && normalizeHex(research.researchKey) === normalizeHex(authorization.researchKey)
    && normalizeHex(research.buyer) === normalizeHex(authorization.buyer)
    && normalizeHex(research.intentSigner) === normalizeHex(authorization.intentSigner)
    && research.budgetUnits === authorization.initialBudget
    && epochSeconds(research.expectedExpiresAt) === authorization.expectedExpiresAt
}

async function verifyActivationSignature(body: z.infer<typeof escrowStartSchema>, chainId: number) {
  try {
    return await verifyTypedData({
      address: body.activationAuthorization.buyer as `0x${string}`,
      domain: {
        name: 'ArcLeptonResearchEscrow',
        version: '1',
        chainId: BigInt(chainId),
        verifyingContract: body.activationAuthorization.escrow as `0x${string}`,
      },
      types: activationAuthorizationTypes,
      primaryType: 'ActivationAuthorization',
      message: {
        escrow: body.activationAuthorization.escrow as `0x${string}`,
        researchKey: body.activationAuthorization.researchKey as `0x${string}`,
        buyer: body.activationAuthorization.buyer as `0x${string}`,
        intentSigner: body.activationAuthorization.intentSigner as `0x${string}`,
        initialBudget: BigInt(body.activationAuthorization.initialBudget),
        expectedExpiresAt: BigInt(body.activationAuthorization.expectedExpiresAt),
        activationNonce: BigInt(body.activationAuthorization.activationNonce),
        deadline: BigInt(body.activationAuthorization.deadline),
      },
      signature: body.activationSignature as `0x${string}`,
    })
  } catch {
    return false
  }
}

function stableJson(value: unknown) {
  return JSON.stringify(value)
}

function digestJson(value: unknown) {
  return digestString(stableJson(value))
}

function digestString(value: string) {
  return keccak256(toBytes(value))
}
