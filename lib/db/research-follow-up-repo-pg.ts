import { and, desc, eq } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { researchFollowUp } from './schema/research-follow-up'
import type { ResearchFollowUp, ResearchFollowUpRepo } from './research-follow-up-repo'

type DbClient = VercelPgDatabase<typeof schema>

export class PgResearchFollowUpRepo implements ResearchFollowUpRepo {
  constructor(private readonly database: DbClient) {}

  async create(input: { researchId: string; address: string; question: string }): Promise<ResearchFollowUp> {
    const [row] = await this.database.insert(researchFollowUp).values(input).returning()
    if (!row) throw new Error('Failed to create research follow-up')
    return row
  }

  async listByResearchId(address: string, researchId: string, limit = 50): Promise<ResearchFollowUp[]> {
    const rows = await this.database
      .select()
      .from(researchFollowUp)
      .where(and(eq(researchFollowUp.address, address), eq(researchFollowUp.researchId, researchId)))
      .orderBy(desc(researchFollowUp.createdAt))
      .limit(limit)

    return rows.sort((left, right) => {
      const timeDiff = left.createdAt.getTime() - right.createdAt.getTime()
      if (timeDiff !== 0) return timeDiff
      return left.id.localeCompare(right.id)
    })
  }

  async complete(id: string, input: { answerMd: string; spentUsdc: string }): Promise<ResearchFollowUp | null> {
    const [row] = await this.database
      .update(researchFollowUp)
      .set({
        answerMd: input.answerMd,
        status: 'completed',
        spentUsdc: input.spentUsdc,
        errorMessage: null,
        completedAt: new Date(),
      })
      .where(eq(researchFollowUp.id, id))
      .returning()

    return row ?? null
  }

  async fail(id: string, errorMessage: string): Promise<ResearchFollowUp | null> {
    const [row] = await this.database
      .update(researchFollowUp)
      .set({
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(researchFollowUp.id, id))
      .returning()

    return row ?? null
  }
}
