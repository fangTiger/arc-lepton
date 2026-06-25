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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.routerPush, replace: navigation.routerReplace }),
  useSearchParams: () => ({ get: (name: string) => (name === 'id' ? navigation.searchId : null) }),
}))

vi.mock('@/components/research/AgentLogStream', () => ({
  AgentLogStream: ({ events }: { events: Array<{ type: string; reportMd?: string }> }) => (
    <div data-testid="agent-log-events">{events.map((event) => event.reportMd ?? event.type).join('\n')}</div>
  ),
}))

vi.mock('@/components/research/TxFeed', () => ({
  TxFeed: () => null,
}))

vi.mock('@/components/research/BudgetMeter', () => ({
  BudgetMeter: () => null,
}))

describe('ResearchPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigation.searchId = null
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

  it('rotates default topics until the user edits the topic', async () => {
    vi.useFakeTimers()
    render(createElement(ResearchPageClient))

    const topic = screen.getByLabelText('TOPIC')
    expect(topic).toHaveValue('SHOULD I BUY PEPE?')

    act(() => {
      vi.advanceTimersByTime(4500)
    })
    expect(topic).toHaveValue('BTC PRICE PREDICTION')

    fireEvent.change(topic, { target: { value: 'CUSTOM MARKET QUESTION' } })

    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(topic).toHaveValue('CUSTOM MARKET QUESTION')
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
})
