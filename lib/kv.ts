import { Redis } from '@upstash/redis'
import { MemoryKv } from './kv-memory'

export interface KvClient {
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>
  get(key: string): Promise<string | null>
  getdel(key: string): Promise<string | null>
  incr(key: string): Promise<number>
  incrby?(key: string, increment: number): Promise<number>
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
    console.warn('⚠ 使用内存 KV 兜底，实例重启后数据会丢失')
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

  if (url && token) {
    return new Redis({ url, token })
  }

  return getMemoryKv()
}

export const kv = createKvClient()
