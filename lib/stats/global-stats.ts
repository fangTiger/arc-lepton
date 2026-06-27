import { kv } from '@/lib/kv'
import { decimalToUnits, isBillableTxStatus, unitsToDecimal, type TxStatus } from '@/lib/db/tx-log-repo'

const STATS_KEYS = {
  totalResearches: 'stats:global:total_researches',
  activeAgents: 'stats:global:active_agents',
  totalCalls: 'stats:global:total_calls',
  totalSpentUnits: 'stats:global:total_spent_units',
} as const

export type PersistedGlobalStats = {
  totalResearches: number
  activeAgents: number
  totalCallsAcrossAllUsers: number
  totalUsdcSpent: string
}

async function readBigInt(key: string) {
  const raw = await kv.get(key)
  if (!raw) return 0n
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

function toSafeNumber(value: bigint) {
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value)
}

export async function getPersistedGlobalStats(): Promise<PersistedGlobalStats> {
  const [totalResearches, activeAgents, totalCalls, totalSpentUnits] = await Promise.all([
    readBigInt(STATS_KEYS.totalResearches),
    readBigInt(STATS_KEYS.activeAgents),
    readBigInt(STATS_KEYS.totalCalls),
    readBigInt(STATS_KEYS.totalSpentUnits),
  ])

  return {
    totalResearches: toSafeNumber(totalResearches),
    activeAgents: toSafeNumber(activeAgents < 0n ? 0n : activeAgents),
    totalCallsAcrossAllUsers: toSafeNumber(totalCalls),
    totalUsdcSpent: unitsToDecimal(totalSpentUnits),
  }
}

export async function recordResearchStarted() {
  await Promise.all([
    kv.incr(STATS_KEYS.totalResearches),
    kv.incr(STATS_KEYS.activeAgents),
  ])
}

export async function recordResearchFinished() {
  const nextActive = await kv.decr(STATS_KEYS.activeAgents)
  if (nextActive < 0) await kv.set(STATS_KEYS.activeAgents, '0')
}

async function incrementBy(key: string, increment: bigint) {
  if (kv.incrby) {
    await kv.incrby(key, Number(increment))
    return
  }
  const current = await readBigInt(key)
  await kv.set(key, String(current + increment))
}

export async function recordPaymentAggregate(amount: string, txStatus: TxStatus) {
  if (!isBillableTxStatus(txStatus)) return
  await Promise.all([
    kv.incr(STATS_KEYS.totalCalls),
    incrementBy(STATS_KEYS.totalSpentUnits, decimalToUnits(amount)),
  ])
}
