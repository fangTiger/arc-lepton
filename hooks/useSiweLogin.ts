'use client'

import { useCallback, useRef, useState } from 'react'
import { useAccount, useDisconnect, useSignMessage } from 'wagmi'
import { SIWE_STATEMENT } from '@/lib/brand'
import { APP_HOST, APP_URL, ARC_CHAIN_ID } from '@/lib/constants'
import { useInvalidateSession } from './useUser'

const PRELOADED_NONCE_MAX_AGE_MS = 4 * 60 * 1000

type PreloadedNonce = {
  nonce: string
  fetchedAt: number
}

export function useSiweLogin() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const { disconnectAsync } = useDisconnect()
  const invalidate = useInvalidateSession()
  const [isLoading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const noncePromiseRef = useRef<Promise<PreloadedNonce> | null>(null)

  const fetchNonce = useCallback(async (): Promise<PreloadedNonce> => {
    const nonceRes = await fetch('/api/auth/nonce', { cache: 'no-store' })
    if (!nonceRes.ok) throw new Error('Failed to fetch nonce')
    const { nonce } = await nonceRes.json()
    return { nonce, fetchedAt: Date.now() }
  }, [])

  const preloadNonce = useCallback(() => {
    noncePromiseRef.current ??= fetchNonce().catch((e) => {
      noncePromiseRef.current = null
      throw e
    })
    return noncePromiseRef.current.then(() => undefined)
  }, [fetchNonce])

  const takeNonce = useCallback(async () => {
    const preloaded = noncePromiseRef.current
    noncePromiseRef.current = null

    if (preloaded) {
      const value = await preloaded
      if (Date.now() - value.fetchedAt <= PRELOADED_NONCE_MAX_AGE_MS) {
        return value.nonce
      }
    }

    return (await fetchNonce()).nonce
  }, [fetchNonce])

  const login = useCallback(async () => {
    if (!address) throw new Error('Wallet not connected')
    setError(null)
    setLoading(true)
    try {
      const nonce = await takeNonce()

      const issuedAt = new Date().toISOString()
      const message = [
        `${APP_HOST} wants you to sign in with your Ethereum account:`,
        address,
        '',
        SIWE_STATEMENT,
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
  }, [address, signMessageAsync, invalidate, takeNonce])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    await disconnectAsync()
    await invalidate()
  }, [disconnectAsync, invalidate])

  return { login, logout, preloadNonce, isLoading, error }
}
