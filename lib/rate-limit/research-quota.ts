import { kv } from '@/lib/kv'
import { researchQuotaRepo } from '@/lib/db'

export interface QuotaBucket {
  consumed: number
  reserved: number
  used: number
  limit: number
  remaining: number
  resetAt: string
}

export interface QuotaStatus {
  wallet: QuotaBucket
  global: QuotaBucket
  backend: 'kv' | 'postgres'
}

export const WALLET_DAILY_LIMIT = 10
export const GLOBAL_DAILY_LIMIT = 100

type QuotaFailure = { ok: false; reason: 'WALLET_LIMIT' | 'GLOBAL_LIMIT' | 'QUOTA_SHADOW_MISMATCH' }

function utcDay(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

function nextUtcMidnight(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1))
}

function secondsUntilReset(date = new Date()) {
  return Math.max(1, Math.ceil((nextUtcMidnight(date).getTime() - date.getTime()) / 1000))
}

function walletKey(address: string, day = utcDay()) {
  return `quota:wallet:${address.toLowerCase()}:${day}`
}

function globalKey(day = utcDay()) {
  return `quota:global:${day}`
}

function bucket(consumed: number, reserved: number, limit: number, resetAt: string): QuotaBucket {
  const used = consumed + reserved
  return {
    consumed,
    reserved,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetAt,
  }
}

async function readCount(key: string) {
  const value = Number.parseInt((await kv.get(key)) ?? '0', 10)
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

export async function getGlobalQuotaStatus(): Promise<QuotaBucket> {
  const now = new Date()
  return bucket(await readCount(globalKey(utcDay(now))), 0, GLOBAL_DAILY_LIMIT, nextUtcMidnight(now).toISOString())
}

export async function getQuotaStatus(address: string): Promise<QuotaStatus> {
  const now = new Date()
  const day = utcDay(now)
  const resetAt = nextUtcMidnight(now).toISOString()
  const addressLower = address.toLowerCase()

  if (isQuotaShadowEnabled()) {
    const status = await researchQuotaRepo.status({ address: addressLower, day, resetAt })
    return {
      wallet: bucket(status.wallet.consumed, status.wallet.reserved, WALLET_DAILY_LIMIT, status.wallet.resetAt),
      global: bucket(status.global.consumed, status.global.reserved, GLOBAL_DAILY_LIMIT, status.global.resetAt),
      backend: 'postgres',
    }
  }

  const [walletUsed, globalUsed] = await Promise.all([
    readCount(walletKey(addressLower, day)),
    readCount(globalKey(day)),
  ])

  return {
    wallet: bucket(walletUsed, 0, WALLET_DAILY_LIMIT, resetAt),
    global: bucket(globalUsed, 0, GLOBAL_DAILY_LIMIT, resetAt),
    backend: 'kv',
  }
}

export async function consumeQuota(address: string): Promise<{ ok: true } | QuotaFailure> {
  const now = new Date()
  const day = utcDay(now)
  const ttl = secondsUntilReset(now)
  const addressLower = address.toLowerCase()
  const keys = {
    wallet: walletKey(addressLower, day),
    global: globalKey(day),
  }

  const walletUsed = await kv.incr(keys.wallet)
  if (walletUsed === 1) await kv.expire(keys.wallet, ttl)

  const globalUsed = await kv.incr(keys.global)
  if (globalUsed === 1) await kv.expire(keys.global, ttl)

  if (isQuotaShadowEnabled()) {
    const shadow = await researchQuotaRepo.consume({
      address: addressLower,
      day,
      resetAt: nextUtcMidnight(now).toISOString(),
    })
    if (shadow.walletUsed !== walletUsed || shadow.globalUsed !== globalUsed) {
      await Promise.all([
        kv.decr(keys.wallet),
        kv.decr(keys.global),
        researchQuotaRepo.release({ address: addressLower, day }),
      ])
      return { ok: false, reason: 'QUOTA_SHADOW_MISMATCH' }
    }
  }

  if (walletUsed > WALLET_DAILY_LIMIT || globalUsed > GLOBAL_DAILY_LIMIT) {
    await Promise.all([
      kv.decr(keys.wallet),
      kv.decr(keys.global),
      isQuotaShadowEnabled() ? researchQuotaRepo.release({ address: addressLower, day }) : Promise.resolve(),
    ])
    return { ok: false, reason: walletUsed > WALLET_DAILY_LIMIT ? 'WALLET_LIMIT' : 'GLOBAL_LIMIT' }
  }

  return { ok: true }
}

function isQuotaShadowEnabled() {
  const value = process.env.ARC_RESEARCH_QUOTA_SHADOW_ENABLED?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes' || value === 'on' || value === 'enabled'
}
