import {
  buildKlinePatternData,
  buildNewsData,
  buildSentimentData,
  buildTwitterSignalsData,
  buildWhaleWatchData,
  paymentPayload,
  tokenFromRequest,
} from '@/lib/data/mock-sources'
import { withPayment } from '@/lib/x402/with-payment'

type RouteContext = {
  params: {
    name: string
  }
}

const paidRoutes: Record<string, (req: Request) => Promise<Response>> = {
  'whale-watch': withPayment('whale-watch', '0.0002', async (req, ctx) => {
    const token = tokenFromRequest(req)
    return Response.json({
      source: ctx.source,
      token,
      data: buildWhaleWatchData(token),
      payment: paymentPayload(ctx),
    })
  }),
  sentiment: withPayment('sentiment', '0.0001', async (req, ctx) => {
    const token = tokenFromRequest(req)
    return Response.json({
      source: ctx.source,
      token,
      data: buildSentimentData(token),
      payment: paymentPayload(ctx),
    })
  }),
  news: withPayment('news', '0.0003', async (req, ctx) => {
    const token = tokenFromRequest(req)
    return Response.json({
      source: ctx.source,
      token,
      data: buildNewsData(token),
      payment: paymentPayload(ctx),
    })
  }),
  'twitter-signals': withPayment('twitter-signals', '0.0001', async (req, ctx) => {
    const token = tokenFromRequest(req)
    return Response.json({
      source: ctx.source,
      token,
      data: buildTwitterSignalsData(token),
      payment: paymentPayload(ctx),
    })
  }),
  'kline-pattern': withPayment('kline-pattern', '0.0005', async (req, ctx) => {
    const token = tokenFromRequest(req)
    return Response.json({
      source: ctx.source,
      token,
      data: buildKlinePatternData(token),
      payment: paymentPayload(ctx),
    })
  }),
}

export async function GET(req: Request, { params }: RouteContext) {
  const route = paidRoutes[params.name]
  if (!route) return Response.json({ error: 'Unknown data source' }, { status: 404 })

  return route(req)
}
