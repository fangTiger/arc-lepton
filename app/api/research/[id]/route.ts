import { requireAuth } from '@/lib/auth/middleware'
import { researchRepo, txLogRepo, workflowOutboxRepo } from '@/lib/db'
import { escrowSettlementOperationKey, serializeTxLogEntry } from '@/lib/research/tx-log-serialization'

const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000'

type RouteContext = {
  params: {
    id: string
  }
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function optionalChainId(value: string | undefined) {
  if (!value) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function hasEscrowEvidence(research: NonNullable<Awaited<ReturnType<typeof researchRepo.findById>>>) {
  return Boolean(research.researchKey || research.expectedEscrowAddress || research.escrowAddress)
}

function serializeEscrowConfig(research: NonNullable<Awaited<ReturnType<typeof researchRepo.findById>>>) {
  if (!hasEscrowEvidence(research)) return null
  return {
    chainId: research.chainId ?? optionalChainId(process.env.NEXT_PUBLIC_ARC_CHAIN_ID),
    factory: optionalEnv('ARC_RESEARCH_FACTORY_ADDRESS'),
    usdc: optionalEnv('ARC_RESEARCH_USDC_ADDRESS') ?? ARC_TESTNET_USDC,
    explorerBase: optionalEnv('NEXT_PUBLIC_ARC_EXPLORER_URL'),
  }
}

function serializeResearch(research: NonNullable<Awaited<ReturnType<typeof researchRepo.findById>>>) {
  return {
    ...research,
    createdAt: research.createdAt.toISOString(),
    preparedAt: research.preparedAt?.toISOString() ?? null,
    fundingExpiresAt: research.fundingExpiresAt?.toISOString() ?? null,
    expectedExpiresAt: research.expectedExpiresAt?.toISOString() ?? null,
    fundingDeadline: research.fundingDeadline?.toISOString() ?? null,
    cancelRequestedAt: research.cancelRequestedAt?.toISOString() ?? null,
    startedAt: research.startedAt?.toISOString() ?? null,
    completedAt: research.completedAt?.toISOString() ?? null,
  }
}

async function serializeTxLog(entry: Awaited<ReturnType<typeof txLogRepo.listByResearchId>>[number]) {
  const operationKey = escrowSettlementOperationKey(entry)
  const operation = operationKey ? await workflowOutboxRepo.findByOperationKey(operationKey) : null
  return serializeTxLogEntry(entry, operation)
}

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const { address } = await requireAuth(req)
    const research = await researchRepo.findById(params.id)
    if (!research) return Response.json({ error: 'NOT_FOUND' }, { status: 404 })
    if (research.address !== address) return Response.json({ error: 'FORBIDDEN' }, { status: 403 })

    const txLog = await Promise.all((await txLogRepo.listByResearchId(address, params.id, 200)).map(serializeTxLog))

    return Response.json({ research: serializeResearch(research), escrowConfig: serializeEscrowConfig(research), txLog })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
