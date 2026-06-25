import { randomBytes } from 'node:crypto'
import { desc, eq, sql } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { txLog } from './schema/tx-log'
import type { TxLogEntry, TxLogRepo } from './tx-log-repo'
import { normalizeDecimalString } from './tx-log-repo'

type DbClient = VercelPgDatabase<typeof schema>

function mockTxHash() {
  return `0x${randomBytes(32).toString('hex')}`
}

export class PgTxLogRepo implements TxLogRepo {
  constructor(private readonly database: DbClient) {}

  async record(entry: { address: string; source: string; amount: string }): Promise<{ id: string; txHash: string; createdAt: Date }> {
    const txHash = mockTxHash()
    const [row] = await this.database
      .insert(txLog)
      .values({ ...entry, txHash })
      .returning({ id: txLog.id, txHash: txLog.txHash, createdAt: txLog.createdAt })

    if (!row) throw new Error('Failed to record tx_log')
    return row
  }

  async listByAddress(address: string, limit = 50): Promise<TxLogEntry[]> {
    return this.database
      .select()
      .from(txLog)
      .where(eq(txLog.address, address))
      .orderBy(desc(txLog.createdAt))
      .limit(limit)
  }

  async totalSpentByAddress(address: string): Promise<string> {
    const [row] = await this.database
      .select({ value: sql<string>`coalesce(sum(${txLog.amount}), 0)` })
      .from(txLog)
      .where(eq(txLog.address, address))

    return normalizeDecimalString(row?.value ?? '0')
  }
}
