import { requireAuth } from '@/lib/auth/middleware'
import { getQuotaStatus } from '@/lib/rate-limit/research-quota'

export async function GET(req: Request) {
  try {
    const { address } = await requireAuth(req)
    return Response.json(await getQuotaStatus(address))
  } catch (error) {
    if (error instanceof Response) return error
    throw error
  }
}
