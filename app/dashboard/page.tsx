'use client'

import { useMemo, useState } from 'react'
import { useAccount, useBalance, useChainId } from 'wagmi'
import { useSiweLogin } from '@/hooks/useSiweLogin'
import { useUser } from '@/hooks/useUser'
import { ARC_CHAIN_ID } from '@/lib/constants'

function shortAddress(address: string | null | undefined) {
  if (!address) return 'N/A'
  return `${address.slice(0, 6)}..${address.slice(-4)}`
}

function toWagmiAddress(value: string | null | undefined): `0x${string}` | undefined {
  return value?.startsWith('0x') ? (value as `0x${string}`) : undefined
}

function formatBalance(value: string | undefined) {
  const numeric = Number(value ?? 0)
  if (!Number.isFinite(numeric)) return '0.000 USDC'
  return `${numeric.toFixed(3)} USDC`
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3 font-mono text-xs leading-5">
      <span className="font-bold uppercase tracking-[0.05em] text-amber">{label}</span>
      <span className="min-w-0 break-all text-text-primary">{value}</span>
    </div>
  )
}

export default function DashboardPage() {
  const { address: walletAddress } = useAccount()
  const chainId = useChainId()
  const { address: sessionAddress } = useUser()
  const { logout } = useSiweLogin()
  const [info, setInfo] = useState<string | null>(null)
  const activeAddress = sessionAddress ?? walletAddress ?? null
  const balanceAddress = toWagmiAddress(activeAddress)

  const balance = useBalance({
    address: balanceAddress,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(balanceAddress && ARC_CHAIN_ID) },
  })

  const balanceText = useMemo(() => formatBalance(balance.data?.formatted), [balance.data?.formatted])
  const chainText = chainId === ARC_CHAIN_ID || !chainId ? 'ARC-TESTNET' : `WRONG NET (${chainId})`

  return (
    <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
      <section className="mx-auto flex min-h-[calc(100vh-96px)] w-full max-w-[1180px] flex-col justify-center gap-5">
        <div className="font-mono text-sm font-bold uppercase tracking-[0.05em] text-amber">&gt; AUTHENTICATED</div>

        <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <section className="border border-border bg-bg-panel">
            <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
              ACCOUNT
            </div>
            <div className="space-y-3 px-4 py-4">
              <FieldRow label="ADDR:" value={shortAddress(activeAddress)} />
              <FieldRow label="CHAIN:" value={chainText} />
              <FieldRow label="BALANCE:" value={balanceText} />
            </div>
            <div className="border-t border-border px-4 py-4">
              <button
                type="button"
                onClick={() => logout().catch(() => {})}
                className="terminal-button h-10 px-4 text-xs"
              >
                [ DISCONNECT ]
              </button>
            </div>
          </section>

          <section className="border border-border bg-bg-panel">
            <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
              RESEARCH ENGINE
            </div>
            <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
              <FieldRow label="STATUS:" value="▸ READY TO LAUNCH" />
              <FieldRow label="ENGINE:" value="v0.1.0" />
              <FieldRow label="AGENTS:" value="AVAILABLE: 5" />
            </div>
            <div className="border-t border-border px-4 py-4">
              <button
                type="button"
                onClick={() => setInfo('[INFO] Research engine coming online. (Phase 2)')}
                className="terminal-button h-10 px-4 text-xs"
              >
                [ ▸ START NEW RESEARCH ]
              </button>
              {info ? (
                <div className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-cyan">
                  {info}
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <section className="border border-border bg-bg-panel">
          <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
            RECENT RESEARCH
          </div>
          <div className="px-4 py-8 font-mono text-xs font-semibold uppercase tracking-[0.05em] text-text-secondary">
            NO RESEARCH YET. CLICK [START NEW RESEARCH] ABOVE.
          </div>
        </section>
      </section>
    </main>
  )
}
