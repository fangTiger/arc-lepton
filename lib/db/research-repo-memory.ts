import { randomUUID } from 'node:crypto'
import type { Research, ResearchRepo, ResearchStatus } from './research-repo'
import { decimalToUnits, unitsToDecimal } from './tx-log-repo'

export class MemoryResearchRepo implements ResearchRepo {
  private records = new Map<string, Research>()

  async create(input: { address: string; topic: string; budgetUsdc: string }): Promise<Research> {
    const now = new Date()
    const record: Research = {
      id: randomUUID(),
      address: input.address,
      topic: input.topic,
      budgetUsdc: input.budgetUsdc,
      spentUsdc: '0',
      status: 'running',
      reportMd: null,
      errorMessage: null,
      startedAt: now,
      completedAt: null,
    }
    this.records.set(record.id, record)
    return { ...record }
  }

  async findById(id: string): Promise<Research | null> {
    const record = this.records.get(id)
    return record ? { ...record } : null
  }

  async updateStatus(id: string, status: ResearchStatus, errorMessage?: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return

    this.records.set(id, {
      ...record,
      status,
      errorMessage: errorMessage ?? (status === 'failed' ? record.errorMessage : null),
      completedAt: status === 'running' ? null : new Date(),
    })
  }

  async appendSpent(id: string, deltaUsdc: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return

    const nextSpent = unitsToDecimal(decimalToUnits(record.spentUsdc) + decimalToUnits(deltaUsdc))
    this.records.set(id, { ...record, spentUsdc: nextSpent })
  }

  async setReport(id: string, reportMd: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return

    this.records.set(id, { ...record, reportMd })
  }

  async listByAddress(address: string, limit = 50): Promise<Research[]> {
    return [...this.records.values()]
      .filter((record) => record.address === address)
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit)
      .map((record) => ({ ...record }))
  }

  async countAll(): Promise<number> {
    return this.records.size
  }

  async countRunning(): Promise<number> {
    return [...this.records.values()].filter((record) => record.status === 'running').length
  }
}
