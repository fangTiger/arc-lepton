import { requireAuth } from '@/lib/auth/middleware'
import { txLogRepo, workflowOutboxRepo } from '@/lib/db'
import { escrowSettlementOperationKey, serializeTxLogEntry } from '@/lib/research/tx-log-serialization'

async function serializeEntry(entry: Awaited<ReturnType<typeof txLogRepo.listByAddress>>[number]) {
  const operationKey = escrowSettlementOperationKey(entry)
  const operation = operationKey ? await workflowOutboxRepo.findByOperationKey(operationKey) : null
  return serializeTxLogEntry(entry, operation)
}

export async function GET(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const entries = await txLogRepo.listByAddress(address, 50)
    return Response.json({ entries: await Promise.all(entries.map(serializeEntry)) })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
