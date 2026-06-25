import { randomBytes, randomUUID } from 'node:crypto'
import type { TxLogEntry, TxLogRepo } from './tx-log-repo'
import { decimalToUnits, unitsToDecimal } from './tx-log-repo'

function mockTxHash() {
  return `0x${randomBytes(32).toString('hex')}`
}

export class MemoryTxLogRepo implements TxLogRepo {
  private entries = new Map<string, TxLogEntry>()

  async record(entry: { address: string; source: string; amount: string }): Promise<{ id: string; txHash: string; createdAt: Date }> {
    const id = randomUUID()
    const txHash = mockTxHash()
    const createdAt = new Date()

    this.entries.set(id, {
      id,
      address: entry.address,
      source: entry.source,
      amount: entry.amount,
      txHash,
      createdAt,
    })

    return { id, txHash, createdAt }
  }

  async listByAddress(address: string, limit = 50): Promise<TxLogEntry[]> {
    return [...this.entries.values()]
      .filter((entry) => entry.address === address)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
  }

  async totalSpentByAddress(address: string): Promise<string> {
    const total = [...this.entries.values()]
      .filter((entry) => entry.address === address)
      .reduce((sum, entry) => sum + decimalToUnits(entry.amount), 0n)

    return unitsToDecimal(total)
  }

  async count(): Promise<number> {
    return this.entries.size
  }

  async totalSpent(): Promise<string> {
    const total = [...this.entries.values()].reduce((sum, entry) => sum + decimalToUnits(entry.amount), 0n)
    return unitsToDecimal(total)
  }
}
