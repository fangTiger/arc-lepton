import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('shows real active agent stats instead of a fixed execution load', async () => {
    render(createElement(HomePage))

    await waitFor(() => expect(screen.getByText('ACTIVE AGENTS')).toBeInTheDocument())
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.queryByText('EXECUTION LOAD')).not.toBeInTheDocument()
    expect(screen.queryByText(/73%/)).not.toBeInTheDocument()
  })
})
