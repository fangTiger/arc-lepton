import OpenAI from 'openai'

export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash'

type MockToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

function toolCall(id: string, name: string, token = 'PEPE'): MockToolCall {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify({ token }),
    },
  }
}

async function* mockReportStream() {
  const chunks = [
    '# PEPE Research Report\n\n',
    '## Concise Conclusion\nPEPE is better suited for watchlist mode until on-chain flow and 4h structure confirm direction.\n\n',
    '## Key Findings\n- Sentiment and social heat diverge, which can amplify short-term volatility.\n',
    '- Whale flow and headlines should be paired with strict position sizing.\n\n',
    '## Risk Notes\nMeme token liquidity and sentiment reversal risk remain elevated.\n\n',
    '## Action Guidance\nWait for confirmation.\n',
  ]

  for (const content of chunks) {
    yield { choices: [{ delta: { content } }] }
  }
}

function createMockDeepSeekClient() {
  let turn = 0

  return {
    chat: {
      completions: {
        async create(params: { stream?: boolean }) {
          if (params.stream) return mockReportStream()

          turn += 1
          if (turn === 1) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Start with low-cost data sources to build a baseline.',
                    tool_calls: [
                      toolCall('mock-call-1', 'sentiment'),
                      toolCall('mock-call-2', 'twitter_signals'),
                    ],
                  },
                },
              ],
            }
          }

          if (turn === 2) {
            return {
              choices: [
                {
                  message: {
                    role: 'assistant',
                    content: 'Add on-chain, news, and technical context.',
                    tool_calls: [
                      toolCall('mock-call-3', 'whale_watch'),
                      toolCall('mock-call-4', 'news'),
                      toolCall('mock-call-5', 'kline_pattern'),
                    ],
                  },
                },
              ],
            }
          }

          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'The data is sufficient to generate the report.',
                },
              },
            ],
          }
        },
      },
    },
  }
}

export type DeepSeekClient = OpenAI | ReturnType<typeof createMockDeepSeekClient>

export function getDeepSeekClient(): DeepSeekClient {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()

  if (!apiKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DEEPSEEK_API_KEY required in production')
    }

    return createMockDeepSeekClient()
  }

  return new OpenAI({
    apiKey,
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
  })
}
