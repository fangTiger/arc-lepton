import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchPageClient } from './ResearchPageClient'

const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/components/research/AgentLogStream', () => ({
  AgentLogStream: () => null,
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

  it('renders the daily quota panel on the create form', async () => {
    render(createElement(ResearchPageClient))

    expect(await screen.findByText('DAILY QUOTA')).toBeInTheDocument()
    expect(screen.getByText(/WALLET:/)).toHaveTextContent('4/10')
    expect(screen.getByText(/GLOBAL:/)).toHaveTextContent('67/100')
    expect(screen.getByText('Rate limits will be relaxed after mainnet launch.')).toBeInTheDocument()
  })

  it('disables research creation when the wallet quota is exhausted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      wallet: { used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
    }))

    render(createElement(ResearchPageClient))

    await waitFor(() => expect(screen.getByRole('button', { name: /\[ QUOTA EXCEEDED \]/i })).toBeDisabled())
  })
})
