export type ResearchStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export type Research = {
  id: string
  address: string
  topic: string
  budgetUsdc: string
  spentUsdc: string
  status: ResearchStatus
  reportMd: string | null
  errorMessage: string | null
  startedAt: Date
  completedAt: Date | null
}

export interface ResearchRepo {
  create(input: { address: string; topic: string; budgetUsdc: string }): Promise<Research>
  findById(id: string): Promise<Research | null>
  updateStatus(id: string, status: ResearchStatus, errorMessage?: string): Promise<void>
  appendSpent(id: string, deltaUsdc: string): Promise<void>
  setReport(id: string, reportMd: string): Promise<void>
  listByAddress(address: string, limit?: number): Promise<Research[]>
}
