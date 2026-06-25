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

type SignatureToast = {
  message: string
  tone: 'warning' | 'error'
}

const ACCOUNT_MENU_HEIGHT = 260
const BOTTOM_BAR_SAFE_SPACE = 40

function shortAddress(address: string) {
  return `${address.slice(0, 4)}..${address.slice(-4)}`
}

function menuAddress(address: string) {
  return `${address.slice(0, 6)}..${address.slice(-4)}`
}

function formatBalance(value: string | undefined) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0.000'
  return numeric.toFixed(3)
}

function toWagmiAddress(value: string | undefined): `0x${string}` | undefined {
  return value?.startsWith('0x') ? (value as `0x${string}`) : undefined
}

function signatureErrorMessage(error: unknown): SignatureToast {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (message.includes('reject') || message.includes('cancel') || message.includes('denied')) {
    return { message: '[WARN] Signature cancelled', tone: 'warning' }
  }
  return { message: '[ERR] Login failed. Please try again.', tone: 'error' }
}

export function ConnectWalletButton({ variant = 'pill' }: ConnectWalletButtonProps) {
  const { address: walletAddress, isConnected } = useAccount()
  const chainId = useChainId()
  const { isAuthed, address } = useUser()
  const { login, logout, preloadNonce, isLoading } = useSiweLogin()
  const [isMenuOpen, setMenuOpen] = useState(false)
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down')
  const [signatureToast, setSignatureToast] = useState<SignatureToast | null>(null)
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
    if (!isConnected || isAuthed) setSignatureToast(null)
  }, [isConnected, isAuthed])

  useEffect(() => {
    if (signatureToast?.tone !== 'error') return

    const timer = window.setTimeout(() => setSignatureToast(null), 5000)
    return () => window.clearTimeout(timer)
  }, [signatureToast])

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

  async function handleSignIn() {
    setSignatureToast(null)
    try {
      await login()
    } catch (error) {
      setSignatureToast(signatureErrorMessage(error))
    }
  }

  function warmAuthNonce() {
    preloadNonce().catch(() => {})
  }

  function toggleAccountMenu() {
    if (isMenuOpen) {
      setMenuOpen(false)
      return
    }

    const rect = rootRef.current?.getBoundingClientRect()
    const spaceBelow = window.innerHeight - (rect?.bottom ?? 0) - BOTTOM_BAR_SAFE_SPACE
    setMenuPlacement(spaceBelow < ACCOUNT_MENU_HEIGHT ? 'up' : 'down')
    setMenuOpen(true)
  }

  const sizeClass = isCta ? 'h-12 w-full px-4 text-sm' : 'h-9 px-3 text-xs'
  const terminalButtonClass = `${sizeClass} inline-flex items-center justify-center border font-mono font-semibold uppercase tracking-[0.05em] transition-colors duration-100 disabled:cursor-wait`

  return (
    <ConnectButton.Custom>
      {({ openChainModal, openConnectModal, mounted }) => {
        if (!mounted) return null

        const toast = signatureToast ? (
          <div
            role="alert"
            className={`fixed right-3 top-9 z-[90] border bg-bg-base px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.05em] md:right-5 ${
              signatureToast.tone === 'warning' ? 'border-amber text-amber' : 'border-red text-red'
            }`}
          >
            {signatureToast.message}
          </div>
        ) : null

        if (!isConnected) {
          return (
            <>
              {toast}
              <button
                onClick={openConnectModal}
                className={`${terminalButtonClass} border-amber bg-bg-base text-amber hover:bg-amber hover:text-bg-base`}
              >
                [CONNECT WALLET]
              </button>
            </>
          )
        }

        if (chainId !== ARC_CHAIN_ID) {
          return (
            <>
              {toast}
              <button
                onClick={openChainModal}
                className={`${terminalButtonClass} border-red bg-bg-base text-red hover:bg-red hover:text-bg-base`}
              >
                [!! WRONG NET]
              </button>
            </>
          )
        }

        if (isLoading) {
          return (
            <>
              {toast}
              <button
                disabled
                className={`${terminalButtonClass} blink border-amber bg-bg-base text-amber`}
              >
                [CONNECTING...]
              </button>
            </>
          )
        }

        if (!isAuthed) {
          return (
            <>
              {toast}
              <button
                type="button"
                onFocus={warmAuthNonce}
                onPointerDown={warmAuthNonce}
                onClick={handleSignIn}
                className={`${terminalButtonClass} blink border-amber bg-amber text-bg-base hover:bg-bg-base hover:text-amber`}
              >
                {isCta ? '[▸ SIGN TO LOG IN]' : '[▸ SIGN IN]'}
              </button>
            </>
          )
        }

        if (connectedAddress) {
          const explorerBase = process.env.NEXT_PUBLIC_ARC_EXPLORER_URL?.replace(/\/$/, '')
          const explorerHref = explorerBase ? `${explorerBase}/address/${connectedAddress}` : undefined

          return (
            <>
              {toast}
              <div ref={rootRef} className="relative inline-flex">
                <button
                  type="button"
                  onClick={toggleAccountMenu}
                  className={`${terminalButtonClass} border-border bg-bg-panel text-text-primary hover:border-amber hover:text-amber`}
                  aria-expanded={isMenuOpen}
                  aria-haspopup="menu"
                >
                  <span className="live-dot" />
                  <span>{shortAddress(connectedAddress)}</span>
                  <span className="text-text-muted">|</span>
                  <span>${balanceText}</span>
                </button>

                {isMenuOpen ? (
                  <div
                    className={`absolute right-0 z-[120] w-[280px] border border-border bg-bg-panel font-mono text-xs uppercase tracking-[0.05em] text-text-primary ${
                      menuPlacement === 'up' ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]'
                    }`}
                    role="menu"
                  >
                    <div className="border-b border-border px-3 py-3">
                      <div className="flex items-center gap-2 text-cyan">
                        <span className="live-dot" />
                        <span>AUTHED</span>
                      </div>
                      <div className="mt-2 text-text-primary">{menuAddress(connectedAddress)}</div>
                      <div className="mt-1 text-lg tabular-nums text-amber">
                        {balanceText}
                        <span className="ml-2 text-[11px] text-text-muted">USDC</span>
                      </div>
                      <div className="mt-2 text-[11px] text-text-secondary">ARC-TESTNET</div>
                    </div>
                    <div className="p-1">
                      <button
                        type="button"
                        onClick={() => navigator.clipboard?.writeText(connectedAddress)}
                        className="block w-full border border-transparent px-3 py-2 text-left text-text-primary hover:border-amber hover:bg-amber hover:text-bg-base"
                        role="menuitem"
                      >
                        COPY ADDRESS
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (explorerHref) window.open(explorerHref, '_blank', 'noopener,noreferrer')
                        }}
                        className="block w-full border border-transparent px-3 py-2 text-left text-text-primary hover:border-amber hover:bg-amber hover:text-bg-base disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:border-transparent disabled:hover:bg-transparent"
                        role="menuitem"
                        disabled={!explorerHref}
                      >
                        ARC EXPLORER
                      </button>
                      <div className="my-1 border-t border-border" />
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false)
                          logout().catch(() => {})
                        }}
                        className="block w-full border border-transparent px-3 py-2 text-left text-red hover:border-red hover:bg-red hover:text-bg-base"
                        role="menuitem"
                      >
                        DISCONNECT
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )
        }

        return null
      }}
    </ConnectButton.Custom>
  )
}
