import { requireAuth } from '@/lib/auth/middleware'
import { isValidIdempotencyKey } from './idempotency-key'
import { recordPaymentReceipt } from './payment-recorder'

export interface PaymentContext {
  address: string
  source: string
  amount: string
  txHash: string | null
  txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
  chainId: number | null
  blockNumber: string | null
  requestId: string
  errorMessage: string | null
  recordedAt: Date
}

function paymentErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code
  }
  return null
}

function arcReceiptMode() {
  return process.env.ARC_RECEIPT_MODE?.trim().toLowerCase() === 'arc' ? 'arc' : 'mock'
}

function requestIdFromRequest(req: Request) {
  const url = new URL(req.url)
  if (req.headers.has('Idempotency-Key')) return req.headers.get('Idempotency-Key') ?? ''
  if (req.headers.has('X-Idempotency-Key')) return req.headers.get('X-Idempotency-Key') ?? ''
  if (url.searchParams.has('requestId')) return url.searchParams.get('requestId') ?? ''
  return undefined
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

    const requestId = requestIdFromRequest(req)
    if (requestId !== undefined && !isValidIdempotencyKey(requestId)) {
      return Response.json({ error: 'IDEMPOTENCY_KEY_INVALID' }, { status: 400 })
    }
    if (arcReceiptMode() === 'arc' && requestId === undefined) {
      return Response.json({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 })
    }

    let tx
    try {
      tx = await recordPaymentReceipt({ address, source, amount, requestId })
    } catch (error) {
      const code = paymentErrorCode(error)
      if (code === 'PAYMENT_IDEMPOTENCY_KEY_INVALID') {
        return Response.json({ error: 'IDEMPOTENCY_KEY_INVALID' }, { status: 400 })
      }
      if (code === 'PAYMENT_IDEMPOTENCY_CONFLICT') {
        return Response.json({ error: 'PAYMENT_IDEMPOTENCY_CONFLICT' }, { status: 409 })
      }
      if (code === 'PAYMENT_RECEIPT_PENDING') {
        return Response.json({ error: 'PAYMENT_RECEIPT_PENDING' }, { status: 409 })
      }
      if (code === 'PAYMENT_RECEIPT_FAILED') {
        return Response.json({ error: 'PAYMENT_RECEIPT_FAILED' }, { status: 502 })
      }
      throw error
    }

    const effectiveRequestId = requestId ?? tx.requestId
    if (!effectiveRequestId) throw new Error('Payment receipt is missing requestId')

    const ctx: PaymentContext = {
      address,
      source,
      amount,
      txHash: tx.txHash,
      txStatus: tx.txStatus,
      chainId: tx.chainId,
      blockNumber: tx.blockNumber,
      requestId: effectiveRequestId,
      errorMessage: tx.errorMessage,
      recordedAt: tx.createdAt,
    }

    const res = await handler(req, ctx)
    if (tx.txHash) res.headers.set('X-Payment-Tx', tx.txHash)
    res.headers.set('X-Payment-Tx-Status', tx.txStatus)
    res.headers.set('X-Payment-Amount', amount)
    res.headers.set('X-Payment-Source', source)
    return res
  }
}
