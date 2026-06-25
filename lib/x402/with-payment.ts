import { requireAuth } from '@/lib/auth/middleware'
import { txLogRepo } from '@/lib/db'

export interface PaymentContext {
  address: string
  source: string
  amount: string
  txHash: string
  recordedAt: Date
}

export function withPayment(
  source: string,
  amount: string,
  handler: (req: Request, ctx: PaymentContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    let address: string
    try {
      const auth = await requireAuth(req)
      address = auth.address
    } catch (error) {
      if (error instanceof Response) return error
      throw error
    }

    const tx = await txLogRepo.record({ address, source, amount })
    const ctx: PaymentContext = {
      address,
      source,
      amount,
      txHash: tx.txHash,
      recordedAt: tx.createdAt,
    }

    const res = await handler(req, ctx)
    res.headers.set('X-Payment-Tx', tx.txHash)
    res.headers.set('X-Payment-Amount', amount)
    res.headers.set('X-Payment-Source', source)
    return res
  }
}
