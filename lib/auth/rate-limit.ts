import type { KvClient } from '@/lib/kv'

const key = (ip: string, bucket: string) => `rl:${bucket}:${ip}`

export async function checkRateLimit(
  kv: KvClient,
  ip: string,
  bucket: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const k = key(ip, bucket)
  const count = await kv.incr(k)
  if (count === 1) await kv.expire(k, windowSec)
  return count <= max
}
