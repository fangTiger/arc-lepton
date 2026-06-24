'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useBalance, useChainId } from 'wagmi'
import { useSiweLogin } from '@/hooks/useSiweLogin'
import { useUser } from '@/hooks/useUser'
import { ARC_CHAIN_ID } from '@/lib/constants'

type ConnectWalletButtonProps = {
  variant?: 'pill' | 'cta'
}

function WalletIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <circle cx="16" cy="14" r="1.5" fill="currentColor" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 8v4M12 16h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg className="h-2.5 w-2.5 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="14" x="8" y="8" rx="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function ExternalLinkIcon() {
  return (
    <svg className="h-4 w-4 text-text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="m15 3 6 6" />
      <path d="M10 14 21 3" />
      <path d="M15 3h6v6" />
    </svg>
  )
}

function DisconnectIcon() {
  return (
    <svg className="h-4 w-4 text-danger/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  )
}

function shortAddress(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function menuAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function formatBalance(value: string | undefined) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0.000'
  return numeric.toFixed(3)
}

function toWagmiAddress(value: string | undefined): `0x${string}` | undefined {
  return value?.startsWith('0x') ? (value as `0x${string}`) : undefined
}

export function ConnectWalletButton({ variant = 'pill' }: ConnectWalletButtonProps) {
  const { address: walletAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { isAuthed, address } = useUser()
  const { login, logout, isLoading } = useSiweLogin()
  const [isMenuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const connectedAddress = address ?? walletAddress
  const balanceAddress = toWagmiAddress(connectedAddress)
  const isCta = variant === 'cta'

  const balance = useBalance({
    address: balanceAddress,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(balanceAddress && ARC_CHAIN_ID && chainId === ARC_CHAIN_ID) },
  })

  const balanceText = useMemo(() => formatBalance(balance.data?.formatted), [balance.data?.formatted])

  useEffect(() => {
    if (isConnected && chainId === ARC_CHAIN_ID && !isAuthed && !isLoading) {
      login().catch(() => {})
    }
  }, [isConnected, chainId, isAuthed, isLoading, login])

  useEffect(() => {
    if (!isMenuOpen) return

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isMenuOpen])

  return (
    <ConnectButton.Custom>
      {({ openChainModal, openConnectModal, mounted }) => {
        if (!mounted) return null

        if (!isConnected) {
          return (
            <button
              onClick={openConnectModal}
              className={
                isCta
                  ? 'group inline-flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-arc px-6 text-[0.9375rem] font-medium text-white transition duration-200 hover:bg-arc-hover hover:shadow-arc-glow active:translate-y-px'
                  : 'inline-flex h-9 items-center gap-2 rounded-full bg-arc px-4 text-[0.8125rem] font-medium text-white transition duration-200 hover:bg-arc-hover hover:shadow-arc-glow active:translate-y-px'
              }
            >
              <WalletIcon className={isCta ? 'h-[18px] w-[18px]' : 'h-3.5 w-3.5'} />
              Connect Wallet
              {isCta ? <ArrowRightIcon /> : null}
            </button>
          )
        }

        if (isLoading) {
          return (
            <button
              disabled
              className={`${isCta ? 'h-12 w-full justify-center rounded-sm px-6 text-[0.9375rem]' : 'h-9 rounded-full px-4 text-[0.8125rem]'} inline-flex items-center gap-2 border border-white/10 bg-bg-elevated font-medium text-text-secondary`}
            >
              <span className="spinner" />
              Waiting for signature…
            </button>
          )
        }

        if (chainId !== ARC_CHAIN_ID) {
          return (
            <button
              onClick={openChainModal}
              className={`${isCta ? 'h-12 w-full justify-center rounded-sm px-6 text-[0.9375rem]' : 'h-9 rounded-full px-4 text-[0.8125rem]'} inline-flex items-center gap-2 border border-danger/30 bg-danger/10 font-medium text-danger transition duration-200 hover:bg-danger/15 hover:shadow-[0_0_16px_rgba(247,90,90,0.20)] active:translate-y-px`}
            >
              <WarningIcon />
              Wrong Network
              <ChevronDownIcon />
            </button>
          )
        }

        if (isAuthed && connectedAddress) {
          const explorerBase = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL?.replace(/\/$/, '')
          const explorerHref = explorerBase ? `${explorerBase}/address/${connectedAddress}` : undefined

          return (
            <div ref={rootRef} className="relative inline-flex">
              <div className="group inline-flex h-9 items-center gap-3 rounded-full border border-white/10 bg-bg-elevated py-1 pl-3 pr-1 text-text-primary transition duration-200 hover:border-white/15 hover:bg-bg-elevated hover:shadow-lg hover:shadow-black/40">
                <span className="border-r border-white/5 pr-2 font-mono text-xs tabular-nums text-text-secondary">
                  ${balanceText} USDC
                </span>
                <button
                  type="button"
                  onClick={() => setMenuOpen((open) => !open)}
                  className="inline-flex items-center gap-2 rounded-full bg-bg-base px-3 py-[5px] font-mono text-xs text-text-primary transition duration-200 hover:shadow-live-glow"
                  aria-expanded={isMenuOpen}
                  aria-haspopup="menu"
                >
                  <span className="live-dot" />
                  {shortAddress(connectedAddress)}
                  <ChevronDownIcon />
                </button>
              </div>

              {isMenuOpen ? (
                <div
                  className="float-in absolute right-0 top-12 z-50 w-[280px] overflow-hidden rounded-md border border-white/10 bg-bg-elevated shadow-[0_16px_64px_rgba(0,0,0,0.70),0_0_0_1px_rgba(255,255,255,0.16)]"
                  role="menu"
                >
                  <div className="border-b border-white/5 px-5 py-4">
                    <div className="mb-2 flex items-center gap-2 font-mono text-sm text-text-primary">
                      <span className="live-dot" />
                      {menuAddress(connectedAddress)}
                    </div>
                    <div className="font-mono text-[1.375rem] font-medium tabular-nums text-text-primary">
                      {balanceText}
                      <span className="ml-2 text-[0.8125rem] text-text-muted">USDC</span>
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-arc/25 bg-arc/10 px-3 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.04em] text-arc">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      ARC TESTNET
                    </div>
                  </div>
                  <div className="p-2">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(connectedAddress)}
                      className="flex w-full items-center gap-3 rounded-xs px-3 py-3 text-left text-sm text-text-primary transition hover:bg-bg-surface"
                      role="menuitem"
                    >
                      <CopyIcon />
                      Copy address
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (explorerHref) window.open(explorerHref, '_blank', 'noopener,noreferrer')
                      }}
                      className="flex w-full items-center gap-3 rounded-xs px-3 py-3 text-left text-sm text-text-primary transition hover:bg-bg-surface disabled:cursor-not-allowed disabled:text-text-disabled"
                      role="menuitem"
                      disabled={!explorerHref}
                    >
                      <ExternalLinkIcon />
                      View on Arc Explorer
                    </button>
                    <div className="my-1 h-px bg-white/5" />
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        logout().catch(() => {})
                      }}
                      className="flex w-full items-center gap-3 rounded-xs px-3 py-3 text-left text-sm text-danger transition hover:bg-danger/10"
                      role="menuitem"
                    >
                      <DisconnectIcon />
                      Disconnect
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        }

        return null
      }}
    </ConnectButton.Custom>
  )
}
