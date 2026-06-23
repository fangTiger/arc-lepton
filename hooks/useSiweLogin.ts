'use client'

import { useCallback, useState } from 'react'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { APP_HOST, APP_URL, ARC_CHAIN_ID } from '@/lib/constants'
import { useInvalidateSession } from './useUser'

export function useSiweLogin() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnectAsync } = useDisconnect()
  const invalidate = useInvalidateSession()
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const login = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected')
    setError(null)
    setLoading(true)
    try {
      const nonceRes = await fetch('/api/auth/nonce')
      if (!nonceRes.ok) throw new Error('Failed to fetch nonce')
      const { nonce } = await nonceRes.json()

      const issuedAt = new Date().toISOString()
      const message = [
        `${APP_HOST} wants you to sign in with your Ethereum account:`,
        address,
        '',
        'Sign in to Arc Lepton.',
        '',
        `URI: ${APP_URL}`,
        `Version: 1`,
        `Chain ID: ${ARC_CHAIN_ID}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
      ].join('\n')

      const signature = await signMessageAsync({ message })

      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, signature, address }),
      })
      if (!verifyRes.ok) throw new Error('Login failed')

      await invalidate()
    } catch (e) {
      setError(e as Error)
      throw e
    } finally {
      setLoading(false)
    }
  }, [address, signMessageAsync, invalidate])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    await disconnectAsync()
    await invalidate()
  }, [disconnectAsync, invalidate])

  return { login, logout, isLoading, error }
}
