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
    '# PEPE 研究报告\n\n',
    '## 简要结论\nPEPE 当前更适合观望，等待链上流向和 K 线确认。\n\n',
    '## 关键发现\n- 情绪与社交热度有分歧，短线波动可能加大。\n',
    '- 鲸鱼流向和新闻面需要结合仓位管理。\n\n',
    '## 风险提示\nMeme token 流动性和情绪反转风险较高。\n\n',
    '## 操作建议\n观望。\n',
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
                    content: '先用低成本数据源建立基础判断。',
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
                    content: '补充链上、新闻和技术面。',
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
                  content: '数据已足够，可以生成报告。',
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
    baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  })
}
