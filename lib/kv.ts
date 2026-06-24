import { Redis } from '@upstash/redis'
import { MemoryKv } from './kv-memory'

export interface KvClient {
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>
  get(key: string): Promise<string | null>
  getdel(key: string): Promise<string | null>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}

function createKvClient(): KvClient {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  const isNextProductionBuild = process.env.NEXT_PHASE === 'phase-production-build'

  if (url && token) {
    return new Redis({ url, token })
  }

  if (process.env.NODE_ENV !== 'production' || isNextProductionBuild) {
    console.warn('⚠ Using in-memory KV (dev fallback)，restart needed after env added')
    return new MemoryKv()
  }

  throw new Error('KV_REST_API_URL and KV_REST_API_TOKEN are required in production')
}

export const kv = createKvClient()
