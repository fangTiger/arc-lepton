import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DashboardPage from './page'

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  account: {
    address: '0xAbCdEf000000000000000000000000000000C1d3',
    isConnected: true,
  },
  userAddress: '0xAbCdEf000000000000000000000000000000C1d3',
  balance: '5.235',
  chainId: 5042002,
}))

vi.mock('@/lib/constants', () => ({
  ARC_CHAIN_ID: 5042002,
}))

vi.mock('wagmi', () => ({
  useAccount: () => mocks.account,
  useBalance: () => ({ data: { formatted: mocks.balance } }),
  useChainId: () => mocks.chainId,
}))

vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({
    address: mocks.userAddress,
    isAuthed: Boolean(mocks.userAddress),
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useSiweLogin', () => ({
  useSiweLogin: () => ({
    logout: mocks.logout,
    login: vi.fn(),
    isLoading: false,
    error: null,
  }),
}))

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/wallet/stats')) {
        return Response.json({ totalSpentUsdc: '0.0012', totalCalls: 5, lastResearchAt: '2026-06-25T00:00:18.000Z' })
      }
      if (url.includes('/api/research')) {
        return Response.json({
          researches: [
            {
              id: 'ab12c3d4-0000-0000-0000-000000000000',
              address: mocks.userAddress.toLowerCase(),
              topic: 'PEPE 现在能进吗',
              budgetUsdc: '0.01',
              spentUsdc: '0.0012',
              status: 'completed',
              reportMd: '# Report',
              errorMessage: null,
              startedAt: '2026-06-25T00:00:00.000Z',
              completedAt: '2026-06-25T00:00:18.000Z',
            },
          ],
        })
      }
      if (url.includes('/api/quota')) {
        return Response.json({
          wallet: { used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
          global: { used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
        })
      }
      return Response.json({})
    }))
    mocks.logout.mockResolvedValue(undefined)
    mocks.account = {
      address: '0xAbCdEf000000000000000000000000000000C1d3',
      isConnected: true,
    }
    mocks.userAddress = '0xAbCdEf000000000000000000000000000000C1d3'
    mocks.balance = '5.235'
    mocks.chainId = 5042002
  })

  it('renders authenticated account and research terminal panels', () => {
    render(createElement(DashboardPage))

    expect(screen.getByText('> AUTHENTICATED')).toBeInTheDocument()
    expect(screen.getByText('0xAbCd..C1d3')).toBeInTheDocument()
    expect(screen.getByText('ARC-TESTNET')).toBeInTheDocument()
    expect(screen.getByText('5.235 USDC')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /\[▸ START NEW RESEARCH →\]/i })).toHaveAttribute('href', '/research')
  })

  it('loads stats and research history', async () => {
    render(createElement(DashboardPage))

    expect(await screen.findByText('PEPE 现在能进吗')).toBeInTheDocument()
    expect(screen.getByText('0.0012 USDC')).toBeInTheDocument()
    expect(screen.getByText('● DONE')).toBeInTheDocument()
    expect(screen.getByText('DAILY QUOTA')).toBeInTheDocument()
    expect(screen.getByText('4/10')).toBeInTheDocument()
    expect(screen.getByText('67/100')).toBeInTheDocument()
  })

  it('logs out', async () => {
    render(createElement(DashboardPage))

    await screen.findByText('PEPE 现在能进吗')
    fireEvent.click(screen.getByRole('button', { name: /\[DISCONNECT\]/i }))
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1))
  })
})
