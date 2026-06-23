'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect } from 'react'
import { useAccount, useChainId } from 'wagmi'
import { useSiweLogin } from '@/hooks/useSiweLogin'
import { useUser } from '@/hooks/useUser'
import { ARC_CHAIN_ID } from '@/lib/constants'

export function ConnectWalletButton() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { isAuthed, address } = useUser()
  const { login, logout, isLoading } = useSiweLogin()

  useEffect(() => {
    if (isConnected && chainId === ARC_CHAIN_ID && !isAuthed && !isLoading) {
      login().catch(() => {})
    }
  }, [isConnected, chainId, isAuthed, isLoading, login])

  return (
    <ConnectButton.Custom>
      {({ openConnectModal, mounted }) => {
        if (!mounted) return null

        if (!isConnected) {
          return (
            <button
              onClick={openConnectModal}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-arc px-4 text-sm font-medium text-white transition hover:bg-arc-hover"
            >
              Connect Wallet
            </button>
          )
        }

        if (isLoading) {
          return (
            <button
              disabled
              className="inline-flex h-9 items-center gap-2 rounded-full border border-white/10 bg-bg-elevated px-4 text-sm text-white/60"
            >
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-current" />
              Waiting for signature...
            </button>
          )
        }

        if (chainId !== ARC_CHAIN_ID) {
          return (
            <button
              onClick={openConnectModal}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-danger/30 bg-danger/10 px-4 text-sm font-medium text-danger"
            >
              Wrong Network
            </button>
          )
        }

        if (isAuthed && address) {
          const short = `${address.slice(0, 6)}...${address.slice(-4)}`
          return (
            <button
              onClick={logout}
              className="inline-flex h-9 items-center gap-3 rounded-full border border-white/10 bg-bg-elevated py-1 pl-3 pr-1 text-sm"
            >
              <span className="font-mono text-xs text-white/60">$0.000 USDC</span>
              <span className="inline-flex items-center gap-2 rounded-full bg-bg-base px-3 py-1 font-mono text-xs text-white">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-live"
                  style={{ boxShadow: '0 0 8px rgba(0,217,255,0.5)' }}
                />
                {short}
              </span>
            </button>
          )
        }

        return null
      }}
    </ConnectButton.Custom>
  )
}
