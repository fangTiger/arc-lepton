export type ResearchFollowUpStatus = 'pending' | 'completed' | 'failed'

export type ResearchFollowUp = {
  id: string
  researchId: string
  address: string
  question: string
  answerMd: string | null
  status: ResearchFollowUpStatus
  spentUsdc: string
  errorMessage: string | null
  createdAt: Date
  completedAt: Date | null
}

export interface ResearchFollowUpRepo {
  create(input: { researchId: string; address: string; question: string }): Promise<ResearchFollowUp>
  listByResearchId(address: string, researchId: string, limit?: number): Promise<ResearchFollowUp[]>
  complete(id: string, input: { answerMd: string; spentUsdc: string }): Promise<ResearchFollowUp | null>
  fail(id: string, errorMessage: string): Promise<ResearchFollowUp | null>
}
