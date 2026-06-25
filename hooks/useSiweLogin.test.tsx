import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSiweLogin } from './useSiweLogin'

const mocks = vi.hoisted(() => ({
  address: '0xAbCdEf000000000000000000000000000000C1d3',
  signMessageAsync: vi.fn(),
  disconnectAsync: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: mocks.address }),
  useDisconnect: () => ({ disconnectAsync: mocks.disconnectAsync }),
  useSignMessage: () => ({ signMessageAsync: mocks.signMessageAsync }),
}))

vi.mock('./useUser', () => ({
  useInvalidateSession: () => mocks.invalidate,
}))

describe('useSiweLogin', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.signMessageAsync.mockResolvedValue('0xabc123')
    mocks.disconnectAsync.mockResolvedValue(undefined)
    mocks.invalidate.mockResolvedValue(undefined)
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('preloads a nonce and reuses it for the next login attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ nonce: 'PreheatedNonce01' }))
      .mockResolvedValueOnce(Response.json({ user: { address: mocks.address.toLowerCase() } }))
    global.fetch = fetchMock as typeof fetch

    const { result } = renderHook(() => useSiweLogin())

    act(() => {
      result.current.preloadNonce()
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/nonce', { cache: 'no-store' }))

    await act(async () => {
      await result.current.login()
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/verify')
    expect(mocks.signMessageAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('Nonce: PreheatedNonce01'),
    })
    expect(mocks.signMessageAsync).toHaveBeenCalledWith({
      message: expect.stringContaining('Sign in to SIGNAL/LEDGER.'),
    })
  })
})
