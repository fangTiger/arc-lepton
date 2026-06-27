import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockState = vi.hoisted(() => {
  const create = vi.fn()

  return {
    create,
    reset() {
      create.mockReset()
    },
  }
})

vi.mock('@/lib/llm/deepseek', () => ({
  DEEPSEEK_MODEL: 'deepseek-v4-flash',
  getDeepSeekClient: () => ({
    chat: {
      completions: {
        create: mockState.create,
      },
    },
  }),
}))

describe('answerResearchFollowUp', () => {
  beforeEach(() => {
    mockState.reset()
  })

  it('returns a clean markdown answer using the original report and follow-up history', async () => {
    mockState.create.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '## Follow-up Answer\nThe base report still points to a wait-for-confirmation setup.',
          },
        },
      ],
    })

    const { answerResearchFollowUp } = await import('./research-follow-up')
    const answer = await answerResearchFollowUp({
      topic: 'SHOULD I BUY PEPE?',
      reportMd: '# Report\n\nWait for confirmation.',
      history: [
        {
          question: 'What is the main risk?',
          answerMd: 'Liquidity can disappear quickly.',
        },
      ],
      question: 'Does that risk profile change if momentum returns?',
    })

    expect(answer).toBe('## Follow-up Answer\nThe base report still points to a wait-for-confirmation setup.')
    expect(mockState.create).toHaveBeenCalledWith(expect.objectContaining({
      model: 'deepseek-v4-flash',
      stream: false,
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: 'system',
          content: expect.stringContaining('FOLLOW-UP ANSWER MODE'),
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('Does that risk profile change if momentum returns?'),
        }),
      ]),
    }))
    expect(mockState.create.mock.calls[0]?.[0]).not.toHaveProperty('tools')
  })

  it('replaces empty or execution-style output with a deterministic fallback answer', async () => {
    mockState.create.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '<||DSML||tool_calls><invoke name="news"><parameter name="token">PEPE</parameter></invoke>',
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'news',
                  arguments: '{"token":"PEPE"}',
                },
              },
            ],
          },
        },
      ],
    })

    const { answerResearchFollowUp } = await import('./research-follow-up')
    const answer = await answerResearchFollowUp({
      topic: 'SHOULD I BUY PEPE?',
      reportMd: '# Report\n\nWait for confirmation.',
      history: [],
      question: 'Can you confirm the entry now?',
    })

    expect(answer).toContain('Based on the existing report and prior follow-up context')
    expect(answer).not.toContain('DSML')
    expect(answer).not.toContain('invoke')
  })
})
