import { Redis } from '@upstash/redis'

export const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

export interface KvClient {
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>
  get(key: string): Promise<string | null>
  getdel(key: string): Promise<string | null>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}
