import { DEEPSEEK_MODEL, getDeepSeekClient } from '@/lib/llm/deepseek'

type FollowUpHistoryEntry = {
  question: string
  answerMd: string
}

const INVALID_FOLLOW_UP_PATTERNS = [
  /<\|\|dsml\|\|/i,
  /\btool_calls\b/i,
  /<\s*invoke\b/i,
  /\binvoke\s+name\b/i,
  /<\s*parameter\b/i,
  /\bparameter\s+name\b/i,
  /```(?:xml|json)/i,
]

function followUpPrompt(input: {
  topic: string
  reportMd: string
  history: FollowUpHistoryEntry[]
  question: string
}) {
  const historyBlock = input.history.length
    ? input.history
        .map((entry, index) => `Q${index + 1}: ${entry.question}\nA${index + 1}: ${entry.answerMd}`)
        .join('\n\n')
    : 'None.'

  return `Original topic:
${input.topic}

Original report:
${input.reportMd}

Prior follow-up Q&A:
${historyBlock}

Current follow-up question:
${input.question}`
}

function systemPrompt() {
  return `FOLLOW-UP ANSWER MODE.
You are answering a follow-up question about an existing crypto research report.
Use only the original topic, original report, and prior follow-up Q&A provided in this conversation.
Do not call any tools.
Do not ask for fresh data.
Do not output DSML, XML, tool_calls, invoke, parameter, or JSON tool syntax.
Return a short English Markdown answer only.`
}

function fallbackAnswer() {
  return `## Follow-up Answer

Based on the existing report and prior follow-up context, I cannot support a stronger conclusion without fresh data.

### Constraint
This answer is limited to the original report and previous follow-up answers already stored for this research.`
}

function hasDirtyContent(content: string) {
  return INVALID_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(content))
}

type CompletionMessage = {
  content?: string | null
  tool_calls?: Array<unknown>
}

function firstMessage(response: unknown): CompletionMessage {
  const choices = (response as { choices?: Array<{ message?: CompletionMessage }> }).choices ?? []
  return choices[0]?.message ?? {}
}

export async function answerResearchFollowUp(input: {
  topic: string
  reportMd: string
  history: FollowUpHistoryEntry[]
  question: string
}) {
  const client = getDeepSeekClient()
  const response = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: systemPrompt(),
      },
      {
        role: 'user',
        content: followUpPrompt(input),
      },
    ],
    stream: false,
  } as never)

  const message = firstMessage(response)
  const content = typeof message.content === 'string' ? message.content.trim() : ''
  if (!content || (message.tool_calls?.length ?? 0) > 0 || hasDirtyContent(content)) {
    return fallbackAnswer()
  }

  return content
}
