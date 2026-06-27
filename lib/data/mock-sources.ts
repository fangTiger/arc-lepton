import { createHash } from 'node:crypto'
import type { PaymentContext } from '@/lib/x402/with-payment'

type Direction = 'in' | 'out'

class DeterministicRandom {
  private counter = 0

  constructor(private readonly seed: string) {}

  next() {
    const hash = createHash('sha256').update(`${this.seed}:${this.counter}`).digest()
    this.counter += 1
    return hash.readUInt32BE(0) / 0xffffffff
  }

  int(min: number, max: number) {
    return Math.floor(this.next() * (max - min + 1)) + min
  }

  float(min: number, max: number, digits = 2) {
    return Number((min + this.next() * (max - min)).toFixed(digits))
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)]
  }

  hex(chars: number) {
    let value = ''
    while (value.length < chars) value += Math.floor(this.next() * 16).toString(16)
    return value.slice(0, chars)
  }
}

function currentDay() {
  return new Date().toISOString().slice(0, 10)
}

function randomFor(source: string, token: string) {
  return new DeterministicRandom(`${source}:${token.toUpperCase()}:${currentDay()}`)
}

function isoAt(dayOffsetHours: number) {
  const base = new Date(`${currentDay()}T12:00:00.000Z`).getTime()
  return new Date(base - dayOffsetHours * 60 * 60 * 1000).toISOString()
}

function address(rand: DeterministicRandom) {
  return `0x${rand.hex(40)}`
}

export function tokenFromRequest(req: Request) {
  return new URL(req.url).searchParams.get('token')?.trim().toUpperCase() || 'PEPE'
}

export function paymentPayload(ctx: PaymentContext) {
  return {
    amount: ctx.amount,
    txHash: ctx.txHash,
    txStatus: ctx.txStatus,
    chainId: ctx.chainId,
    blockNumber: ctx.blockNumber,
    requestId: ctx.requestId,
    source: ctx.source,
  }
}

export function buildWhaleWatchData(token: string) {
  const rand = randomFor('whale-watch', token)
  const movements = Array.from({ length: 5 }, (_, index) => {
    const direction = rand.pick<Direction>(['in', 'out'])
    return {
      time: isoAt(index * 3 + rand.int(0, 2)),
      from: address(rand),
      to: address(rand),
      amountUsd: rand.int(1_100_000, 8_900_000),
      direction,
    }
  })
  const netFlowUsd = movements.reduce((sum, movement) => {
    return sum + (movement.direction === 'in' ? movement.amountUsd : -movement.amountUsd)
  }, 0)
  return { movements, netFlowUsd }
}

export function buildSentimentData(token: string) {
  const rand = randomFor('sentiment', token)
  const breakdown = {
    fearGreedIndex: rand.int(0, 100),
    socialMomentum: rand.int(-100, 100),
    technicalSignal: rand.int(-100, 100),
  }
  const score = Math.round((breakdown.fearGreedIndex - 50 + breakdown.socialMomentum + breakdown.technicalSignal) / 2.5)
  const clampedScore = Math.max(-100, Math.min(100, score))
  const trend = clampedScore > 20 ? 'bullish' : clampedScore < -20 ? 'bearish' : 'neutral'
  return { score: clampedScore, trend, breakdown }
}

export function buildNewsData(token: string) {
  const rand = randomFor('news', token)
  const sources = ['CoinDesk', 'The Block', 'Blockworks', 'Decrypt', 'Cointelegraph']
  const verbs = ['Accumulate', 'Rotate', 'Hedge', 'Reprice', 'Watch']
  const articleCount = rand.int(3, 5)
  const articles = Array.from({ length: articleCount }, (_, index) => ({
    headline: `${token} Whales ${rand.pick(verbs)} Amid Market Cool-down`,
    source: rand.pick(sources),
    publishedAt: isoAt(index * 5 + rand.int(0, 3)),
    url: `https://example.com/${token.toLowerCase()}/${currentDay()}/${index + 1}`,
    sentiment: rand.float(-1, 1, 2),
  }))
  return { articles }
}

export function buildTwitterSignalsData(token: string) {
  const rand = randomFor('twitter-signals', token)
  const authors = ['@CryptoWhaleTracker', '@OnchainPulse', '@ArcMarkets', '@MemeFlowDesk', '@LeptonSignals']
  const tweetCount = rand.int(3, 5)
  const topTweets = Array.from({ length: tweetCount }, (_, index) => {
    const sentiment = rand.float(-1, 1, 2)
    return {
      author: rand.pick(authors),
      text: `$${token} whale 0x${rand.hex(4).toUpperCase()} just ${sentiment < 0 ? 'moved to exchange' : 'added'} ${rand.float(0.8, 4.5, 1)}B tokens...`,
      engagement: rand.int(900, 12_000),
      sentiment,
      postedAt: isoAt(index * 2 + rand.int(0, 2)),
    }
  })
  const overallSentiment = Number((topTweets.reduce((sum, tweet) => sum + tweet.sentiment, 0) / topTweets.length).toFixed(2))
  return { topTweets, overallSentiment }
}

export function buildKlinePatternData(token: string) {
  const rand = randomFor('kline-pattern', token)
  const patterns = ['Bull Flag', 'Bear Pennant', 'Double Top', 'Cup and Handle', 'Symmetrical Triangle'] as const
  const pattern = rand.pick(patterns)
  const direction = pattern === 'Bear Pennant' || pattern === 'Double Top' ? 'down' : 'up'
  const support = rand.float(0.000006, 0.000009, 8)
  const resistance = support + rand.float(0.0000005, 0.000002, 8)
  return {
    timeframe: '4h',
    pattern,
    confidence: rand.float(0.58, 0.91, 2),
    expectedMove: { direction, percent: rand.float(3.5, 14.5, 1) },
    nearestSupport: support,
    nearestResistance: Number(resistance.toFixed(8)),
  }
}
