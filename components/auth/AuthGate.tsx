'use client'

import { ConnectWalletButton } from './ConnectWalletButton'
import { useUser } from '@/hooks/useUser'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthed, isLoading } = useUser()

  if (isLoading) return null
  if (isAuthed) return <>{children}</>

  return (
    <div className="flex justify-center p-4 md:p-8">
      <div className="w-full max-w-md border border-border bg-bg-panel">
        <div className="border-b border-border px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
          [AUTH REQUIRED]
        </div>
        <div className="p-4 text-center">
          <h3 className="text-sm font-bold uppercase tracking-[0.05em] text-text-primary">LOGIN REQUIRED</h3>
          <p className="mt-3 text-xs uppercase tracking-[0.05em] text-text-secondary">
            CONNECT WALLET TO UNLOCK RESEARCH HISTORY, AGENT CONFIG, AND USDC BALANCE.
          </p>
          <div className="mt-5 flex justify-center">
            <ConnectWalletButton />
          </div>
        </div>
      </div>
    </div>
  )
}
