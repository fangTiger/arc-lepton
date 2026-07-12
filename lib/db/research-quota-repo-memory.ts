import type {
  ResearchQuotaConsumeInput,
  ResearchQuotaReleaseInput,
  ResearchQuotaRepo,
  ResearchQuotaStatus,
  ResearchQuotaStatusInput,
  ResearchQuotaUsage,
} from './research-quota-repo'

type MemoryQuotaBucket = {
  consumed: number
  reserved: number
  resetAt: Date
}

export class MemoryResearchQuotaStore {
  private buckets = new Map<string, MemoryQuotaBucket>()

  reserve(input: {
    address: string
    day: string
    resetAt: Date
    walletLimit: number
    globalLimit: number
  }): { ok: true } | { ok: false; reason: 'WALLET_LIMIT' | 'GLOBAL_LIMIT' } {
    const wallet = this.bucket(this.walletKey(input.address, input.day), input.resetAt)
    const global = this.bucket(this.globalKey(input.day), input.resetAt)

    if (wallet.consumed + wallet.reserved + 1 > input.walletLimit) {
      return { ok: false, reason: 'WALLET_LIMIT' }
    }
    if (global.consumed + global.reserved + 1 > input.globalLimit) {
      return { ok: false, reason: 'GLOBAL_LIMIT' }
    }

    wallet.reserved += 1
    global.reserved += 1
    return { ok: true }
  }

  consume(input: ResearchQuotaConsumeInput): ResearchQuotaUsage {
    const resetAt = new Date(input.resetAt)
    const walletUsed = this.incrementConsumed(this.walletKey(input.address, input.day), resetAt)
    const globalUsed = this.incrementConsumed(this.globalKey(input.day), resetAt)
    return { walletUsed, globalUsed }
  }

  release(input: ResearchQuotaReleaseInput): void {
    this.decrementConsumed(this.walletKey(input.address, input.day))
    this.decrementConsumed(this.globalKey(input.day))
  }

  consumeReservation(input: { address: string; day: string }): void {
    this.finishReservation(this.walletKey(input.address, input.day), 'consumed')
    this.finishReservation(this.globalKey(input.day), 'consumed')
  }

  releaseReservation(input: { address: string; day: string }): void {
    this.finishReservation(this.walletKey(input.address, input.day), 'released')
    this.finishReservation(this.globalKey(input.day), 'released')
  }

  status(input: ResearchQuotaStatusInput): ResearchQuotaStatus {
    return {
      wallet: this.statusBucket(this.walletKey(input.address, input.day), input.resetAt),
      global: this.statusBucket(this.globalKey(input.day), input.resetAt),
    }
  }

  snapshot() {
    return new Map(
      [...this.buckets.entries()].map(([key, bucket]) => [
        key,
        { consumed: bucket.consumed, reserved: bucket.reserved, resetAt: new Date(bucket.resetAt) },
      ]),
    )
  }

  restore(snapshot: Map<string, MemoryQuotaBucket>) {
    this.buckets = new Map(
      [...snapshot.entries()].map(([key, bucket]) => [
        key,
        { consumed: bucket.consumed, reserved: bucket.reserved, resetAt: new Date(bucket.resetAt) },
      ]),
    )
  }

  private incrementConsumed(key: string, resetAt: Date) {
    const bucket = this.bucket(key, resetAt)
    bucket.consumed += 1
    return bucket.consumed + bucket.reserved
  }

  private decrementConsumed(key: string) {
    const bucket = this.buckets.get(key)
    if (!bucket) return
    bucket.consumed = Math.max(0, bucket.consumed - 1)
  }

  private finishReservation(key: string, target: 'consumed' | 'released') {
    const bucket = this.buckets.get(key)
    if (!bucket) return
    bucket.reserved = Math.max(0, bucket.reserved - 1)
    if (target === 'consumed') bucket.consumed += 1
  }

  private bucket(key: string, resetAt: Date) {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { consumed: 0, reserved: 0, resetAt: new Date(resetAt) }
      this.buckets.set(key, bucket)
    }
    return bucket
  }

  private statusBucket(key: string, resetAt: string) {
    const bucket = this.buckets.get(key)
    if (!bucket) return { consumed: 0, reserved: 0, used: 0, resetAt }
    return {
      consumed: bucket.consumed,
      reserved: bucket.reserved,
      used: bucket.consumed + bucket.reserved,
      resetAt: bucket.resetAt.toISOString(),
    }
  }

  private walletKey(address: string, day: string) {
    return `wallet:${address.toLowerCase()}:${day}`
  }

  private globalKey(day: string) {
    return `global:${day}`
  }
}

export class MemoryResearchQuotaRepo implements ResearchQuotaRepo {
  constructor(private readonly store = new MemoryResearchQuotaStore()) {}

  async consume(input: ResearchQuotaConsumeInput): Promise<ResearchQuotaUsage> {
    return this.store.consume(input)
  }

  async release(input: ResearchQuotaReleaseInput): Promise<void> {
    this.store.release(input)
  }

  async status(input: ResearchQuotaStatusInput): Promise<ResearchQuotaStatus> {
    return this.store.status(input)
  }
}
