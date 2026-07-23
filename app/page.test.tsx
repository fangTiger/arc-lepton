import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from './page'

const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('@/components/auth/ConnectWalletButton', () => ({
  ConnectWalletButton: () => <button type="button">[CONNECT WALLET]</button>,
}))

vi.mock('@/components/auth/NetworkGuard', () => ({
  NetworkGuard: () => null,
}))

vi.mock('@/components/Logo', () => ({
  Logo: () => <div>SIGNAL/LEDGER</div>,
}))

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      totalResearches: 12,
      totalCallsAcrossAllUsers: 47,
      totalUsdcSpent: '0.0156',
      activeAgents: 3,
      dailyResearchQuota: {
        used: 67,
        limit: 100,
        remaining: 33,
        resetAt: '2026-06-26T00:00:00.000Z',
      },
    })))
  })

  it('does not show a docs link when no docs page exists', () => {
    render(createElement(HomePage))

    expect(screen.queryByRole('link', { name: '[VIEW DOCS]' })).not.toBeInTheDocument()
  })

  it('hides public aggregate stats from the home page', () => {
    render(createElement(HomePage))

    expect(screen.queryByText('LIVE DATA PANEL')).not.toBeInTheDocument()
    expect(screen.queryByText('ACTIVE AGENTS')).not.toBeInTheDocument()
    expect(screen.queryByText('RESEARCHES DONE')).not.toBeInTheDocument()
    expect(screen.queryByText('TOTAL USDC SPENT')).not.toBeInTheDocument()
    expect(screen.queryByText('TOTAL CALLS')).not.toBeInTheDocument()
    expect(screen.queryByText('TODAY QUOTA')).not.toBeInTheDocument()
    expect(screen.queryByText('$0.0156')).not.toBeInTheDocument()
    expect(screen.queryByText('67/100 RESEARCHES USED TODAY')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })
})
