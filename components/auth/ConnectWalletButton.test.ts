import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectWalletButton } from './ConnectWalletButton'

const mocks = vi.hoisted(() => ({
  openChainModal: vi.fn(),
  openConnectModal: vi.fn(),
  login: vi.fn(),
  preloadNonce: vi.fn(),
  logout: vi.fn(),
  account: {
    address: '0xAbCdEf000000000000000000000000000000C1d3',
    isConnected: true,
  },
  chainId: 0,
  isAuthed: false,
  userAddress: null as string | null,
  isLoading: false,
  balance: '5.234',
}))

vi.mock('@rainbow-me/rainbowkit', () => ({
  ConnectButton: {
    Custom: ({ children }: { children: (props: unknown) => ReactNode }) =>
      children({ mounted: true, openChainModal: mocks.openChainModal, openConnectModal: mocks.openConnectModal }),
  },
}))

vi.mock('wagmi', () => ({
  useAccount: () => mocks.account,
  useBalance: () => ({ data: { formatted: mocks.balance } }),
  useChainId: () => mocks.chainId,
}))

vi.mock('@/hooks/useSiweLogin', () => ({
  useSiweLogin: () => ({
    login: mocks.login,
    preloadNonce: mocks.preloadNonce,
    logout: mocks.logout,
    isLoading: mocks.isLoading,
    error: null,
  }),
}))

vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({
    address: mocks.userAddress,
    isAuthed: mocks.isAuthed,
    isLoading: false,
  }),
}))

describe('ConnectWalletButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.login.mockResolvedValue(undefined)
    mocks.preloadNonce.mockResolvedValue(undefined)
    mocks.account = {
      address: '0xAbCdEf000000000000000000000000000000C1d3',
      isConnected: true,
    }
    mocks.chainId = 0
    mocks.isAuthed = false
    mocks.userAddress = null
    mocks.isLoading = false
    mocks.balance = '5.234'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not trigger SIWE login automatically after wallet connects', async () => {
    render(createElement(ConnectWalletButton))

    expect(screen.getByRole('button', { name: /SIGN/i })).toBeEnabled()
    await Promise.resolve()
    expect(mocks.login).not.toHaveBeenCalled()
  })

  it('keeps manual sign state and shows an amber warning toast after signature cancellation', async () => {
    mocks.login.mockRejectedValueOnce(new Error('User rejected the request'))
    render(createElement(ConnectWalletButton))

    fireEvent.click(screen.getByRole('button', { name: /SIGN/i }))

    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(1))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('[WARN] Signature cancelled')
    expect(alert).toHaveClass('border-amber')
    expect(screen.getByRole('button', { name: /SIGN/i })).toBeEnabled()

    await Promise.resolve()
    expect(mocks.login).toHaveBeenCalledTimes(1)
  })

  it('shows a red retry toast for system login errors and clears it after 5 seconds', async () => {
    vi.useFakeTimers()
    mocks.login.mockRejectedValueOnce(new Error('Login failed'))
    render(createElement(ConnectWalletButton))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /SIGN/i }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.login).toHaveBeenCalledTimes(1)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('[ERR] Login failed. 请再试一次')
    expect(alert).toHaveClass('border-red')

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
