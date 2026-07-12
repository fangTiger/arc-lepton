import { eq, sql } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { researchQuotaUsage } from './schema/research-quota'
import type {
  ResearchQuotaBucketStatus,
  ResearchQuotaConsumeInput,
  ResearchQuotaReleaseInput,
  ResearchQuotaRepo,
  ResearchQuotaStatus,
  ResearchQuotaStatusInput,
  ResearchQuotaUsage,
} from './research-quota-repo'

type DbClient = VercelPgDatabase<typeof schema>

export class PgResearchQuotaRepo implements ResearchQuotaRepo {
  constructor(private readonly database: DbClient) {}

  async consume(input: ResearchQuotaConsumeInput): Promise<ResearchQuotaUsage> {
    const resetAt = new Date(input.resetAt)
    const [walletUsed, globalUsed] = await Promise.all([
      this.increment({
        id: this.walletId(input.address, input.day),
        bucketType: 'wallet',
        bucketKey: input.address.toLowerCase(),
        day: input.day,
        resetAt,
      }),
      this.increment({
        id: this.globalId(input.day),
        bucketType: 'global',
        bucketKey: 'global',
        day: input.day,
        resetAt,
      }),
    ])
    return { walletUsed, globalUsed }
  }

  async release(input: ResearchQuotaReleaseInput): Promise<void> {
    await Promise.all([
      this.decrement(this.walletId(input.address, input.day)),
      this.decrement(this.globalId(input.day)),
    ])
  }

  async status(input: ResearchQuotaStatusInput): Promise<ResearchQuotaStatus> {
    const [wallet, global] = await Promise.all([
      this.readBucket(this.walletId(input.address, input.day), input.resetAt),
      this.readBucket(this.globalId(input.day), input.resetAt),
    ])
    return { wallet, global }
  }

  private async increment(input: {
    id: string
    bucketType: 'wallet' | 'global'
    bucketKey: string
    day: string
    resetAt: Date
  }) {
    const [row] = await this.database
      .insert(researchQuotaUsage)
      .values({
        id: input.id,
        bucketType: input.bucketType,
        bucketKey: input.bucketKey,
        day: input.day,
        consumed: 1,
        reserved: 0,
        used: 1,
        resetAt: input.resetAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: researchQuotaUsage.id,
        set: {
          consumed: sql`${researchQuotaUsage.consumed} + 1`,
          used: sql`${researchQuotaUsage.used} + 1`,
          resetAt: input.resetAt,
          updatedAt: new Date(),
        },
      })
      .returning({ used: researchQuotaUsage.used })
    return Number(row?.used ?? 0)
  }

  private async decrement(id: string) {
    await this.database
      .update(researchQuotaUsage)
      .set({
        consumed: sql`greatest(${researchQuotaUsage.consumed} - 1, 0)`,
        used: sql`greatest(${researchQuotaUsage.used} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(researchQuotaUsage.id, id))
  }

  private async readBucket(id: string, resetAt: string): Promise<ResearchQuotaBucketStatus> {
    const [row] = await this.database
      .select({
        consumed: researchQuotaUsage.consumed,
        reserved: researchQuotaUsage.reserved,
        used: researchQuotaUsage.used,
        resetAt: researchQuotaUsage.resetAt,
      })
      .from(researchQuotaUsage)
      .where(eq(researchQuotaUsage.id, id))
      .limit(1)
    if (!row) return { consumed: 0, reserved: 0, used: 0, resetAt }
    const consumed = Number(row.consumed)
    const reserved = Number(row.reserved)
    return {
      consumed,
      reserved,
      used: Number(row.used ?? consumed + reserved),
      resetAt: row.resetAt.toISOString(),
    }
  }

  private walletId(address: string, day: string) {
    return `wallet:${address.toLowerCase()}:${day}`
  }

  private globalId(day: string) {
    return `global:${day}`
  }
}
