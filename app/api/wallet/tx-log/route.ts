import { requireAuth } from '@/lib/auth/middleware'
import { txLogRepo } from '@/lib/db'

function serializeEntry(entry: Awaited<ReturnType<typeof txLogRepo.listByAddress>>[number]) {
  return {
    ...entry,
    createdAt: entry.createdAt.toISOString(),
  }
}

export async function GET(req: Request) {
  try {
    const { address } = await requireAuth(req)
    const entries = await txLogRepo.listByAddress(address, 50)
    return Response.json({ entries: entries.map(serializeEntry) })
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
