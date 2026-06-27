import { randomUUID } from 'node:crypto'
import type { ResearchFollowUp, ResearchFollowUpRepo } from './research-follow-up-repo'

export class MemoryResearchFollowUpRepo implements ResearchFollowUpRepo {
  private records = new Map<string, ResearchFollowUp>()

  private clone(record: ResearchFollowUp): ResearchFollowUp {
    return {
      ...record,
      createdAt: new Date(record.createdAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
    }
  }

  async create(input: { researchId: string; address: string; question: string }): Promise<ResearchFollowUp> {
    const record: ResearchFollowUp = {
      id: randomUUID(),
      researchId: input.researchId,
      address: input.address,
      question: input.question,
      answerMd: null,
      status: 'pending',
      spentUsdc: '0',
      errorMessage: null,
      createdAt: new Date(),
      completedAt: null,
    }

    this.records.set(record.id, record)
    return this.clone(record)
  }

  async listByResearchId(address: string, researchId: string, limit = 50): Promise<ResearchFollowUp[]> {
    const items = [...this.records.values()]
      .filter((record) => record.address === address && record.researchId === researchId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return items.slice(Math.max(items.length - limit, 0)).map((record) => this.clone(record))
  }

  async complete(id: string, input: { answerMd: string; spentUsdc: string }): Promise<ResearchFollowUp | null> {
    const record = this.records.get(id)
    if (!record) return null

    const updated: ResearchFollowUp = {
      ...record,
      answerMd: input.answerMd,
      status: 'completed',
      spentUsdc: input.spentUsdc,
      errorMessage: null,
      completedAt: new Date(),
    }

    this.records.set(id, updated)
    return this.clone(updated)
  }

  async fail(id: string, errorMessage: string): Promise<ResearchFollowUp | null> {
    const record = this.records.get(id)
    if (!record) return null

    const updated: ResearchFollowUp = {
      ...record,
      answerMd: null,
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    }

    this.records.set(id, updated)
    return this.clone(updated)
  }
}
