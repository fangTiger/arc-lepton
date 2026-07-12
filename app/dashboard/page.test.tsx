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
              topic: 'SHOULD I BUY PEPE?',
              budgetUsdc: '0.01',
              budgetUnits: '10000',
              spentUsdc: '0.0012',
              status: 'completed',
              activationPhase: 'active',
              finalizationState: 'closed',
              quotaReservationState: 'consumed',
              prepareRequestId: null,
              buyer: mocks.userAddress.toLowerCase(),
              researchKey: null,
              expectedEscrowAddress: null,
              escrowAddress: null,
              reportMd: '# Report',
              errorMessage: null,
              createdAt: '2026-06-25T00:00:00.000Z',
              preparedAt: null,
              fundingExpiresAt: null,
              expectedExpiresAt: null,
              fundingDeadline: null,
              intentSigner: null,
              voucherNonce: null,
              quotaDate: '2026-06-25',
              cancelRequestedAt: null,
              chainId: 5_042_002,
              startedAt: '2026-06-25T00:00:00.000Z',
              completedAt: '2026-06-25T00:00:18.000Z',
            },
            {
              id: 'funding-expired-0000-0000-0000-000000000000',
              address: mocks.userAddress.toLowerCase(),
              topic: 'EXPIRED ESCROW FUNDING',
              budgetUsdc: '1.00',
              budgetUnits: '1000000',
              spentUsdc: '0',
              status: 'funding_expired',
              activationPhase: 'expired',
              finalizationState: 'none',
              quotaReservationState: 'released',
              prepareRequestId: 'idem-expired',
              buyer: mocks.userAddress.toLowerCase(),
              researchKey: `0x${'aa'.repeat(32)}`,
              expectedEscrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
              escrowAddress: null,
              reportMd: null,
              errorMessage: null,
              createdAt: '2026-06-25T01:00:00.000Z',
              preparedAt: '2026-06-25T01:00:00.000Z',
              fundingExpiresAt: '2026-06-25T01:15:00.000Z',
              expectedExpiresAt: '2026-06-26T01:00:00.000Z',
              fundingDeadline: '2026-06-25T01:15:00.000Z',
              intentSigner: '0x5555555555555555555555555555555555555555',
              voucherNonce: '8',
              quotaDate: '2026-06-25',
              cancelRequestedAt: null,
              chainId: 5_042_002,
              startedAt: null,
              completedAt: null,
            },
            {
              id: 'cancelled-0000-0000-0000-000000000000',
              address: mocks.userAddress.toLowerCase(),
              topic: 'CANCELLED BEFORE ACTIVATION',
              budgetUsdc: '1.00',
              budgetUnits: '1000000',
              spentUsdc: '0',
              status: 'cancelled',
              activationPhase: 'cancelled',
              finalizationState: 'closed',
              quotaReservationState: 'released',
              prepareRequestId: 'idem-cancelled',
              buyer: mocks.userAddress.toLowerCase(),
              researchKey: `0x${'bb'.repeat(32)}`,
              expectedEscrowAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
              escrowAddress: '0xdddddddddddddddddddddddddddddddddddddddd',
              reportMd: null,
              errorMessage: 'Research cancelled',
              createdAt: '2026-06-25T02:00:00.000Z',
              preparedAt: '2026-06-25T02:00:00.000Z',
              fundingExpiresAt: '2026-06-25T02:15:00.000Z',
              expectedExpiresAt: '2026-06-26T02:00:00.000Z',
              fundingDeadline: '2026-06-25T02:15:00.000Z',
              intentSigner: '0x5555555555555555555555555555555555555555',
              voucherNonce: '9',
              quotaDate: '2026-06-25',
              cancelRequestedAt: '2026-06-25T02:08:00.000Z',
              chainId: 5_042_002,
              startedAt: null,
              completedAt: '2026-06-25T02:08:00.000Z',
            },
          ],
        })
      }
      if (url.includes('/api/quota')) {
        return Response.json({
          wallet: { consumed: 3, reserved: 1, used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
          global: { consumed: 60, reserved: 7, used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
          backend: 'postgres',
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

    expect(await screen.findByText('SHOULD I BUY PEPE?')).toBeInTheDocument()
    expect(screen.getByText('0.0012 USDC')).toBeInTheDocument()
    expect(screen.getByText('● DONE')).toBeInTheDocument()
    expect(screen.getByText('DAILY QUOTA')).toBeInTheDocument()
    expect(screen.getByText('4/10')).toBeInTheDocument()
    expect(screen.getByText('67/100')).toBeInTheDocument()
    expect(screen.getByText('CONSUMED 3')).toBeInTheDocument()
    expect(screen.getByText('RESERVED 1')).toBeInTheDocument()
    expect(screen.getByText('REMAINING 6')).toBeInTheDocument()
    expect(screen.getByText('CONSUMED 60')).toBeInTheDocument()
    expect(screen.getByText('RESERVED 7')).toBeInTheDocument()
    expect(screen.getByText('BACKEND postgres')).toBeInTheDocument()
    expect(screen.getByText('EXPIRED ESCROW FUNDING')).toBeInTheDocument()
    expect(screen.getByText('FUNDING EXPIRED')).toBeInTheDocument()
    expect(screen.getAllByText('RELEASED')).toHaveLength(2)
    expect(screen.getByText('CANCELLED BEFORE ACTIVATION')).toBeInTheDocument()
    expect(screen.getByText('CANCEL')).toBeInTheDocument()
  })

  it('logs out', async () => {
    render(createElement(DashboardPage))

    await screen.findByText('SHOULD I BUY PEPE?')
    fireEvent.click(screen.getByRole('button', { name: /\[DISCONNECT\]/i }))
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1))
  })
})
