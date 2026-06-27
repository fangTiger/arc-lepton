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
  updateStatusIfCurrent(id: string, expectedStatus: ResearchStatus, status: ResearchStatus, errorMessage?: string): Promise<boolean>
  completeIfRunning(id: string, reportMd: string): Promise<boolean>
  appendSpent(id: string, deltaUsdc: string): Promise<void>
  setReport(id: string, reportMd: string): Promise<void>
  listByAddress(address: string, limit?: number): Promise<Research[]>
  countAll(): Promise<number>
  countRunning(): Promise<number>
}
