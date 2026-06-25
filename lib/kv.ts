import { Redis } from '@upstash/redis'
import { MemoryKv } from './kv-memory'

export interface KvClient {
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>
  get(key: string): Promise<string | null>
  getdel(key: string): Promise<string | null>
  incr(key: string): Promise<number>
  decr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}

type GlobalWithMemoryKv = typeof globalThis & {
  __arcLeptonMemoryKv?: MemoryKv
  __arcLeptonMemoryKvWarned?: boolean
}

function getMemoryKv(): MemoryKv {
  const globalForKv = globalThis as GlobalWithMemoryKv
  globalForKv.__arcLeptonMemoryKv ??= new MemoryKv()

  if (!globalForKv.__arcLeptonMemoryKvWarned) {
    console.warn('⚠ Using in-memory KV (dev fallback)，restart needed after env added')
    globalForKv.__arcLeptonMemoryKvWarned = true
  }

  return globalForKv.__arcLeptonMemoryKv
}

function envValue(name: string) {
  const value = process.env[name]?.trim()
  if (!value || value === 'undefined') return ''
  return value
}

function createKvClient(): KvClient {
  const url = envValue('KV_REST_API_URL') || envValue('UPSTASH_REDIS_REST_URL')
  const token = envValue('KV_REST_API_TOKEN') || envValue('UPSTASH_REDIS_REST_TOKEN')
  const isNextProductionBuild = process.env.NEXT_PHASE === 'phase-production-build'

  if (url && token) {
    return new Redis({ url, token })
  }

  if (process.env.NODE_ENV !== 'production' || isNextProductionBuild) {
    return getMemoryKv()
  }

  throw new Error(
    'KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN are required in production',
  )
}

export const kv = createKvClient()
