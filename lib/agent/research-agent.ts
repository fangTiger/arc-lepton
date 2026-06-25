import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/llm/deepseek'
import { researchRepo, txLogRepo } from '@/lib/db'
import {
  buildKlinePatternData,
  buildNewsData,
  buildSentimentData,
  buildTwitterSignalsData,
  buildWhaleWatchData,
} from '@/lib/data/mock-sources'
import { decimalToUnits, unitsToDecimal } from '@/lib/db/tx-log-repo'
import {
  getResearchAbortController,
  markResearchDone,
  publishResearchEvent,
} from './event-bus'

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: object; callId: string }
  | { type: 'tool_result'; callId: string; name: string; payment: { amount: string; txHash: string }; dataPreview: string }
  | { type: 'budget'; spentUsdc: string; remainingUsdc: string }
  | { type: 'report_chunk'; delta: string }
  | { type: 'final'; reportMd: string; totalSpentUsdc: string; totalCalls: number }
  | { type: 'error'; message: string }

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_call_id?: string
  name?: string
  tool_calls?: ToolCall[]
}

type ToolCall = {
  id: string
  type?: string
  function: {
    name: string
    arguments: string
  }
}

type ToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

type LocalTool = {
  source: string
  amount: string
  description: string
  buildData: (token: string) => unknown
}

const MIN_TOOL_AMOUNT = '0.0001'
const MAX_TOOL_TURNS = 6

const localTools = {
  whale_watch: {
    source: 'whale-watch',
    amount: '0.0002',
    description: 'Fetch recent whale transfers above $1M USD for a token. Each call costs $0.0002 USDC.',
    buildData: buildWhaleWatchData,
  },
  sentiment: {
    source: 'sentiment',
    amount: '0.0001',
    description: 'Fetch blended market sentiment for a token. Each call costs $0.0001 USDC.',
    buildData: buildSentimentData,
  },
  news: {
    source: 'news',
    amount: '0.0003',
    description: 'Fetch recent market news headlines for a token. Each call costs $0.0003 USDC.',
    buildData: buildNewsData,
  },
  twitter_signals: {
    source: 'twitter-signals',
    amount: '0.0001',
    description: 'Fetch Twitter signal snapshots for a token. Each call costs $0.0001 USDC.',
    buildData: buildTwitterSignalsData,
  },
  kline_pattern: {
    source: 'kline-pattern',
    amount: '0.0005',
    description: 'Fetch the 4h candlestick pattern for a token. Each call costs $0.0005 USDC.',
    buildData: buildKlinePatternData,
  },
} satisfies Record<string, LocalTool>

export const RESEARCH_TOOLS: ToolDefinition[] = Object.entries(localTools).map(([name, tool]) => ({
  type: 'function',
  function: {
    name,
    description: tool.description,
    parameters: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'token symbol',
        },
      },
      required: ['token'],
    },
  },
}))

function systemPrompt(budgetUsdc: string) {
  return `You are the Arc Lepton research agent. The user will give you a crypto trading research topic.
Your budget is ${budgetUsdc} USDC, and each data-source call charges against that budget.

Available tools:
- whale_watch: $0.0002 — whale transfers
- sentiment: $0.0001 — blended sentiment
- news: $0.0003 — news headlines
- twitter_signals: $0.0001 — Twitter signals
- kline_pattern: $0.0005 — 4h candlestick pattern

Strategy:
1. Start with cheap tools, especially sentiment and twitter_signals, to establish a baseline.
2. Use higher-cost tools such as news and kline_pattern only when they improve the answer.
3. Do not call the same data source repeatedly.
4. Stay within budget while collecting multiple angles.

Return a Markdown research report with: concise conclusion, key findings, risks, action guidance, and data citations.`
}

function parseToolArgs(raw: string): { token: string } {
  try {
    const parsed = JSON.parse(raw) as { token?: unknown }
    const token = typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim().toUpperCase() : 'PEPE'
    return { token }
  } catch {
    return { token: 'PEPE' }
  }
}

function dataPreview(data: unknown) {
  return JSON.stringify(data).slice(0, 500)
}

function remaining(budgetUnits: bigint, spentUnits: bigint) {
  return budgetUnits > spentUnits ? budgetUnits - spentUnits : 0n
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Research cancelled')
}

async function executeTool(address: string, call: ToolCall) {
  const tool = localTools[call.function.name as keyof typeof localTools]
  if (!tool) return null

  const args = parseToolArgs(call.function.arguments)
  const data = tool.buildData(args.token)
  const tx = await txLogRepo.record({ address, source: tool.source, amount: tool.amount })

  return {
    tool,
    args,
    data,
    payment: {
      amount: tool.amount,
      txHash: tx.txHash,
      source: tool.source,
    },
  }
}

function firstChoiceMessage(response: unknown): ChatMessage {
  const choices = (response as { choices?: Array<{ message?: ChatMessage }> }).choices ?? []
  return choices[0]?.message ?? { role: 'assistant', content: null }
}

async function* streamReport(client: ReturnType<typeof getDeepSeekClient>, messages: ChatMessage[]) {
  const stream = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      ...messages,
      {
        role: 'user',
        content: 'Generate the final Markdown research report from the tool results above, and list the data sources and tx_hash values used in this run.',
      },
    ],
    stream: true,
  } as never)

  for await (const chunk of stream as AsyncIterable<{ choices?: Array<{ delta?: { content?: string | null } }> }>) {
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}

export async function* runResearchAgent(opts: {
  researchId: string
  address: string
  topic: string
  budgetUsdc: string
  signal?: AbortSignal
}): AsyncGenerator<AgentEvent> {
  const client = getDeepSeekClient()
  const budgetUnits = decimalToUnits(opts.budgetUsdc)
  const minToolUnits = decimalToUnits(MIN_TOOL_AMOUNT)
  let spentUnits = 0n
  let totalCalls = 0
  let reportMd = ''
  const usedTools = new Set<string>()
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(opts.budgetUsdc) },
    { role: 'user', content: opts.topic },
  ]

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      assertNotAborted(opts.signal)
      if (remaining(budgetUnits, spentUnits) < minToolUnits) break

      const response = await client.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages,
        tools: RESEARCH_TOOLS,
        tool_choice: 'auto',
        stream: false,
      } as never)
      const message = firstChoiceMessage(response)
      messages.push(message)

      const toolCalls = message.tool_calls ?? []
      if (!toolCalls.length) break
      if (message.content) yield { type: 'thinking', text: message.content }

      let executedInTurn = 0
      for (const call of toolCalls) {
        assertNotAborted(opts.signal)
        const tool = localTools[call.function.name as keyof typeof localTools]
        if (!tool || usedTools.has(call.function.name)) continue
        const toolAmountUnits = decimalToUnits(tool.amount)
        if (spentUnits + toolAmountUnits > budgetUnits) break

        const args = parseToolArgs(call.function.arguments)
        yield { type: 'tool_call', name: call.function.name, args, callId: call.id }

        const result = await executeTool(opts.address, call)
        if (!result) continue

        usedTools.add(call.function.name)
        spentUnits += toolAmountUnits
        totalCalls += 1
        executedInTurn += 1
        await researchRepo.appendSpent(opts.researchId, result.tool.amount)

        const toolResultEvent: AgentEvent = {
          type: 'tool_result',
          callId: call.id,
          name: result.tool.source,
          payment: {
            amount: result.payment.amount,
            txHash: result.payment.txHash,
          },
          dataPreview: dataPreview(result.data),
        }
        yield toolResultEvent

        const remainingUsdc = unitsToDecimal(remaining(budgetUnits, spentUnits))
        yield {
          type: 'budget',
          spentUsdc: unitsToDecimal(spentUnits),
          remainingUsdc,
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: JSON.stringify({
            data: result.data,
            payment: result.payment,
          }),
        })

        if (remaining(budgetUnits, spentUnits) < minToolUnits) break
      }

      if (executedInTurn === 0 || remaining(budgetUnits, spentUnits) < minToolUnits) break
    }

    assertNotAborted(opts.signal)
    for await (const delta of streamReport(client, messages)) {
      assertNotAborted(opts.signal)
      reportMd += delta
      yield { type: 'report_chunk', delta }
    }

    await researchRepo.setReport(opts.researchId, reportMd)
    await researchRepo.updateStatus(opts.researchId, 'completed')
    yield {
      type: 'final',
      reportMd,
      totalSpentUsdc: unitsToDecimal(spentUnits),
      totalCalls,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research agent failed'
    if (opts.signal?.aborted) {
      await researchRepo.updateStatus(opts.researchId, 'cancelled', message)
    } else {
      await researchRepo.updateStatus(opts.researchId, 'failed', message)
    }
    yield { type: 'error', message }
  }
}

export async function runAgentInBackground(researchId: string) {
  const research = await researchRepo.findById(researchId)
  if (!research) {
    publishResearchEvent(researchId, { type: 'error', message: 'Research not found' })
    markResearchDone(researchId)
    return
  }

  const controller = getResearchAbortController(researchId)
  for await (const event of runResearchAgent({
    researchId,
    address: research.address,
    topic: research.topic,
    budgetUsdc: research.budgetUsdc,
    signal: controller.signal,
  })) {
    publishResearchEvent(researchId, event)
  }
  markResearchDone(researchId)
}
