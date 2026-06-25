import { count, desc, eq, sql } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { research } from './schema/research'
import type { Research, ResearchRepo, ResearchStatus } from './research-repo'

type DbClient = VercelPgDatabase<typeof schema>

export class PgResearchRepo implements ResearchRepo {
  constructor(private readonly database: DbClient) {}

  async create(input: { address: string; topic: string; budgetUsdc: string }): Promise<Research> {
    const [row] = await this.database.insert(research).values(input).returning()
    if (!row) throw new Error('Failed to create research')
    return row
  }

  async findById(id: string): Promise<Research | null> {
    const [row] = await this.database.select().from(research).where(eq(research.id, id)).limit(1)
    return row ?? null
  }

  async updateStatus(id: string, status: ResearchStatus, errorMessage?: string): Promise<void> {
    await this.database
      .update(research)
      .set({
        status,
        errorMessage: errorMessage ?? null,
        completedAt: status === 'running' ? null : new Date(),
      })
      .where(eq(research.id, id))
  }

  async appendSpent(id: string, deltaUsdc: string): Promise<void> {
    await this.database
      .update(research)
      .set({ spentUsdc: sql`${research.spentUsdc} + ${deltaUsdc}` })
      .where(eq(research.id, id))
  }

  async setReport(id: string, reportMd: string): Promise<void> {
    await this.database.update(research).set({ reportMd }).where(eq(research.id, id))
  }

  async listByAddress(address: string, limit = 50): Promise<Research[]> {
    return this.database
      .select()
      .from(research)
      .where(eq(research.address, address))
      .orderBy(desc(research.startedAt))
      .limit(limit)
  }

  async countAll(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(research)
    return Number(row?.value ?? 0)
  }

  async countRunning(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(research).where(eq(research.status, 'running'))
    return Number(row?.value ?? 0)
  }
}
