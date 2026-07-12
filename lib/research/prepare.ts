import { randomUUID } from 'node:crypto'
import { isAddress, keccak256, toBytes, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Research, ResearchRepo } from '@/lib/db/research-repo'
import { parseScale8DecimalToUnits6, units6ToScale8 } from '@/lib/chain/amounts'
import { researchKey as deriveResearchKey } from '@/lib/chain/canonical'
import { predictResearchEscrowAddress } from '@/lib/chain/escrow-address'
import { normalizeDecimalString, unitsToDecimal } from '@/lib/db/tx-log-repo'

export const FUNDING_WINDOW_MS = 15 * 60 * 1000
export const EXPECTED_EXPIRES_MS = 24 * 60 * 60 * 1000
export const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000'
export const RESEARCH_WALLET_DAILY_LIMIT = 10
export const RESEARCH_GLOBAL_DAILY_LIMIT = 100

export class ResearchPrepareError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ResearchPrepareError'
  }
}

export type ResearchPrepareConfig = {
  chainId: number
  factoryAddress: `0x${string}`
  implementationAddress: `0x${string}`
  usdcAddress: `0x${string}`
  intentSigner: `0x${string}`
  fundingSignerPrivateKey: Hex
  fundingSignerAddress: `0x${string}`
}

export type PrepareResearchInput = {
  buyer: string
  topic: string
  budgetUsdc: string
  idempotencyKey: string
  repo: ResearchRepo
  now?: Date
  config?: ResearchPrepareConfig
}

export type PrepareResearchResponse = {
  researchId: string
  status: 'funding'
  activationPhase: 'none' | 'funded' | 'activating' | 'active' | 'expired' | 'cancelled'
  quotaReservationState: 'reserved' | 'activating' | 'consumed' | 'released' | 'none'
  buyer: string
  topic: string
  budgetUsdc: string
  budgetUnits: string
  chainId: number
  factory: string
  implementation: string
  usdc: string
  intentSigner: string
  researchKey: string
  expectedEscrowAddress: string
  expectedExpiresAt: string
  fundingDeadline: string
  fundingVoucher: {
    buyer: string
    researchKey: string
    budgetUnits: string
    expectedExpiresAt: string
    fundingDeadline: string
    intentSigner: string
    voucherNonce: string
  }
  fundingSigner: string
  fundingSignature: Hex
}

export async function prepareResearch(input: PrepareResearchInput): Promise<PrepareResearchResponse> {
  const config = input.config ?? getResearchPrepareConfig()
  const buyer = normalizeAddress(input.buyer, 'buyer')
  const topic = normalizeTopic(input.topic)
  const prepareRequestId = normalizeIdempotencyKey(input.idempotencyKey)
  const budgetUnits = parseBudgetUnits(input.budgetUsdc)
  const budgetUsdc = unitsToDecimal(units6ToScale8(budgetUnits))

  const existing = await input.repo.findByPrepareRequestId(prepareRequestId)
  if (existing) {
    if (!samePrepareScope(existing, { buyer, topic, budgetUsdc })) {
      throw new ResearchPrepareError(
        'PREPARE_IDEMPOTENCY_CONFLICT',
        409,
        'Idempotency-Key 已绑定到不同 buyer、topic 或 budget',
      )
    }
    return responseFromResearch(existing, config)
  }

  const now = input.now ? new Date(input.now) : new Date()
  const quotaDay = now.toISOString().slice(0, 10)
  const quotaResetAt = nextUtcMidnight(now)
  const researchId = randomUUID()
  const derivedResearchKey = deriveResearchKey(config.chainId, buyer, researchId)
  const expectedEscrowAddress = predictResearchEscrowAddress({
    factory: config.factoryAddress,
    implementation: config.implementationAddress,
    buyer,
    researchKey: derivedResearchKey,
  })
  const fundingDeadline = new Date(now.getTime() + FUNDING_WINDOW_MS)
  const expectedExpiresAt = new Date(now.getTime() + EXPECTED_EXPIRES_MS)
  const voucherNonce = deriveVoucherNonce(prepareRequestId, researchId)

  const result = await input.repo.createFundingWithQuotaReservation({
    id: researchId,
    address: buyer,
    prepareRequestId,
    buyer,
    topic,
    budgetUsdc,
    budgetUnits: budgetUnits.toString(),
    researchKey: derivedResearchKey,
    expectedEscrowAddress,
    fundingExpiresAt: fundingDeadline,
    expectedExpiresAt,
    fundingDeadline,
    intentSigner: config.intentSigner,
    voucherNonce,
    quotaDate: quotaDay,
    chainId: config.chainId,
  }, {
    day: quotaDay,
    resetAt: quotaResetAt,
    walletLimit: RESEARCH_WALLET_DAILY_LIMIT,
    globalLimit: RESEARCH_GLOBAL_DAILY_LIMIT,
  })
  if (!result.ok) {
    throw new ResearchPrepareError(result.reason, 429, 'quota reservation 已达到每日限制')
  }
  if (!samePrepareScope(result.research, { buyer, topic, budgetUsdc })) {
    throw new ResearchPrepareError(
      'PREPARE_IDEMPOTENCY_CONFLICT',
      409,
      'Idempotency-Key 已绑定到不同 buyer、topic 或 budget',
    )
  }

  return responseFromResearch(result.research, config)
}

export function assertEscrowPrepareRuntimeReady(env: Record<string, string | undefined> = process.env) {
  const workerSecret = env.ARC_RESEARCH_WORKER_AUTH_SECRET?.trim()
  if (!workerSecret || workerSecret.length < 32) {
    throw new ResearchPrepareError('DURABLE_DB_REQUIRED', 503, 'Escrow prepare 需要受保护 worker 鉴权配置')
  }
}

export function getResearchPrepareConfig(env: Record<string, string | undefined> = process.env): ResearchPrepareConfig {
  const chainId = Number(env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '')
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new ResearchPrepareError('ESCROW_CONFIG_REQUIRED', 503, 'NEXT_PUBLIC_ARC_CHAIN_ID 未配置')
  }
  const fundingSignerPrivateKey = requiredPrivateKey(
    env.ARC_RESEARCH_FUNDING_SIGNER_PRIVATE_KEY,
    'ARC_RESEARCH_FUNDING_SIGNER_PRIVATE_KEY',
  )
  const fundingSignerAccount = privateKeyToAccount(fundingSignerPrivateKey)
  const expectedFundingSigner = env.ARC_RESEARCH_FUNDING_SIGNER_ADDRESS
    ? requiredAddress(env.ARC_RESEARCH_FUNDING_SIGNER_ADDRESS, 'ARC_RESEARCH_FUNDING_SIGNER_ADDRESS')
    : fundingSignerAccount.address
  if (fundingSignerAccount.address.toLowerCase() !== expectedFundingSigner.toLowerCase()) {
    throw new ResearchPrepareError(
      'ESCROW_CONFIG_REQUIRED',
      503,
      'ARC_RESEARCH_FUNDING_SIGNER_ADDRESS 与私钥派生地址不一致',
    )
  }

  return {
    chainId,
    factoryAddress: requiredAddress(env.ARC_RESEARCH_FACTORY_ADDRESS, 'ARC_RESEARCH_FACTORY_ADDRESS'),
    implementationAddress: requiredAddress(
      env.ARC_RESEARCH_ESCROW_IMPLEMENTATION_ADDRESS,
      'ARC_RESEARCH_ESCROW_IMPLEMENTATION_ADDRESS',
    ),
    usdcAddress: requiredAddress(env.ARC_RESEARCH_USDC_ADDRESS ?? ARC_TESTNET_USDC, 'ARC_RESEARCH_USDC_ADDRESS'),
    intentSigner: requiredAddress(env.ARC_RESEARCH_INTENT_SIGNER_ADDRESS, 'ARC_RESEARCH_INTENT_SIGNER_ADDRESS'),
    fundingSignerPrivateKey,
    fundingSignerAddress: fundingSignerAccount.address,
  }
}

async function responseFromResearch(research: Research, config: ResearchPrepareConfig): Promise<PrepareResearchResponse> {
  const researchKey = requireStored(research.researchKey, 'researchKey')
  const budgetUnits = requireStored(research.budgetUnits, 'budgetUnits')
  const expectedEscrowAddress = requireStored(research.expectedEscrowAddress, 'expectedEscrowAddress')
  const expectedExpiresAt = requireDate(research.expectedExpiresAt, 'expectedExpiresAt')
  const fundingDeadline = requireDate(research.fundingDeadline ?? research.fundingExpiresAt, 'fundingDeadline')
  const intentSigner = requireStored(research.intentSigner ?? config.intentSigner, 'intentSigner')
  const voucherNonce = requireStored(research.voucherNonce, 'voucherNonce')
  const fundingVoucher = {
    buyer: research.buyer ?? research.address,
    researchKey,
    budgetUnits,
    expectedExpiresAt: secondsString(expectedExpiresAt),
    fundingDeadline: secondsString(fundingDeadline),
    intentSigner,
    voucherNonce,
  }

  return {
    researchId: research.id,
    status: 'funding',
    activationPhase: research.activationPhase,
    quotaReservationState: research.quotaReservationState,
    buyer: research.buyer ?? research.address,
    topic: research.topic,
    budgetUsdc: research.budgetUsdc,
    budgetUnits,
    chainId: config.chainId,
    factory: config.factoryAddress,
    implementation: config.implementationAddress,
    usdc: config.usdcAddress,
    intentSigner,
    researchKey,
    expectedEscrowAddress,
    expectedExpiresAt: expectedExpiresAt.toISOString(),
    fundingDeadline: fundingDeadline.toISOString(),
    fundingVoucher,
    fundingSigner: config.fundingSignerAddress,
    fundingSignature: await signFundingVoucher(config, fundingVoucher),
  }
}

function samePrepareScope(
  research: Research,
  expected: { buyer: string; topic: string; budgetUsdc: string },
) {
  return (
    research.address.toLowerCase() === expected.buyer
    && (research.buyer ?? research.address).toLowerCase() === expected.buyer
    && research.topic === expected.topic
    && normalizeDecimalString(research.budgetUsdc) === expected.budgetUsdc
  )
}

function parseBudgetUnits(value: string) {
  let parsed: bigint
  try {
    parsed = parseScale8DecimalToUnits6(value.trim())
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INVALID_BUDGET'
    throw new ResearchPrepareError(code, 400, 'budgetUsdc 必须可精确表示为 6 位 USDC units')
  }
  if (parsed < 1_000n || parsed > 1_000_000n) {
    throw new ResearchPrepareError('BUDGET_OUT_OF_RANGE', 400, 'budgetUsdc must be between 0.001 and 1')
  }
  return parsed
}

function normalizeAddress(value: string, path: string) {
  if (!isAddress(value)) {
    throw new ResearchPrepareError('INVALID_ADDRESS', 400, `${path} 必须是 EVM 地址`)
  }
  return value.toLowerCase()
}

function normalizeTopic(value: string) {
  const topic = value.trim()
  if (!topic || topic.length > 200) {
    throw new ResearchPrepareError('INVALID_BODY', 400, 'topic 不能为空且不得超过 200 字符')
  }
  return topic
}

function normalizeIdempotencyKey(value: string) {
  const key = value.trim()
  if (!key || key.length > 200) {
    throw new ResearchPrepareError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key 必须是非空稳定值')
  }
  return key
}

function requiredAddress(value: string | undefined, name: string): `0x${string}` {
  if (!value || !isAddress(value) || /^0x0{40}$/i.test(value)) {
    throw new ResearchPrepareError('ESCROW_CONFIG_REQUIRED', 503, `${name} 必须配置为非零 EVM 地址`)
  }
  return value as `0x${string}`
}

function requiredPrivateKey(value: string | undefined, name: string): Hex {
  if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new ResearchPrepareError('ESCROW_CONFIG_REQUIRED', 503, `${name} 必须配置为非零 32-byte 私钥`)
  }
  return value as Hex
}

function deriveVoucherNonce(prepareRequestId: string, researchId: string) {
  return BigInt(keccak256(toBytes(`${prepareRequestId}:${researchId}`))).toString()
}

function requireStored(value: string | null, path: string) {
  if (!value) {
    throw new ResearchPrepareError('PREPARE_RECORD_INCOMPLETE', 500, `${path} 缺失`)
  }
  return value
}

function requireDate(value: Date | null, path: string) {
  if (!value) {
    throw new ResearchPrepareError('PREPARE_RECORD_INCOMPLETE', 500, `${path} 缺失`)
  }
  return value
}

function secondsString(value: Date) {
  return Math.trunc(value.getTime() / 1000).toString()
}

function nextUtcMidnight(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1))
}

const fundingVoucherTypes = {
  FundingVoucher: [
    { name: 'buyer', type: 'address' },
    { name: 'researchKey', type: 'bytes32' },
    { name: 'budgetUnits', type: 'uint256' },
    { name: 'expectedExpiresAt', type: 'uint64' },
    { name: 'fundingDeadline', type: 'uint64' },
    { name: 'intentSigner', type: 'address' },
    { name: 'voucherNonce', type: 'uint256' },
  ],
} as const

async function signFundingVoucher(
  config: ResearchPrepareConfig,
  voucher: PrepareResearchResponse['fundingVoucher'],
): Promise<Hex> {
  const account = privateKeyToAccount(config.fundingSignerPrivateKey)
  return account.signTypedData({
    domain: {
      name: 'ArcLeptonResearchEscrowFactory',
      version: '1',
      chainId: BigInt(config.chainId),
      verifyingContract: config.factoryAddress,
    },
    types: fundingVoucherTypes,
    primaryType: 'FundingVoucher',
    message: {
      buyer: voucher.buyer as Hex,
      researchKey: voucher.researchKey as Hex,
      budgetUnits: BigInt(voucher.budgetUnits),
      expectedExpiresAt: BigInt(voucher.expectedExpiresAt),
      fundingDeadline: BigInt(voucher.fundingDeadline),
      intentSigner: voucher.intentSigner as Hex,
      voucherNonce: BigInt(voucher.voucherNonce),
    },
  })
}
