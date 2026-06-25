import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
  NODE_ENV: process.env.NODE_ENV,
}

const mutableEnv = process.env as Record<string, string | undefined>

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete mutableEnv[key]
    else mutableEnv[key] = value
  }
}

describe('getDeepSeekClient', () => {
  beforeEach(() => {
    vi.resetModules()
    delete mutableEnv.DEEPSEEK_API_KEY
    delete mutableEnv.DEEPSEEK_BASE_URL
    delete mutableEnv.DEEPSEEK_MODEL
    mutableEnv.NODE_ENV = 'test'
  })

  afterEach(() => {
    vi.resetModules()
    restoreEnv()
  })

  it('returns a mock OpenAI-compatible client in development when API key is missing', async () => {
    const { getDeepSeekClient } = await import('./deepseek')

    const client = getDeepSeekClient()
    const first = await (client.chat.completions.create as (params: object) => Promise<{
      choices: Array<{ message: { tool_calls?: Array<{ function: { name: string } }> } }>
    }>)({ messages: [], model: 'deepseek-v4-flash' })

    expect(first.choices[0].message.tool_calls?.map((call) => call.function.name)).toEqual(['sentiment', 'twitter_signals'])
  })

  it('throws in production when API key is missing', async () => {
    mutableEnv.NODE_ENV = 'production'
    const { getDeepSeekClient } = await import('./deepseek')

    expect(() => getDeepSeekClient()).toThrow('DEEPSEEK_API_KEY required in production')
  })

  it('uses the configured model env value', async () => {
    mutableEnv.DEEPSEEK_MODEL = 'deepseek-v4-flash'

    const { DEEPSEEK_MODEL } = await import('./deepseek')

    expect(DEEPSEEK_MODEL).toBe('deepseek-v4-flash')
  })
})
