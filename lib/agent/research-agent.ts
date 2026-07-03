import { PRODUCT_NAME } from '@/lib/brand'
import { getDeepSeekClient, DEEPSEEK_MODEL } from '@/lib/llm/deepseek'
import { researchRepo } from '@/lib/db'
import {
  buildKlinePatternData,
  buildNewsData,
  buildSentimentData,
  buildTwitterSignalsData,
  buildWhaleWatchData,
} from '@/lib/data/mock-sources'
import { decimalToUnits, unitsToDecimal } from '@/lib/db/tx-log-repo'
import { recordPaymentAggregate, recordResearchFinished } from '@/lib/stats/global-stats'
import { recordResearchPaymentIntent } from '@/lib/x402/payment-recorder'
import { settleResearchPayments } from '@/lib/x402/payment-settlement'
import {
  claimResearchRunner,
  getResearchAbortController,
  markResearchDone,
  publishResearchEvent,
} from './event-bus'

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'tool_call'; name: string; args: object; callId: string }
  | {
      type: 'tool_result'
      callId: string
      name: string
      payment: {
        amount: string
        txHash: string | null
        txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
        chainId: number | null
        blockNumber: string | null
        requestId: string
      }
      dataPreview: string
    }
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

type CompletedToolResult = {
  source: string
  amount: string
  txHash: string | null
  txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
  chainId: number | null
  blockNumber: string | null
  requestId: string
  preview: string
}

const MIN_TOOL_AMOUNT = '0.0001'
export const MAX_PAID_TOOL_CALLS = 3
const MAX_TOOL_TURNS = 6
const INVALID_REPORT_PATTERNS = [
  /<\|\|dsml\|\|/i,
  /\btool_calls\b/i,
  /<\s*invoke\b/i,
  /\binvoke\s+name\b/i,
  /<\s*parameter\b/i,
  /\bparameter\s+name\b/i,
  /let me get some additional data/i,
]

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
  return `You are the ${PRODUCT_NAME} research agent. The user will give you a crypto trading research topic.
Your budget is ${budgetUsdc} USDC, and each data-source call charges against that budget.

Available tools:
- whale_watch: $0.0002 — whale transfers
- sentiment: $0.0001 — blended sentiment
- news: $0.0003 — news headlines
- twitter_signals: $0.0001 — Twitter signals
- kline_pattern: $0.0005 — 4h candlestick pattern

Strategy:
1. Use at most 3 paid data-source calls for this research run.
2. Start with cheap, high-signal tools, especially sentiment and twitter_signals, to establish a baseline.
3. Use higher-cost tools such as news and kline_pattern only when they materially improve the answer.
4. Do not call the same data source repeatedly or ask for redundant coverage.
5. Stay within budget while collecting multiple angles.

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

function sortToolArgumentValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortToolArgumentValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, sortToolArgumentValue(entryValue)]),
    )
  }
  return value
}

function buildToolDedupMeta(call: ToolCall) {
  try {
    const parsed = JSON.parse(call.function.arguments) as Record<string, unknown>
    const normalizedArgs = {
      ...parsed,
      token: parseToolArgs(call.function.arguments).token,
    }
    const normalizedArgsText = JSON.stringify(sortToolArgumentValue(normalizedArgs))
    return {
      argsKey: `${call.function.name}:${normalizedArgsText}`,
      arguments: JSON.parse(normalizedArgsText) as Record<string, unknown>,
    }
  } catch {
    return {
      argsKey: `${call.function.name}:${call.function.arguments}`,
      arguments: call.function.arguments,
    }
  }
}

function dataPreview(data: unknown) {
  return JSON.stringify(data).slice(0, 500)
}

function remaining(budgetUnits: bigint, spentUnits: bigint) {
  return budgetUnits > spentUnits ? budgetUnits - spentUnits : 0n
}

function pushToolMessage(messages: ChatMessage[], call: ToolCall, content: Record<string, unknown>) {
  messages.push({
    role: 'tool',
    tool_call_id: call.id,
    name: call.function.name,
    content: JSON.stringify(content),
  })
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Research cancelled')
}

function requestOptions(signal?: AbortSignal) {
  return signal ? ({ signal } as { signal: AbortSignal }) : undefined
}

function safeToolErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return 'Tool execution failed'
}

async function executeTool(
  address: string,
  researchId: string,
  call: ToolCall,
  signal?: AbortSignal,
  onPaymentIntentRecorded?: () => void,
) {
  assertNotAborted(signal)
  const tool = localTools[call.function.name as keyof typeof localTools]
  if (!tool) return null

  const args = parseToolArgs(call.function.arguments)
  const data = tool.buildData(args.token)
  const tx = await recordResearchPaymentIntent({
    address,
    source: tool.source,
    amount: tool.amount,
    requestId: call.id,
    researchId,
    signal,
  })
  onPaymentIntentRecorded?.()
  assertNotAborted(signal)

  return {
    tool,
    args,
    data,
    payment: {
      amount: tool.amount,
      txHash: tx.txHash,
      txStatus: tx.txStatus,
      chainId: tx.chainId,
      blockNumber: tx.blockNumber,
      requestId: tx.requestId,
      source: tool.source,
    },
  }
}

function finalReportPrompt() {
  return `FINAL REPORT MODE.
Use only the completed tool results already present in this conversation.
Do not call any tools.
Do not ask for additional data.
Do not output tool syntax, DSML, XML, tool_calls, invoke, parameter, or tool execution JSON.
If data is incomplete, say so in Limitations.
Return Markdown only.

Required sections:
- Concise conclusion
- Key findings
- Risks
- Action guidance
- Completed data sources
- Payment trace
- Limitations

List only completed data sources and tx_hash values from this run.`
}

function firstChoiceMessage(response: unknown): ChatMessage {
  const choices = (response as { choices?: Array<{ message?: ChatMessage }> }).choices ?? []
  return choices[0]?.message ?? { role: 'assistant', content: null }
}

async function* streamReport(
  client: ReturnType<typeof getDeepSeekClient>,
  messages: ChatMessage[],
  signal?: AbortSignal,
) {
  assertNotAborted(signal)
  const stream = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      ...messages,
      {
        role: 'user',
        content: finalReportPrompt(),
      },
    ],
    stream: true,
  } as never, requestOptions(signal) as never)
  assertNotAborted(signal)

  for await (const chunk of stream as AsyncIterable<{ choices?: Array<{ delta?: { content?: string | null } }> }>) {
    assertNotAborted(signal)
    const delta = chunk.choices?.[0]?.delta?.content
    if (delta) yield delta
  }
}

function shouldReplaceReport(rawReportMd: string) {
  const normalized = rawReportMd.trim()
  if (!normalized) return true
  return INVALID_REPORT_PATTERNS.some((pattern) => pattern.test(rawReportMd))
}

function buildFallbackReport(completedResults: CompletedToolResult[], totalSpentUsdc: string) {
  const completedSources = completedResults.length
    ? completedResults
        .map((result) => `- ${result.source}: ${result.preview}`)
        .join('\n')
    : '- None. No tool results completed before finalization.'

  const paymentTrace = completedResults.length
    ? completedResults
        .map((result) => {
          const txHash = result.txHash ?? 'not available'
          const chain = result.chainId === null ? 'n/a' : String(result.chainId)
          const block = result.blockNumber ?? 'n/a'
          return `- ${result.source} | amount ${result.amount} USDC | request ${result.requestId} | tx status ${result.txStatus} | tx_hash ${txHash} | chain ${chain} | block ${block}`
        })
        .join('\n')
    : '- No payment receipts were recorded.'

  return `# Research Report

This report is based only on completed tool results collected before finalization. No additional tools were called during report generation.

## Concise conclusion
- A clean model-written final report was not available, so this fallback summarizes only verified completed tool outputs.

## Key findings
- Completed tool calls: ${completedResults.length}
- Total spent: ${totalSpentUsdc} USDC

## Risks
- The discarded model output attempted to continue tool-style execution instead of producing a clean report.

## Action guidance
- Treat this summary as a verified fallback and wait for a fresh run if a richer narrative is needed.

## Completed data sources
${completedSources}

## Payment trace
${paymentTrace}

## Limitations
- This fallback uses only completed tool results and recorded payment receipts from this run.
- It excludes any invalid execution-style text emitted during final report generation.
- No extra data was fetched during finalization.`
}

function finalizeReport(rawReportMd: string, completedResults: CompletedToolResult[], totalSpentUsdc: string) {
  if (shouldReplaceReport(rawReportMd)) {
    return buildFallbackReport(completedResults, totalSpentUsdc)
  }
  return rawReportMd.trim()
}

function settleResearchPaymentsInBackground(address: string, researchId: string) {
  void settleResearchPayments({ address, researchId }).catch((error) => {
    console.warn('异步研究支付结算失败', error)
  })
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
  let hasPaymentIntent = false
  let shouldAttemptSettlement = false
  let reportMd = ''
  const completedResults: CompletedToolResult[] = []
  const usedTools = new Set<string>()
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(opts.budgetUsdc) },
    { role: 'user', content: opts.topic },
  ]

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      assertNotAborted(opts.signal)
      if (remaining(budgetUnits, spentUnits) < minToolUnits) break
      if (totalCalls >= MAX_PAID_TOOL_CALLS) break

      const response = await client.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages,
        tools: RESEARCH_TOOLS,
        tool_choice: 'auto',
        stream: false,
      } as never, requestOptions(opts.signal) as never)
      assertNotAborted(opts.signal)
      const message = firstChoiceMessage(response)
      messages.push(message)

      const toolCalls = message.tool_calls ?? []
      if (!toolCalls.length) break
      if (message.content) yield { type: 'thinking', text: message.content }

      let executedInTurn = 0
      let canExecuteMoreTools = true
      for (const call of toolCalls) {
        assertNotAborted(opts.signal)
        const tool = localTools[call.function.name as keyof typeof localTools]
        const dedupMeta = buildToolDedupMeta(call)
        if (!tool) {
          pushToolMessage(messages, call, {
            status: 'error',
            reason: 'unknown_tool',
            name: call.function.name,
          })
          continue
        }
        if (usedTools.has(dedupMeta.argsKey)) {
          pushToolMessage(messages, call, {
            status: 'skipped',
            reason: 'duplicate_tool',
            name: call.function.name,
            argsKey: dedupMeta.argsKey,
            arguments: dedupMeta.arguments,
          })
          continue
        }
        if (totalCalls >= MAX_PAID_TOOL_CALLS) {
          pushToolMessage(messages, call, {
            status: 'skipped',
            reason: 'tool_call_limit_reached',
            name: call.function.name,
          })
          continue
        }
        const toolAmountUnits = decimalToUnits(tool.amount)
        if (!canExecuteMoreTools || spentUnits + toolAmountUnits > budgetUnits) {
          canExecuteMoreTools = false
          pushToolMessage(messages, call, {
            status: 'skipped',
            reason: 'budget_exceeded',
            name: call.function.name,
          })
          continue
        }

        const args = parseToolArgs(call.function.arguments)
        yield { type: 'tool_call', name: call.function.name, args, callId: call.id }
        shouldAttemptSettlement = true

        let result
        try {
          result = await executeTool(opts.address, opts.researchId, call, opts.signal, () => {
            hasPaymentIntent = true
          })
        } catch (error) {
          pushToolMessage(messages, call, {
            status: 'error',
            reason: 'execution_failed',
            name: call.function.name,
            message: safeToolErrorMessage(error),
          })
          throw error
        }
        if (!result) {
          pushToolMessage(messages, call, {
            status: 'error',
            reason: 'execution_failed',
            name: call.function.name,
          })
          continue
        }

        assertNotAborted(opts.signal)
        await researchRepo.appendSpent(opts.researchId, result.tool.amount)
        await recordPaymentAggregate(result.payment.amount, result.payment.txStatus).catch((error) => {
          console.warn('记录全局支付统计失败', error)
        })
        assertNotAborted(opts.signal)
        usedTools.add(dedupMeta.argsKey)
        spentUnits += toolAmountUnits
        totalCalls += 1
        executedInTurn += 1

        const toolResultEvent: AgentEvent = {
          type: 'tool_result',
          callId: call.id,
          name: result.tool.source,
          payment: {
            amount: result.payment.amount,
            txHash: result.payment.txHash,
            txStatus: result.payment.txStatus,
            chainId: result.payment.chainId,
            blockNumber: result.payment.blockNumber,
            requestId: result.payment.requestId,
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

        completedResults.push({
          source: result.tool.source,
          amount: result.payment.amount,
          txHash: result.payment.txHash,
          txStatus: result.payment.txStatus,
          chainId: result.payment.chainId,
          blockNumber: result.payment.blockNumber,
          requestId: result.payment.requestId,
          preview: dataPreview(result.data).replace(/\s+/g, ' '),
        })

        pushToolMessage(messages, call, {
          data: result.data,
          payment: result.payment,
        })

        if (remaining(budgetUnits, spentUnits) < minToolUnits) canExecuteMoreTools = false
      }

      if (executedInTurn === 0 || remaining(budgetUnits, spentUnits) < minToolUnits || totalCalls >= MAX_PAID_TOOL_CALLS) break
    }

    assertNotAborted(opts.signal)
    const rawReportChunks: string[] = []
    let reportStreamRejected = false
    for await (const delta of streamReport(client, messages, opts.signal)) {
      assertNotAborted(opts.signal)
      rawReportChunks.push(delta)
      if (reportStreamRejected) continue
      if (shouldReplaceReport(rawReportChunks.join(''))) {
        reportStreamRejected = true
        continue
      }
      yield { type: 'report_chunk', delta }
    }
    assertNotAborted(opts.signal)
    const rawReportMd = rawReportChunks.join('')
    reportMd = finalizeReport(rawReportMd, completedResults, unitsToDecimal(spentUnits))
    if (reportStreamRejected || reportMd !== rawReportMd.trim()) {
      yield { type: 'report_chunk', delta: reportMd }
    }

    const completed = await researchRepo.completeIfRunning(opts.researchId, reportMd)
    if (!completed) return
    await recordResearchFinished().catch((error) => {
      console.warn('记录全局研究结束统计失败', error)
    })
    settleResearchPaymentsInBackground(opts.address, opts.researchId)
    yield {
      type: 'final',
      reportMd,
      totalSpentUsdc: unitsToDecimal(spentUnits),
      totalCalls,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Research agent failed'
    const status = opts.signal?.aborted ? 'cancelled' : 'failed'
    const shouldSettlePaymentIntents = shouldAttemptSettlement || hasPaymentIntent || totalCalls > 0
    const updated = await researchRepo.updateStatusIfCurrent(opts.researchId, 'running', status, message)
    if (!updated) {
      if (opts.signal?.aborted) {
        const latest = await researchRepo.findById(opts.researchId)
        if (latest?.status === 'cancelled') {
          if (shouldSettlePaymentIntents) {
            settleResearchPaymentsInBackground(opts.address, opts.researchId)
          }
          yield { type: 'error', message: latest.errorMessage ?? message }
        }
      }
      return
    }
    await recordResearchFinished().catch((error) => {
      console.warn('记录全局研究结束统计失败', error)
    })
    if (shouldSettlePaymentIntents) {
      settleResearchPaymentsInBackground(opts.address, opts.researchId)
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

  if (!claimResearchRunner(researchId)) return

  const controller = getResearchAbortController(researchId)
  try {
    for await (const event of runResearchAgent({
      researchId,
      address: research.address,
      topic: research.topic,
      budgetUsdc: research.budgetUsdc,
      signal: controller.signal,
    })) {
      publishResearchEvent(researchId, event)
    }
  } finally {
    markResearchDone(researchId)
  }
}
