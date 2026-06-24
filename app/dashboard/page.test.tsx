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
    expect(screen.getByText('NO RESEARCH YET. CLICK [START NEW RESEARCH] ABOVE.')).toBeInTheDocument()
  })

  it('logs out and keeps start research on-page', async () => {
    render(createElement(DashboardPage))

    fireEvent.click(screen.getByRole('button', { name: /\[ ▸ START NEW RESEARCH \]/i }))
    expect(screen.getByText('[INFO] Research engine coming online. (Phase 2)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /\[ DISCONNECT \]/i }))
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1))
  })
})
