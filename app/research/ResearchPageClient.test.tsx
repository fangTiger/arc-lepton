import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchPageClient } from './ResearchPageClient'

const navigation = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  searchId: null as string | null,
}))

const agentLogHarness = vi.hoisted(() => ({
  onEvent: null as null | ((event: {
    type: string
    reportMd?: string
    message?: string
    text?: string
    delta?: string
    receivedAt?: string
  }) => void),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.routerPush, replace: navigation.routerReplace }),
  useSearchParams: () => ({ get: (name: string) => (name === 'id' ? navigation.searchId : null) }),
}))

vi.mock('@/components/research/AgentLogStream', () => ({
  AgentLogStream: ({
    events,
    onEvent,
  }: {
    events: Array<{ type: string; reportMd?: string; message?: string; text?: string; delta?: string }>
    onEvent: (event: {
      type: string
      reportMd?: string
      message?: string
      text?: string
      delta?: string
      receivedAt?: string
    }) => void
  }) => {
    agentLogHarness.onEvent = onEvent
    return (
      <div data-testid="agent-log-events">
        {events.map((event) => event.reportMd ?? event.message ?? event.text ?? event.delta ?? event.type).join('\n')}
      </div>
    )
  },
}))

vi.mock('@/components/research/TxFeed', () => ({
  TxFeed: () => null,
}))

vi.mock('@/components/research/BudgetMeter', () => ({
  BudgetMeter: () => null,
}))

vi.mock('@/components/research/TerminalMarkdown', () => ({
  TerminalMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

const expandedPromptPool = [
  'SHOULD I BUY PEPE?',
  'BTC PRICE PREDICTION',
  'SOL ECOSYSTEM HEALTH',
  'MEME COIN MOMENTUM',
  'ETH GAS TREND',
  'DOGE VS SHIB',
  'IS THIS ALT SZN?',
  'STABLECOIN RISK CHECK',
  'WHO LEADS L2 FLOW?',
  'CAN BASE KEEP RUNNING?',
  'WHAT ARE WHALES BUYING?',
  'WHICH NARRATIVE IS HOT?',
]

const shiftedPromptDeck = [...expandedPromptPool.slice(1), expandedPromptPool[0]]

function getQuickPromptLabels() {
  return screen
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((label) => expandedPromptPool.some((prompt) => label === `[${prompt}]`))
}

describe('ResearchPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigation.searchId = null
    agentLogHarness.onEvent = null
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/quota')) {
        return Response.json({
          wallet: { used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
          global: { used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
        })
      }
      return Response.json({})
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the daily quota panel on the create form', async () => {
    render(createElement(ResearchPageClient))

    expect(await screen.findByText('DAILY QUOTA')).toBeInTheDocument()
    expect(screen.getByText(/WALLET:/)).toHaveTextContent('4/10')
    expect(screen.getByText(/GLOBAL:/)).toHaveTextContent('67/100')
    expect(screen.getByText('Rate limits will be relaxed after mainnet launch.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /\[VIEW HISTORY\]/i })).toHaveAttribute('href', '/dashboard')
  })

  it('disables research creation when the wallet quota is exhausted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      wallet: { used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
    }))

    render(createElement(ResearchPageClient))

    await waitFor(() => expect(screen.getByRole('button', { name: /\[ QUOTA EXCEEDED \]/i })).toBeDisabled())
  })

  it('redirects to login when research creation returns unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/quota')) {
        return Response.json({
          wallet: { used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
          global: { used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
        })
      }
      if (url.includes('/api/research/start')) {
        return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))

    await waitFor(() => expect(navigation.routerReplace).toHaveBeenCalledWith('/login?redirect=%2Fresearch'))
    expect(screen.getByText(/\[ERR\] Authentication expired\. Please sign in again\./i)).toBeInTheDocument()
  })

  it('renders six quick prompts from the expanded randomized pool and rotates through the same deck until the user edits the topic', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await act(async () => {
      render(createElement(ResearchPageClient))
    })

    const topic = screen.getByLabelText('TOPIC')
    expect(getQuickPromptLabels()).toEqual(shiftedPromptDeck.slice(0, 6).map((prompt) => `[${prompt}]`))
    expect(topic).toHaveValue(shiftedPromptDeck[0])

    act(() => {
      vi.advanceTimersByTime(4500)
    })
    expect(topic).toHaveValue(shiftedPromptDeck[1])

    fireEvent.change(topic, { target: { value: 'CUSTOM MARKET QUESTION' } })

    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(topic).toHaveValue('CUSTOM MARKET QUESTION')
  })

  it('keeps the randomized quick prompt order stable within one mount and reshuffles on remount', async () => {
    const firstMountCalls = Array(expandedPromptPool.length - 1).fill(0.999)
    const secondMountCalls = Array(expandedPromptPool.length - 1).fill(0)
    const randomSpy = vi
      .spyOn(Math, 'random')
      .mockImplementation(() => firstMountCalls.shift() ?? secondMountCalls.shift() ?? 0)

    let unmount!: () => void
    await act(async () => {
      ;({ unmount } = render(createElement(ResearchPageClient)))
    })
    const firstMountPrompts = getQuickPromptLabels()

    fireEvent.change(screen.getByDisplayValue('0.0100'), { target: { value: '0.0200' } })
    expect(getQuickPromptLabels()).toEqual(firstMountPrompts)

    unmount()
    await act(async () => {
      render(createElement(ResearchPageClient))
    })

    expect(getQuickPromptLabels()).toEqual(expandedPromptPool.slice(1, 7).map((prompt) => `[${prompt}]`))
    expect(getQuickPromptLabels()).not.toEqual(firstMountPrompts)
  })

  it('keeps a clicked quick prompt selected after the rotation timer advances', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await act(async () => {
      render(createElement(ResearchPageClient))
    })

    const selectedPrompt = shiftedPromptDeck[2]
    fireEvent.click(screen.getByRole('button', { name: `[${selectedPrompt}]` }))

    const topic = screen.getByLabelText('TOPIC')
    expect(topic).toHaveValue(selectedPrompt)

    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(topic).toHaveValue(selectedPrompt)
  })

  it('restores the completed report when returning to an existing research session', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByTestId('agent-log-events')).toHaveTextContent('# Restored report')
    expect(screen.getByRole('button', { name: /\[VIEW FULL REPORT →\]/i })).toBeInTheDocument()
  })

  it('marks the UI cancelled locally and ignores late agent events after cancel succeeds', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/cancel') && init?.method === 'POST') {
        return Response.json({ researchId: 'research-1', status: 'cancelled' })
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0004',
            status: 'running',
            reportMd: null,
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: null,
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    const cancelButton = screen.getByRole('button', { name: /\[CANCEL\]/i })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/research/research-1/cancel', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    })))
    await waitFor(() => expect(screen.getByTestId('agent-log-events')).toHaveTextContent('Research cancelled'))
    expect(screen.getByRole('button', { name: /\[CANCEL\]/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /\[ASK FOLLOW-UP →\]/i })).not.toBeInTheDocument()

    act(() => {
      agentLogHarness.onEvent?.({
        type: 'thinking',
        text: 'Late answer should be ignored',
        receivedAt: '12:00:00',
      })
    })

    expect(screen.getByTestId('agent-log-events')).not.toHaveTextContent('Late answer should be ignored')
  })

  it('stops visible streaming immediately while the cancel request is still pending', async () => {
    navigation.searchId = 'research-1'
    let resolveCancel!: (response: Response) => void
    const pendingCancel = new Promise<Response>((resolve) => {
      resolveCancel = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/cancel') && init?.method === 'POST') {
        return pendingCancel
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0004',
            status: 'running',
            reportMd: null,
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: null,
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(screen.getByRole('button', { name: /\[CANCEL\]/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/research/research-1/cancel', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    })))
    expect(screen.getByTestId('agent-log-events')).toHaveTextContent('Research cancelled')

    act(() => {
      agentLogHarness.onEvent?.({
        type: 'thinking',
        text: 'Late stream text while cancel request is pending',
        receivedAt: '12:00:01',
      })
    })

    expect(screen.getByTestId('agent-log-events')).not.toHaveTextContent('Late stream text while cancel request is pending')

    resolveCancel(Response.json({ researchId: 'research-1', status: 'cancelled' }))
  })

  it('shows a live follow-up composer below the grid after the session completes', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByRole('button', { name: /\[ASK FOLLOW-UP →\]/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ask a follow-up about this report/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i })).toBeInTheDocument()
  })

  it('loads existing live follow-up history after the session completes', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups')) {
        return Response.json({
          followUps: [
            {
              id: 'fu-1',
              researchId: 'research-1',
              address: '0xabcdef000000000000000000000000000000c1d3',
              question: 'What would invalidate DOGE leadership?',
              answerMd: '## Follow-up Answer\nDOGE loses leadership if volume fades.',
              status: 'completed',
              spentUsdc: '0',
              errorMessage: null,
              createdAt: '2026-06-27T08:04:00.000Z',
              completedAt: '2026-06-27T08:04:08.000Z',
            },
          ],
        })
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByText('What would invalidate DOGE leadership?')).toBeInTheDocument()
    expect(screen.getByText(/doge loses leadership if volume fades\./i)).toBeInTheDocument()
  })

  it('submits a live follow-up, shows a pending state, and appends the returned answer', async () => {
    navigation.searchId = 'research-1'
    let resolveFollowUp!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups') && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveFollowUp = resolve
        })
      }
      if (url.includes('/api/research/research-1')) {
        return Promise.resolve(Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        }))
      }
      return Promise.resolve(Response.json({}))
    }))

    render(createElement(ResearchPageClient))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Does DOGE still lead after the sentiment shift?' } })
    fireEvent.click(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i }))

    expect(await screen.findByText(/generating follow-up answer/i)).toBeInTheDocument()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/research/research-1/follow-ups', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))

    resolveFollowUp(Response.json({
      followUp: {
        id: 'fu-2',
        researchId: 'research-1',
        address: '0xabcdef000000000000000000000000000000c1d3',
        question: 'Does DOGE still lead after the sentiment shift?',
        answerMd: '## Follow-up Answer\nDOGE still leads, but the gap is narrowing.',
        status: 'completed',
        spentUsdc: '0',
        errorMessage: null,
        createdAt: '2026-06-27T08:05:00.000Z',
        completedAt: '2026-06-27T08:05:08.000Z',
      },
    }))

    expect(await screen.findByText(/doge still leads, but the gap is narrowing\./i)).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('shows a returned live follow-up while the initial history request is still loading', async () => {
    navigation.searchId = 'research-1'
    let resolveHistory!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups') && init?.method === 'POST') {
        return Promise.resolve(Response.json({
          followUp: {
            id: 'fu-new',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Does DOGE still lead while history is slow?',
            answerMd: '## Follow-up Answer\nDOGE still leads while history is loading.',
            status: 'completed',
            spentUsdc: '0',
            errorMessage: null,
            createdAt: '2026-06-27T08:05:00.000Z',
            completedAt: '2026-06-27T08:05:08.000Z',
          },
        }))
      }
      if (url.includes('/api/research/research-1/follow-ups')) {
        return new Promise<Response>((resolve) => {
          resolveHistory = resolve
        })
      }
      if (url.includes('/api/research/research-1')) {
        return Promise.resolve(Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        }))
      }
      return Promise.resolve(Response.json({}))
    }))

    render(createElement(ResearchPageClient))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Does DOGE still lead while history is slow?' } })
    fireEvent.click(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i }))

    expect(await screen.findByText(/doge still leads while history is loading\./i)).toBeInTheDocument()

    await act(async () => {
      resolveHistory(Response.json({
        followUps: [
          {
            id: 'fu-old',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Earlier DOGE question',
            answerMd: 'Earlier answer.',
            status: 'completed',
            spentUsdc: '0',
            errorMessage: null,
            createdAt: '2026-06-27T08:00:00.000Z',
            completedAt: '2026-06-27T08:00:08.000Z',
          },
        ],
      }))
    })

    const earlierQuestion = await screen.findByText('Earlier DOGE question')
    const newQuestion = screen.getByText('Does DOGE still lead while history is slow?')
    expect(Boolean(earlierQuestion.compareDocumentPosition(newQuestion) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('appends a failed live follow-up card and shows an English error when generation fails', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups') && init?.method === 'POST') {
        return Response.json({
          error: 'FOLLOW_UP_FAILED',
          followUp: {
            id: 'fu-9',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Need one more DOGE invalidation check.',
            answerMd: null,
            status: 'failed',
            spentUsdc: '0',
            errorMessage: 'Follow-up answer generation failed',
            createdAt: '2026-06-27T08:06:00.000Z',
            completedAt: '2026-06-27T08:06:05.000Z',
          },
        }, { status: 502 })
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Need one more DOGE invalidation check.' } })
    fireEvent.click(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i }))

    expect(await screen.findByText(/the follow-up answer could not be generated\. please try again\./i)).toBeInTheDocument()
    expect(screen.getAllByText('Need one more DOGE invalidation check.').length).toBeGreaterThan(0)
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })
})
