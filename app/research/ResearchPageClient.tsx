'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Hex } from 'viem'
import { useAccount, useChainId, usePublicClient, useSignTypedData, useSwitchChain, useWriteContract } from 'wagmi'
import { AgentLogStream } from '@/components/research/AgentLogStream'
import { BudgetMeter } from '@/components/research/BudgetMeter'
import { TerminalMarkdown } from '@/components/research/TerminalMarkdown'
import { TxFeed } from '@/components/research/TxFeed'
import type { AgentEvent, ResearchFollowUpRecord, ResearchRecord, TxLogRecord } from '@/components/research/types'
import { mergeTxLogIntoEvents, utcDateTime, utcTime } from '@/components/research/types'
import { useUser } from '@/hooks/useUser'
import { ARC_CHAIN_ID } from '@/lib/constants'

type TimedEvent = AgentEvent & { receivedAt?: string }

type QuotaBucket = {
  consumed?: number
  reserved?: number
  used: number
  limit: number
  remaining: number
  resetAt: string
}

type QuotaStatus = {
  wallet: QuotaBucket
  global: QuotaBucket
}

type ResearchBackendConfig = {
  settlementBackend?: 'calldata' | 'escrow'
  fundingUiEnabled?: boolean
}

type PrepareResearchResponse = {
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
  fundingSignature: `0x${string}`
}

type FundingStep =
  | 'idle'
  | 'preparing'
  | 'needs_approve'
  | 'needs_create'
  | 'prepared'
  | 'checking_allowance'
  | 'approving'
  | 'funding'
  | 'funded'
  | 'signing_activation'
  | 'activating'
  | 'failed'

type ActivationAuthorization = {
  escrow: string
  researchKey: string
  buyer: string
  intentSigner: string
  initialBudget: string
  expectedExpiresAt: string
  activationNonce: string
  deadline: string
}

type FundingIntent = {
  prepare: PrepareResearchResponse
  idempotencyKey: string
  step: FundingStep
  fundingTxHash: `0x${string}` | null
  fundingLogIndex: number | null
  activationAuthorization: ActivationAuthorization | null
  activationSignature: `0x${string}` | null
}

const promptPool = [
  'SHOULD I BUY PEPE?',
  'BTC PRICE PREDICTION',
  'SOL ECOSYSTEM HEALTH',
  'MEME COIN MOMENTUM',
  'ETH GAS TREND',
  'DOGE VS SHIB',
  'IS THIS ALT SZN?',
  'STABLECOIN RISK CHECK',
  'WHO LEADS L2 FLOW?',
  'CAN BASE KEEP RUNNING?',
  'WHAT ARE WHALES BUYING?',
  'WHICH NARRATIVE IS HOT?',
]

const TOPIC_ROTATE_MS = 4_500
const VISIBLE_QUICK_PROMPTS = 6
const TX_LOG_POLL_MS = 5_000
const MAX_ESTIMATED_PAID_CALLS = 3
const FUNDING_INTENT_STORAGE_KEY = 'arc:research-funding-state'

const erc20Abi = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const researchEscrowFactoryAbi = [
  {
    type: 'function',
    name: 'createAndFund',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'voucher',
        type: 'tuple',
        components: [
          { name: 'buyer', type: 'address' },
          { name: 'researchKey', type: 'bytes32' },
          { name: 'budgetUnits', type: 'uint256' },
          { name: 'expectedExpiresAt', type: 'uint64' },
          { name: 'fundingDeadline', type: 'uint64' },
          { name: 'intentSigner', type: 'address' },
          { name: 'voucherNonce', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'escrow', type: 'address' }],
  },
] as const

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

function shufflePrompts(prompts: string[]) {
  const shuffled = [...prompts]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    ;[shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]]
  }
  return shuffled
}

function estimatedCalls(budget: string) {
  const numeric = Number(budget)
  if (!Number.isFinite(numeric)) return '0'
  const baseline = Math.min(MAX_ESTIMATED_PAID_CALLS, Math.max(1, Math.floor(numeric / 0.0012)))
  const upper = Math.min(MAX_ESTIMATED_PAID_CALLS, baseline + 2)
  return baseline === upper ? String(baseline) : `${baseline}-${upper}`
}

function formatBudget(value: number) {
  return value.toFixed(4)
}

function sameAddress(left: string | undefined | null, right: string | undefined | null) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}

function toHexAddress(value: string) {
  return value as `0x${string}`
}

function toHexHash(value: string) {
  return value as `0x${string}`
}

function unixSeconds(value: string) {
  if (/^\d+$/.test(value)) return Number(value)
  return Math.floor(Date.parse(value) / 1000)
}

function stablePrepareKey() {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `research-${randomId}`
}

function shortHash(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function fundingStepLabel(step: FundingStep) {
  if (step === 'idle') return 'IDLE'
  if (step === 'preparing') return 'PREPARING'
  if (step === 'needs_approve') return 'NEEDS APPROVE'
  if (step === 'needs_create') return 'READY TO FUND'
  if (step === 'prepared') return 'PREPARED'
  if (step === 'checking_allowance') return 'CHECKING ALLOWANCE'
  if (step === 'approving') return 'APPROVING USDC'
  if (step === 'funding') return 'CREATE AND FUND'
  if (step === 'funded') return 'FUNDED'
  if (step === 'signing_activation') return 'SIGN ACTIVATION'
  if (step === 'activating') return 'ACTIVATING'
  return 'FAILED'
}

function isWalletRejection(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? '').toLowerCase()
  return message.includes('reject') || message.includes('denied') || message.includes('cancel')
}

function startFailureMessage(status: number, code?: string) {
  if (status === 401) return 'Authentication expired. Please sign in again.'
  if (code === 'DURABLE_DB_REQUIRED' || status === 503) {
    return 'Research service is temporarily unavailable. Please try again after maintenance.'
  }
  if (status >= 500) return 'Research could not be started. Please try again.'
  return 'Research could not be started. Please check the request and try again.'
}

function parseStoredFundingIntent(value: string | null): FundingIntent | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as FundingIntent
    if (!parsed?.prepare?.researchId || !parsed.idempotencyKey) return null
    if (Date.parse(parsed.prepare.fundingDeadline) <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

function quotaBar(bucket: QuotaBucket) {
  const width = 10
  const ratio = bucket.limit > 0 ? bucket.used / bucket.limit : 1
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)))
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

function quotaTone(bucket: QuotaBucket) {
  const ratio = bucket.limit > 0 ? bucket.used / bucket.limit : 1
  if (ratio >= 1) return 'text-red'
  if (ratio >= 0.8) return 'text-yellow'
  return 'text-amber'
}

function quotaConsumed(bucket: QuotaBucket) {
  return bucket.consumed ?? bucket.used
}

function quotaReserved(bucket: QuotaBucket) {
  return bucket.reserved ?? 0
}

function resetIn(resetAt: string) {
  const ms = Math.max(0, Date.parse(resetAt) - Date.now())
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return `${hours}h ${minutes}m`
}

function quotaExceededReason(quota: QuotaStatus | null) {
  if (!quota) return null
  if (quota.wallet.remaining <= 0) return 'Wallet daily quota reached'
  if (quota.global.remaining <= 0) return 'Global daily quota reached'
  return null
}

function persistedEvent(record: ResearchRecord): TimedEvent | null {
  const receivedAt = record.completedAt ? utcTime(new Date(record.completedAt)) : utcTime()
  if (record.status === 'completed' && record.reportMd) {
    return {
      type: 'final',
      reportMd: record.reportMd,
      totalSpentUsdc: record.spentUsdc,
      totalCalls: 0,
      receivedAt,
    }
  }
  if ((record.status === 'failed' || record.status === 'cancelled') && record.errorMessage) {
    return { type: 'error', message: record.errorMessage, receivedAt }
  }
  if (record.status === 'cancelled') return { type: 'error', message: 'Research cancelled', receivedAt }
  return null
}

function hasTerminalEvent(events: TimedEvent[]) {
  return events.some((event) => event.type === 'final' || event.type === 'error')
}

function hasPendingPayment(events: TimedEvent[]) {
  return events.some((event) => event.type === 'tool_result' && event.payment.txStatus === 'pending')
}

function followUpStatusTone(status: ResearchFollowUpRecord['status']) {
  if (status === 'completed') return 'text-green'
  if (status === 'failed') return 'text-red'
  return 'text-cyan'
}

function followUpStatusLabel(status: ResearchFollowUpRecord['status']) {
  if (status === 'completed') return 'COMPLETED'
  if (status === 'failed') return 'FAILED'
  return 'PENDING'
}

function followUpErrorMessage(code: string) {
  if (code === 'BUDGET_EXHAUSTED') return 'No remaining budget is available for follow-up questions.'
  if (code === 'REPORT_NOT_READY') return 'This report is not ready for follow-up questions yet.'
  if (code === 'INVALID_BODY') return 'Enter a follow-up question between 1 and 500 characters.'
  if (code === 'FOLLOW_UP_FAILED') return 'The follow-up answer could not be generated. Please try again.'
  return 'Failed to submit the follow-up question.'
}

type LiveFollowUpResponse = {
  error?: string
  followUp?: ResearchFollowUpRecord
}

type LiveFollowUpsResponse = {
  error?: string
  followUps?: ResearchFollowUpRecord[]
}

type ResearchDetailResponse = {
  research?: ResearchRecord
  txLog?: TxLogRecord[]
}

function mergeFollowUps(current: ResearchFollowUpRecord[], incoming: ResearchFollowUpRecord[]) {
  const byId = new Map<string, ResearchFollowUpRecord>()
  for (const followUp of incoming) byId.set(followUp.id, followUp)
  for (const followUp of current) byId.set(followUp.id, followUp)
  return Array.from(byId.values()).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
}

function QuotaPanel({ quota }: { quota: QuotaStatus | null }) {
  if (!quota) {
    return (
      <div className="border border-border bg-bg-base p-3 font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">
        DAILY QUOTA: LOADING...
      </div>
    )
  }

  return (
    <div className="border border-border bg-bg-base p-3 font-mono text-[11px] uppercase tracking-[0.05em]" role="status" aria-live="polite">
      <div className="mb-2 font-bold text-amber">DAILY QUOTA</div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className={quotaTone(quota.wallet)}>
          WALLET: <span className="tabular-nums">{quotaBar(quota.wallet)} {quota.wallet.used}/{quota.wallet.limit}</span>
        </div>
        <div className={quotaTone(quota.global)}>
          GLOBAL: <span className="tabular-nums">{quotaBar(quota.global)} {quota.global.used}/{quota.global.limit}</span>
        </div>
      </div>
      <div className="mt-2 grid gap-2 text-text-secondary md:grid-cols-2">
        <div>WALLET CONSUMED: <span className="tabular-nums text-text-primary">{quotaConsumed(quota.wallet)}</span></div>
        <div>GLOBAL CONSUMED: <span className="tabular-nums text-text-primary">{quotaConsumed(quota.global)}</span></div>
        <div>WALLET RESERVED: <span className="tabular-nums text-amber">{quotaReserved(quota.wallet)}</span></div>
        <div>GLOBAL RESERVED: <span className="tabular-nums text-amber">{quotaReserved(quota.global)}</span></div>
        <div>WALLET REMAINING: <span className="tabular-nums text-green">{quota.wallet.remaining}</span></div>
        <div>GLOBAL REMAINING: <span className="tabular-nums text-green">{quota.global.remaining}</span></div>
      </div>
      <div className="mt-2 text-text-secondary">RESETS IN: {resetIn(quota.wallet.resetAt)}</div>
      <div className="my-2 border-t border-border" />
      <div className="normal-case tracking-normal text-text-muted">Rate limits will be relaxed after mainnet launch.</div>
    </div>
  )
}

function FundingField({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="grid gap-1 border-t border-border pt-2 md:grid-cols-[150px_1fr]">
      <div className="text-text-muted">{label}</div>
      <div className="break-all text-amber">{String(value)}</div>
    </div>
  )
}

function FundingPanel({
  enabled,
  intent,
  step,
  restored,
}: {
  enabled: boolean
  intent: FundingIntent | null
  step: FundingStep
  restored: boolean
}) {
  if (!enabled && !intent) return null

  const prepare = intent?.prepare
  return (
    <div className="border border-border bg-bg-base p-3 font-mono text-[11px] uppercase tracking-[0.05em]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold text-amber">ESCROW FUNDING</div>
        <div
          className={step === 'failed' ? 'text-red' : step === 'activating' ? 'text-cyan blink' : 'text-green'}
          role="status"
          aria-live="polite"
        >
          {fundingStepLabel(step)}
        </div>
      </div>
      {restored ? <div className="mt-2 text-cyan">RESTORED FUNDING SESSION</div> : null}
      {!prepare ? (
        <div className="mt-2 normal-case tracking-normal text-text-muted">
          Escrow funding is enabled. Starting research will first reserve quota and prepare the funding voucher.
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <FundingField label="RESEARCH ID" value={prepare.researchId} />
          <FundingField label="OFFICIAL USDC" value={prepare.usdc} />
          <FundingField label="FACTORY" value={prepare.factory} />
          <FundingField label="PREDICTED ESCROW" value={prepare.expectedEscrowAddress} />
          <FundingField label="BUDGET UNITS" value={prepare.budgetUnits} />
          <FundingField label="EXPECTED EXPIRES" value={prepare.expectedExpiresAt} />
          <FundingField label="FUNDING DEADLINE" value={prepare.fundingDeadline} />
          <FundingField label="INTENT SIGNER" value={prepare.intentSigner} />
          <FundingField label="RESERVED QUOTA" value={prepare.quotaReservationState} />
          <FundingField label="FUNDING TX" value={intent?.fundingTxHash ? shortHash(intent.fundingTxHash) : null} />
          <FundingField
            label="ACTIVATION"
            value={intent?.activationAuthorization
              ? `deadline ${intent.activationAuthorization.deadline}, nonce ${intent.activationAuthorization.activationNonce}`
              : null}
          />
          {intent?.fundingTxHash ? (
            <div className="border-t border-border pt-2 text-green">
              FUNDED RECEIPT OBSERVED: <span className="break-all">{intent.fundingTxHash}</span>
            </div>
          ) : null}
          {step === 'funded' || step === 'signing_activation' || step === 'activating' ? (
            <div className="border-t border-border pt-2 normal-case tracking-normal text-text-secondary">
              DUAL-KEY TRUST BOUNDARY: buyer signs activation for intent signer {prepare.intentSigner}; settlement still requires the independent settler path.
            </div>
          ) : null}
          {step === 'activating' ? (
            <div className="border-t border-border pt-2 text-cyan blink" role="status" aria-live="polite">ACTIVATING ON CHAIN</div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ResearchForm({ onStarted }: { onStarted: (id: string, budget: string) => void }) {
  const router = useRouter()
  const { address: walletAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const { signTypedDataAsync } = useSignTypedData()
  const { switchChainAsync } = useSwitchChain()
  const { address: siweBuyer } = useUser()
  const prepareKeyRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  const [promptDeck, setPromptDeck] = useState(promptPool)
  const [topicIndex, setTopicIndex] = useState(0)
  const [topic, setTopic] = useState(promptPool[0] ?? '')
  const [hasEditedTopic, setHasEditedTopic] = useState(false)
  const [budget, setBudget] = useState('0.0100')
  const [error, setError] = useState<string | null>(null)
  const [quota, setQuota] = useState<QuotaStatus | null>(null)
  const [backendConfig, setBackendConfig] = useState<ResearchBackendConfig | null>(null)
  const [fundingIntent, setFundingIntent] = useState<FundingIntent | null>(null)
  const [fundingStep, setFundingStep] = useState<FundingStep>('idle')
  const [restoredFundingIntent, setRestoredFundingIntent] = useState(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const quotaReason = quotaExceededReason(quota)
  const escrowFundingEnabled = backendConfig?.settlementBackend === 'escrow' && backendConfig.fundingUiEnabled === true
  const visibleQuickPrompts = useMemo(() => promptDeck.slice(0, VISIBLE_QUICK_PROMPTS), [promptDeck])

  useEffect(() => {
    const shuffledPrompts = shufflePrompts(promptPool)
    setPromptDeck(shuffledPrompts)
    setTopic(shuffledPrompts[0] ?? '')
  }, [])

  const loadQuota = useCallback(async () => {
    const res = await fetch('/api/quota', { credentials: 'include', cache: 'no-store' })
    if (!res.ok) return
    setQuota(await res.json() as QuotaStatus)
  }, [])

  useEffect(() => {
    loadQuota().catch(() => {})
    const timer = window.setInterval(() => loadQuota().catch(() => {}), 30_000)
    return () => window.clearInterval(timer)
  }, [loadQuota])

  useEffect(() => {
    if (hasEditedTopic) return
    if (promptDeck.length <= 1) return
    const timer = window.setInterval(() => {
      setTopicIndex((current) => (current + 1) % promptDeck.length)
    }, TOPIC_ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [hasEditedTopic, promptDeck.length])

  useEffect(() => {
    if (!hasEditedTopic) setTopic(promptDeck[topicIndex] ?? promptDeck[0] ?? '')
  }, [hasEditedTopic, promptDeck, topicIndex])

  const loadBackendConfig = useCallback(async () => {
    const res = await fetch('/api/research/config', { credentials: 'include', cache: 'no-store' })
    if (!res.ok) {
      const fallback: ResearchBackendConfig = { settlementBackend: 'calldata', fundingUiEnabled: false }
      setBackendConfig(fallback)
      return fallback
    }
    const config = await res.json() as ResearchBackendConfig
    setBackendConfig(config)
    return config
  }, [])

  useEffect(() => {
    loadBackendConfig().catch(() => {
      setBackendConfig({ settlementBackend: 'calldata', fundingUiEnabled: false })
    })
  }, [loadBackendConfig])

  useEffect(() => {
    const stored = parseStoredFundingIntent(window.localStorage.getItem(FUNDING_INTENT_STORAGE_KEY))
    if (!stored) return
    setFundingIntent(stored)
    setFundingStep(stored.fundingTxHash ? 'funded' : stored.step === 'prepared' ? 'needs_create' : stored.step)
    setRestoredFundingIntent(true)
    setTopic(stored.prepare.topic)
    setBudget(stored.prepare.budgetUsdc)
    setHasEditedTopic(true)
    prepareKeyRef.current = stored.idempotencyKey
  }, [])

  function persistFundingIntent(next: FundingIntent | null, step?: FundingStep) {
    setFundingIntent(next)
    if (step) setFundingStep(step)
    if (!next) {
      window.localStorage.removeItem(FUNDING_INTENT_STORAGE_KEY)
      prepareKeyRef.current = null
      return
    }
    window.localStorage.setItem(FUNDING_INTENT_STORAGE_KEY, JSON.stringify({
      ...next,
      step: step ?? next.step,
    }))
  }

  async function getBackendConfig() {
    return backendConfig ?? await loadBackendConfig()
  }

  function assertFundingContext(prepare: PrepareResearchResponse) {
    if (!isConnected || !walletAddress) {
      throw new Error('Wallet, session, chain, or voucher changed. Connect the prepared buyer wallet to continue.')
    }
    if (!sameAddress(walletAddress, prepare.buyer) || !sameAddress(siweBuyer, prepare.buyer)) {
      throw new Error('Wallet, session, chain, or voucher changed. Prepared buyer no longer matches the connected wallet.')
    }
    if (chainId !== prepare.chainId || (ARC_CHAIN_ID > 0 && chainId !== ARC_CHAIN_ID)) {
      throw new Error('Wallet, session, chain, or voucher changed. Switch to Arc Testnet before continuing.')
    }
    if (Date.parse(prepare.fundingDeadline) <= Date.now()) {
      throw new Error('Wallet, session, chain, or voucher changed. Funding voucher deadline has expired.')
    }
    if (Date.parse(prepare.expectedExpiresAt) <= Date.now()) {
      throw new Error('Wallet, session, chain, or voucher changed. Escrow expected expiry has expired.')
    }
  }

  async function readAllowance(prepare: PrepareResearchResponse) {
    if (!publicClient) throw new Error('Wallet RPC client is not ready.')
    const allowance = await publicClient.readContract({
      address: toHexAddress(prepare.usdc),
      abi: erc20Abi,
      functionName: 'allowance',
      args: [toHexAddress(prepare.buyer), toHexAddress(prepare.factory)],
    })
    return typeof allowance === 'bigint' ? allowance : BigInt(String(allowance ?? 0))
  }

  async function prepareEscrowResearch() {
    const idempotencyKey = prepareKeyRef.current
      ?? stablePrepareKey()
    prepareKeyRef.current = idempotencyKey
    setFundingStep('preparing')
    const res = await fetch('/api/research/prepare', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({ topic, budgetUsdc: budget }),
    })
    if (res.status === 401) {
      router.replace('/login?redirect=%2Fresearch')
      throw new Error('Authentication expired. Please sign in again.')
    }
    if (res.status === 429) {
      const body = await res.json() as { quota?: QuotaStatus; error?: string }
      if (body.quota) setQuota(body.quota)
      throw new Error(`Quota exceeded. ${body.error ?? 'Reservation failed'}.`)
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(startFailureMessage(res.status, body.error))
    }
    const prepare = await res.json() as PrepareResearchResponse
    assertFundingContext(prepare)
    const intent: FundingIntent = {
      prepare,
      idempotencyKey,
      step: 'checking_allowance',
      fundingTxHash: null,
      fundingLogIndex: null,
      activationAuthorization: null,
      activationSignature: null,
    }
    persistFundingIntent(intent, 'checking_allowance')
    const allowance = await readAllowance(prepare)
    persistFundingIntent(intent, allowance >= BigInt(prepare.budgetUnits) ? 'needs_create' : 'needs_approve')
  }

  async function approveUsdc() {
    if (!fundingIntent) return
    const { prepare } = fundingIntent
    assertFundingContext(prepare)
    setError(null)
    persistFundingIntent(fundingIntent, 'approving')
    await writeContractAsync({
      address: toHexAddress(prepare.usdc),
      abi: erc20Abi,
      functionName: 'approve',
      args: [toHexAddress(prepare.factory), BigInt(prepare.budgetUnits)],
    })
    persistFundingIntent(fundingIntent, 'needs_create')
  }

  async function createAndFundEscrow() {
    if (!fundingIntent) return
    const { prepare } = fundingIntent
    assertFundingContext(prepare)
    setError(null)
    const allowance = await readAllowance(prepare)
    if (allowance < BigInt(prepare.budgetUnits)) {
      setError('Allowance is still below the prepared budget. Approve USDC before funding.')
      persistFundingIntent(fundingIntent, 'needs_approve')
      return
    }
    persistFundingIntent(fundingIntent, 'funding')
    const fundingHash = await writeContractAsync({
      address: toHexAddress(prepare.factory),
      abi: researchEscrowFactoryAbi,
      functionName: 'createAndFund',
      args: [
        {
          buyer: toHexAddress(prepare.fundingVoucher.buyer),
          researchKey: toHexHash(prepare.fundingVoucher.researchKey),
          budgetUnits: BigInt(prepare.fundingVoucher.budgetUnits),
          expectedExpiresAt: BigInt(prepare.fundingVoucher.expectedExpiresAt),
          fundingDeadline: BigInt(prepare.fundingVoucher.fundingDeadline),
          intentSigner: toHexAddress(prepare.fundingVoucher.intentSigner),
          voucherNonce: BigInt(prepare.fundingVoucher.voucherNonce),
        },
        prepare.fundingSignature,
      ],
    })
    const receipt = publicClient
      ? await publicClient.waitForTransactionReceipt({ hash: fundingHash })
      : null
    const fundingLogIndex = Number(receipt?.logs?.[0]?.logIndex ?? 0)
    persistFundingIntent({
      ...fundingIntent,
      fundingTxHash: fundingHash,
      fundingLogIndex,
      step: 'funded',
    }, 'funded')
  }

  function activationAuthorizationFor(prepare: PrepareResearchResponse): ActivationAuthorization {
    return {
      escrow: prepare.expectedEscrowAddress,
      researchKey: prepare.researchKey,
      buyer: prepare.buyer,
      intentSigner: prepare.intentSigner,
      initialBudget: prepare.budgetUnits,
      expectedExpiresAt: String(unixSeconds(prepare.fundingVoucher.expectedExpiresAt)),
      activationNonce: prepare.fundingVoucher.voucherNonce,
      deadline: String(unixSeconds(prepare.fundingVoucher.fundingDeadline)),
    }
  }

  async function signActivationAndStart() {
    if (!fundingIntent?.fundingTxHash || fundingIntent.fundingLogIndex === null) return
    const { prepare } = fundingIntent
    assertFundingContext(prepare)
    setError(null)
    const authorization = activationAuthorizationFor(prepare)
    persistFundingIntent({
      ...fundingIntent,
      activationAuthorization: authorization,
    }, 'signing_activation')
    let signature: Hex
    try {
      signature = await signTypedDataAsync({
        domain: {
          name: 'ArcLeptonResearchEscrow',
          version: '1',
          chainId: BigInt(prepare.chainId),
          verifyingContract: toHexAddress(prepare.expectedEscrowAddress),
        },
        types: activationAuthorizationTypes,
        primaryType: 'ActivationAuthorization',
        message: {
          escrow: toHexAddress(authorization.escrow),
          researchKey: toHexHash(authorization.researchKey),
          buyer: toHexAddress(authorization.buyer),
          intentSigner: toHexAddress(authorization.intentSigner),
          initialBudget: BigInt(authorization.initialBudget),
          expectedExpiresAt: BigInt(authorization.expectedExpiresAt),
          activationNonce: BigInt(authorization.activationNonce),
          deadline: BigInt(authorization.deadline),
        },
      })
    } catch (err) {
      persistFundingIntent({
        ...fundingIntent,
        activationAuthorization: authorization,
      }, 'funded')
      throw new Error(isWalletRejection(err) ? 'Activation signature rejected. Review the funding summary and retry.' : 'Activation signature failed. Please retry.')
    }

    persistFundingIntent({
      ...fundingIntent,
      activationAuthorization: authorization,
      activationSignature: signature,
    }, 'activating')
    const res = await fetch('/api/research/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        researchId: prepare.researchId,
        fundingTxHash: fundingIntent.fundingTxHash,
        fundingLogIndex: fundingIntent.fundingLogIndex,
        activationAuthorization: authorization,
        activationSignature: signature,
      }),
    })
    if (res.status === 401) {
      router.replace('/login?redirect=%2Fresearch')
      throw new Error('Authentication expired. Please sign in again.')
    }
    const body = await res.json().catch(() => ({})) as { researchId?: string; status?: string; activationPhase?: string; error?: string }
    if (!res.ok && res.status !== 202) throw new Error(startFailureMessage(res.status, body.error))
    if (body.status === 'running' || body.activationPhase === 'active') {
      persistFundingIntent(null)
      onStarted(body.researchId ?? prepare.researchId, prepare.budgetUsdc)
      return
    }
    persistFundingIntent({
      ...fundingIntent,
      activationAuthorization: authorization,
      activationSignature: signature,
    }, 'activating')
  }

  async function switchToPreparedChain() {
    if (!fundingIntent) return
    try {
      await switchChainAsync({ chainId: fundingIntent.prepare.chainId })
    } finally {
      setError('Wallet, session, chain, or voucher changed. Switch to Arc Testnet before continuing.')
    }
  }

  async function legacyStart() {
    const res = await fetch('/api/research/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, budgetUsdc: budget }),
    })
    if (res.status === 429) {
      const body = await res.json() as { quota?: QuotaStatus }
      if (body.quota) setQuota(body.quota)
      const resetAt = body.quota?.wallet.resetAt ?? quota?.wallet.resetAt ?? new Date().toISOString()
      throw new Error(`Quota exceeded. Resets in ${resetIn(resetAt)}.`)
    }
    if (res.status === 401) {
      router.replace('/login?redirect=%2Fresearch')
      throw new Error('Authentication expired. Please sign in again.')
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(startFailureMessage(res.status, body.error))
    }
    const body = await res.json() as { researchId: string }
    onStarted(body.researchId, budget)
  }

  async function submit() {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setError(null)
    setSubmitting(true)
    try {
      const config = await getBackendConfig()
      if (config.settlementBackend === 'escrow' && config.fundingUiEnabled) {
        await prepareEscrowResearch()
      } else {
        await legacyStart()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'START_FAILED')
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }

  async function runFundingAction(action: () => Promise<void>) {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setError(null)
    setSubmitting(true)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'FUNDING_ACTION_FAILED')
    } finally {
      inFlightRef.current = false
      setSubmitting(false)
    }
  }

  const preparedChainMismatch = Boolean(fundingIntent && chainId !== fundingIntent.prepare.chainId)
  const fundingAction = fundingIntent ? (
    <div className="grid gap-2">
      {preparedChainMismatch ? (
        <button
          type="button"
          onClick={() => runFundingAction(switchToPreparedChain)}
          disabled={isSubmitting}
          className="terminal-button h-11 w-full border-red px-4 text-sm text-red disabled:border-red disabled:text-red"
        >
          [SWITCH TO ARC TESTNET]
        </button>
      ) : fundingStep === 'needs_approve' ? (
        <button
          type="button"
          onClick={() => runFundingAction(approveUsdc)}
          disabled={isSubmitting}
          className="terminal-button h-11 w-full px-4 text-sm"
        >
          {isSubmitting ? '[APPROVING...]' : '[APPROVE USDC]'}
        </button>
      ) : fundingStep === 'needs_create' || fundingStep === 'prepared' ? (
        <button
          type="button"
          onClick={() => runFundingAction(createAndFundEscrow)}
          disabled={isSubmitting}
          className="terminal-button h-11 w-full px-4 text-sm"
        >
          {isSubmitting ? '[FUNDING...]' : '[CREATE AND FUND ESCROW]'}
        </button>
      ) : fundingStep === 'funded' || fundingStep === 'signing_activation' ? (
        <button
          type="button"
          onClick={() => runFundingAction(signActivationAndStart)}
          disabled={isSubmitting}
          className="terminal-button h-11 w-full bg-amber px-4 text-sm text-bg-base hover:bg-bg-base hover:text-amber"
        >
          {isSubmitting ? '[SIGNING ACTIVATION...]' : '[SIGN ACTIVATION]'}
        </button>
      ) : fundingStep === 'activating' ? (
        <div className="border border-cyan bg-bg-base px-3 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-cyan blink">
          ACTIVATING ON CHAIN — refresh-safe; the same activation operation will continue.
        </div>
      ) : null}
    </div>
  ) : null

  return (
    <section className="mx-auto w-full max-w-[640px] border border-border bg-bg-panel">
      <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
        &gt; NEW RESEARCH REQUEST
      </div>
      <div className="space-y-6 p-4 md:p-6">
        <label className="block">
          <span className="mb-2 block font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">TOPIC</span>
          <textarea
            value={topic}
            onChange={(event) => {
              setHasEditedTopic(true)
              setTopic(event.target.value)
            }}
            placeholder={`_ ${promptDeck[topicIndex] ?? promptDeck[0] ?? ''}`}
            rows={3}
            className="w-full resize-none border border-amber bg-bg-base px-3 py-3 font-mono text-sm text-text-primary outline-none placeholder:text-amber-dim focus:bg-bg-cell"
          />
        </label>

        <div>
          <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">&gt; QUICK PROMPTS</div>
          <div className="grid gap-2 min-[540px]:grid-cols-2">
            {visibleQuickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => {
                  setHasEditedTopic(true)
                  setTopic(prompt)
                }}
                className="border border-border bg-bg-base px-3 py-2 text-left font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-text-secondary hover:border-amber hover:text-amber"
              >
                [{prompt}]
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">BUDGET</div>
          <div className="grid gap-3 md:grid-cols-[150px_1fr] md:items-center">
            <input
              aria-label="Budget USDC"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              className="h-11 border border-border bg-bg-base px-3 font-mono text-sm font-bold tabular-nums text-amber outline-none focus:border-amber"
            />
            <div className="flex items-center gap-3 font-mono text-[11px] text-text-muted">
              <span>$0.001</span>
              <input
                aria-label="Budget slider"
                type="range"
                min="0.001"
                max="0.1"
                step="0.001"
                value={Number(budget)}
                onChange={(event) => setBudget(formatBudget(Number(event.target.value)))}
                className="h-1 flex-1 accent-amber"
              />
              <span>$0.10</span>
            </div>
          </div>
          <div className="mt-3 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-text-secondary">
            ESTIMATED CALLS: <span className="text-amber">{estimatedCalls(budget)}</span>
          </div>
        </div>

        <QuotaPanel quota={quota} />
        <FundingPanel
          enabled={escrowFundingEnabled}
          intent={fundingIntent}
          step={fundingStep}
          restored={restoredFundingIntent}
        />
        {fundingAction}

        {!fundingIntent ? (
          <button
            type="button"
            onClick={submit}
            disabled={isSubmitting || !topic.trim() || Boolean(quotaReason)}
            title={quotaReason ? `${quotaReason}. Resets in ${resetIn(quota?.wallet.resetAt ?? new Date().toISOString())}.` : undefined}
            className="terminal-button h-12 w-full bg-amber px-4 text-sm text-bg-base hover:bg-bg-base hover:text-amber disabled:border-red disabled:bg-bg-cell disabled:text-red"
          >
            {quotaReason ? '[ QUOTA EXCEEDED ]' : isSubmitting ? '[ STARTING... ]' : '[ ▸ START RESEARCH ]'}
          </button>
        ) : null}
        {error ? (
          <div role="alert" className="font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-red">
            [ERR] {error}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function LiveFollowUpPanel({ researchId }: { researchId: string }) {
  const router = useRouter()
  const [followUps, setFollowUps] = useState<ResearchFollowUpRecord[]>([])
  const [followUpQuestion, setFollowUpQuestion] = useState('')
  const [followUpError, setFollowUpError] = useState<string | null>(null)
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [followUpsLoading, setFollowUpsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function loadFollowUps() {
      setFollowUpsLoading(true)
      try {
        const res = await fetch(`/api/research/${researchId}/follow-ups`, { credentials: 'include' })
        if (res.status === 401) {
          router.replace(`/login?redirect=${encodeURIComponent(`/research?id=${researchId}`)}`)
          throw new Error('Authentication expired. Please sign in again.')
        }

        const body = await res.json().catch(() => ({})) as LiveFollowUpsResponse
        if (!res.ok) throw new Error(followUpErrorMessage(body.error ?? 'FOLLOW_UP_FAILED'))
        const loadedFollowUps = Array.isArray(body.followUps) ? body.followUps : []
        if (!cancelled) {
          setFollowUps((current) => mergeFollowUps(current, loadedFollowUps))
        }
      } catch (err) {
        if (!cancelled) {
          setFollowUpError(err instanceof Error ? err.message : followUpErrorMessage('FOLLOW_UP_FAILED'))
        }
      } finally {
        if (!cancelled) setFollowUpsLoading(false)
      }
    }

    loadFollowUps().catch(() => {})

    return () => {
      cancelled = true
    }
  }, [researchId])

  async function submitFollowUp() {
    const question = followUpQuestion.trim()
    if (!question) {
      setFollowUpError(followUpErrorMessage('INVALID_BODY'))
      return
    }

    setFollowUpError(null)
    setSubmittingFollowUp(true)
    setPendingQuestion(question)

    try {
      const res = await fetch(`/api/research/${researchId}/follow-ups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      if (res.status === 401) {
        router.replace(`/login?redirect=${encodeURIComponent(`/research?id=${researchId}`)}`)
        throw new Error('Authentication expired. Please sign in again.')
      }

      const body = await res.json().catch(() => ({})) as LiveFollowUpResponse
      if (body.followUp) setFollowUps((current) => [...current, body.followUp as ResearchFollowUpRecord])
      if (!res.ok) throw new Error(followUpErrorMessage(body.error ?? 'FOLLOW_UP_FAILED'))

      setFollowUpQuestion('')
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : followUpErrorMessage('FOLLOW_UP_FAILED'))
    } finally {
      setPendingQuestion(null)
      setSubmittingFollowUp(false)
    }
  }

  return (
    <div className="border-t border-border px-3 pb-3 pt-0">
      <div className="border border-border bg-bg-panel">
        <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em] text-amber">
          &gt; FOLLOW-UP Q&amp;A
        </div>
        <div className="space-y-4 p-3">
          <div className="space-y-3">
            {followUps.length ? (
              followUps.map((followUp, index) => (
                <div key={followUp.id} className="border border-border bg-bg-base">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.05em]">
                    <span className="font-bold text-amber">Q{index + 1}</span>
                    <span className={followUpStatusTone(followUp.status)}>{followUpStatusLabel(followUp.status)}</span>
                    <span className="text-text-muted">{utcDateTime(followUp.createdAt)}</span>
                  </div>
                  <div className="px-3 py-3">
                    <div className="mb-3 whitespace-pre-wrap font-mono text-sm text-text-primary">{followUp.question}</div>
                    {followUp.answerMd ? (
                      <div className="border-t border-border pt-3">
                        <TerminalMarkdown content={followUp.answerMd} />
                      </div>
                    ) : null}
                    {followUp.status === 'failed' ? (
                      <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-red">
                        Follow-up answer failed. Please try again.
                      </div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : followUpsLoading ? (
              <div className="border border-border bg-bg-base px-3 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-text-secondary">
                Loading follow-up history...
              </div>
            ) : (
              <div className="border border-border bg-bg-base px-3 py-3 font-mono text-[11px] uppercase tracking-[0.05em] text-text-secondary">
                No follow-up questions yet. Ask a focused follow-up about this report.
              </div>
            )}

            {pendingQuestion ? (
              <div className="border border-border bg-bg-base">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.05em]">
                  <span className="font-bold text-amber">NEW QUESTION</span>
                  <span className="text-cyan blink">PENDING</span>
                </div>
                <div className="px-3 py-3">
                  <div className="mb-3 whitespace-pre-wrap font-mono text-sm text-text-primary">{pendingQuestion}</div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-cyan blink">
                    Generating follow-up answer...
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="grid gap-3">
            <label className="block">
              <span className="mb-2 block font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">QUESTION</span>
              <textarea
                value={followUpQuestion}
                onChange={(event) => setFollowUpQuestion(event.target.value)}
                rows={3}
                maxLength={500}
                placeholder="_ Ask a follow-up about this report"
                className="w-full resize-none border border-amber bg-bg-base px-3 py-3 font-mono text-sm text-text-primary outline-none placeholder:text-amber-dim focus:bg-bg-cell"
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-text-muted">
                {(followUpQuestion.trim() || '').length}/500
              </div>
              <button
                type="button"
                onClick={() => submitFollowUp().catch(() => {})}
                disabled={submittingFollowUp}
                className="terminal-button h-9 px-3 text-[11px] disabled:border-red disabled:text-red"
              >
                [SUBMIT FOLLOW-UP]
              </button>
            </div>
            {followUpError ? <div className="font-mono text-[11px] uppercase tracking-[0.05em] text-red">{followUpError}</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function LiveResearch({
  researchId,
  initialBudget,
}: {
  researchId: string
  initialBudget: string
}) {
  const router = useRouter()
  const routerReplace = router.replace
  const [events, setEvents] = useState<TimedEvent[]>([])
  const [research, setResearch] = useState<ResearchRecord | null>(null)
  const [isCancelling, setCancelling] = useState(false)
  const stoppedRef = useRef(false)
  const final = events.find((event) => event.type === 'final')
  const isTerminal = hasTerminalEvent(events)
  const hasPendingSettlement = hasPendingPayment(events)

  const onEvent = useCallback((event: TimedEvent) => {
    if (stoppedRef.current) return
    setEvents((current) => (hasTerminalEvent(current) ? current : [...current, event]))
  }, [])

  const loadResearchDetail = useCallback(async (shouldIgnore?: () => boolean) => {
    const res = await fetch(`/api/research/${researchId}`, { credentials: 'include', cache: 'no-store' })
    if (res.status === 401) {
      routerReplace(`/login?redirect=${encodeURIComponent(`/research?id=${researchId}`)}`)
      throw new Error('Authentication expired. Please sign in again.')
    }
    if (!res.ok) return

    const body = await res.json().catch(() => null) as ResearchDetailResponse | null
    if (shouldIgnore?.()) return
    if (!body?.research) return

    const record = body.research
    const txLog = Array.isArray(body.txLog) ? body.txLog : []
    setResearch((current) => (
      current?.status === 'cancelled' && record.status === 'running' ? current : record
    ))
    setEvents((current) => {
      const merged = mergeTxLogIntoEvents(current, txLog)
      const restored = persistedEvent(record)
      if (!restored || hasTerminalEvent(merged)) return merged
      return [...merged, restored]
    })
  }, [researchId, routerReplace])

  useEffect(() => {
    let cancelled = false
    loadResearchDetail(() => cancelled).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [loadResearchDetail])

  useEffect(() => {
    if (!isTerminal || !hasPendingSettlement) return undefined
    const timer = window.setInterval(() => {
      loadResearchDetail().catch(() => {})
    }, TX_LOG_POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasPendingSettlement, isTerminal, loadResearchDetail])

  async function cancel() {
    if (isTerminal || stoppedRef.current) return
    stoppedRef.current = true
    const cancelledAt = new Date().toISOString()
    const cancelledEvent: TimedEvent = { type: 'error', message: 'Research cancelled', receivedAt: utcTime(new Date(cancelledAt)) }
    setResearch((current) => current ? {
      ...current,
      status: 'cancelled',
      errorMessage: 'Research cancelled',
      completedAt: current.completedAt ?? cancelledAt,
    } : current)
    setEvents((current) => (
      hasTerminalEvent(current) ? current : [...current, cancelledEvent]
    ))
    setCancelling(true)
    try {
      const res = await fetch(`/api/research/${researchId}/cancel`, { method: 'POST', credentials: 'include' }).catch(() => null)
      if (!res?.ok) return
    } finally {
      setCancelling(false)
    }
  }

  const budget = research?.budgetUsdc ?? initialBudget

  return (
    <section className="mx-auto w-full max-w-[1480px] border border-border bg-bg-base">
      <div className="flex items-center justify-between border-b border-amber px-3 py-2 font-mono text-[12px] font-bold uppercase tracking-[0.05em]">
        <div className="min-w-0 text-amber">
          &gt; LIVE RESEARCH <span className="ml-3 text-text-muted">#{researchId.slice(0, 8)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {final ? (
            <>
              <button type="button" onClick={() => router.push(`/research/${researchId}#follow-up`)} className="terminal-button h-8 px-3 text-[11px]">
                [ASK FOLLOW-UP →]
              </button>
              <button type="button" onClick={() => router.push(`/research/${researchId}`)} className="terminal-button h-8 px-3 text-[11px]">
                [VIEW FULL REPORT →]
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={cancel}
            disabled={isCancelling || isTerminal}
            className="h-8 border border-red bg-bg-base px-3 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-red hover:bg-red hover:text-bg-base disabled:border-border disabled:text-text-muted disabled:hover:bg-bg-base"
          >
            [CANCEL]
          </button>
        </div>
      </div>
      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1.1fr)_minmax(190px,0.7fr)]">
        <AgentLogStream researchId={researchId} events={events} onEvent={onEvent} />
        <TxFeed events={events} />
        <BudgetMeter events={events} budgetUsdc={budget} />
      </div>
      {final ? <LiveFollowUpPanel researchId={researchId} /> : null}
    </section>
  )
}

export function ResearchPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const researchId = searchParams.get('id')
  const [lastBudget, setLastBudget] = useState('0.0100')

  function handleStarted(id: string, budget: string) {
    setLastBudget(budget)
    router.push(`/research?id=${id}`)
  }

  return (
    <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
      <div className="mx-auto mb-3 flex w-full max-w-[1480px] justify-end">
        <a href="/dashboard" className="terminal-button h-9 px-3 text-[11px]">
          [VIEW HISTORY]
        </a>
      </div>
      {researchId ? <LiveResearch key={researchId} researchId={researchId} initialBudget={lastBudget} /> : <ResearchForm onStarted={handleStarted} />}
    </main>
  )
}
