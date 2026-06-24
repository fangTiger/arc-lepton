'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAccount } from 'wagmi'
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'
import { Logo } from '@/components/Logo'
import { useUser } from '@/hooks/useUser'

function authAddress(address: string | undefined) {
  if (!address) return 'N/A'
  return `${address.slice(0, 6)}..${address.slice(-4)}`
}

function LoginContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { address, isConnected } = useAccount()
  const { isAuthed } = useUser()

  useEffect(() => {
    if (isAuthed) {
      const redirect = params.get('redirect') ?? '/dashboard'
      router.replace(redirect)
    }
  }, [isAuthed, router, params])

  return (
    <main className="min-h-screen bg-bg-base pt-8 pb-8 text-text-primary">
      <NetworkGuard />

      <section className="flex min-h-[calc(100vh-64px)] items-center justify-center px-3 py-8">
        <div className="w-full max-w-[560px] border border-border bg-bg-panel">
          <div className="flex items-center justify-between border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
            <span>AUTHENTICATE</span>
            <Logo compact />
          </div>

          <div className="divide-y divide-border">
            <div className="grid gap-3 px-4 py-4 md:grid-cols-[160px_1fr] md:items-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-amber">&gt; CONNECT WALLET</div>
              <div>{isConnected ? <span className="text-green">STATUS: CONNECTED</span> : <ConnectWalletButton variant="cta" />}</div>
            </div>

            <div className="grid gap-3 px-4 py-4 md:grid-cols-[160px_1fr] md:items-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-amber">STATUS</div>
              <div className="font-mono text-xs uppercase tracking-[0.05em] text-text-secondary">
                {isConnected ? (
                  <>
                    CONNECTED <span className="text-text-muted">|</span>{' '}
                    <span className="text-text-primary">{authAddress(address)}</span>
                  </>
                ) : (
                  'DISCONNECTED'
                )}
              </div>
            </div>

            <div className="grid gap-3 px-4 py-4 md:grid-cols-[160px_1fr] md:items-center">
              <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-amber">&gt; SIGN MESSAGE</div>
              <div>
                {isConnected ? (
                  <ConnectWalletButton variant="cta" />
                ) : (
                  <button disabled className="h-12 w-full border border-text-disabled px-4 text-sm font-bold uppercase tracking-[0.05em] text-text-disabled">
                    [WAITING FOR WALLET]
                  </button>
                )}
              </div>
            </div>

            <div className="px-4 py-4 font-mono text-[11px] uppercase tracking-[0.05em] text-text-secondary">
              <div className="text-amber">SESSION ROUTE</div>
              <div className="mt-2">&gt; VERIFY MESSAGE</div>
              <div>&gt; SET ARC_SESSION COOKIE</div>
              <div>&gt; REDIRECT: {params.get('redirect') ?? '/dashboard'}</div>
              <div className="mt-2 text-cyan">READY_</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  )
}
