'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAccount, useBalance, useChainId } from 'wagmi'
import { useSiweLogin } from '@/hooks/useSiweLogin'
import { useUser } from '@/hooks/useUser'
import { ARC_CHAIN_ID } from '@/lib/constants'
import type { ResearchRecord } from '@/components/research/types'
import { shortId } from '@/components/research/types'

type WalletStats = {
  totalSpentUsdc: string
  totalCalls: number
  lastResearchAt: string | null
}

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
    <div className="grid grid-cols-[84px_1fr] gap-3 font-mono text-xs leading-5">
      <span className="font-bold uppercase tracking-[0.05em] text-amber">{label}</span>
      <span className="min-w-0 break-all text-text-primary">{value}</span>
    </div>
  )
}

function statusLabel(status: ResearchRecord['status']) {
  if (status === 'completed') return '● DONE'
  if (status === 'running') return 'RUNNING'
  if (status === 'cancelled') return 'CANCEL'
  return 'FAILED'
}

export default function DashboardPage() {
  const { address: walletAddress } = useAccount()
  const chainId = useChainId()
  const { address: sessionAddress } = useUser()
  const { logout } = useSiweLogin()
  const [stats, setStats] = useState<WalletStats | null>(null)
  const [researches, setResearches] = useState<ResearchRecord[]>([])
  const activeAddress = sessionAddress ?? walletAddress ?? null
  const balanceAddress = toWagmiAddress(activeAddress)

  const balance = useBalance({
    address: balanceAddress,
    chainId: ARC_CHAIN_ID,
    query: { enabled: Boolean(balanceAddress && ARC_CHAIN_ID) },
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [statsRes, researchRes] = await Promise.all([
        fetch('/api/wallet/stats', { credentials: 'include' }),
        fetch('/api/research?limit=50', { credentials: 'include' }),
      ])
      if (cancelled) return
      if (statsRes.ok) setStats(await statsRes.json())
      if (researchRes.ok) {
        const body = await researchRes.json() as { researches: ResearchRecord[] }
        setResearches(body.researches)
      }
    }
    load().catch(() => {})
    const timer = window.setInterval(() => load().catch(() => {}), 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  const balanceText = useMemo(() => formatBalance(balance.data?.formatted), [balance.data?.formatted])
  const chainText = chainId === ARC_CHAIN_ID || !chainId ? 'ARC-TESTNET' : `WRONG NET (${chainId})`

  return (
    <main className="min-h-screen bg-bg-base px-3 pb-12 pt-12 text-text-primary md:px-6">
      <section className="mx-auto w-full max-w-[1180px] space-y-5">
        <div className="font-mono text-sm font-bold uppercase tracking-[0.05em] text-amber">&gt; AUTHENTICATED</div>

        <div className="grid gap-4 lg:grid-cols-[minmax(280px,360px)_1fr]">
          <section className="border border-border bg-bg-panel">
            <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
              ACCOUNT
            </div>
            <div className="space-y-3 px-4 py-4">
              <FieldRow label="ADDR" value={shortAddress(activeAddress)} />
              <FieldRow label="BALANCE" value={balanceText} />
              <FieldRow label="CHAIN" value={chainText} />
            </div>
            <div className="border-t border-border px-4 py-4">
              <button type="button" onClick={() => logout().catch(() => {})} className="terminal-button h-10 px-4 text-xs">
                [DISCONNECT]
              </button>
            </div>
          </section>

          <section className="border border-border bg-bg-panel">
            <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
              RESEARCH ENGINE
            </div>
            <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
              <FieldRow label="TOTAL RESEARCH" value={String(researches.length)} />
              <FieldRow label="TOTAL CALLS" value={String(stats?.totalCalls ?? 0)} />
              <FieldRow label="TOTAL SPENT" value={`${stats?.totalSpentUsdc ?? '0'} USDC`} />
              <FieldRow label="LAST RUN" value={stats?.lastResearchAt ? stats.lastResearchAt.slice(0, 19).replace('T', ' ') : 'N/A'} />
            </div>
            <div className="border-t border-border px-4 py-4">
              <a href="/research" className="terminal-button h-10 px-4 text-xs">
                [▸ START NEW RESEARCH →]
              </a>
            </div>
          </section>
        </div>

        <section className="border border-border bg-bg-panel">
          <div className="border-b border-amber bg-bg-base px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.05em] text-amber">
            &gt; RESEARCH HISTORY
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[11px] uppercase tracking-[0.05em]">
              <thead className="bg-bg-cell text-amber">
                <tr>
                  <th className="border-b border-border px-3 py-2 text-left">#</th>
                  <th className="border-b border-border px-3 py-2 text-left">TOPIC</th>
                  <th className="border-b border-border px-3 py-2 text-left">STATUS</th>
                  <th className="border-b border-border px-3 py-2 text-left">COST</th>
                </tr>
              </thead>
              <tbody>
                {researches.length ? researches.map((research) => (
                  <tr
                    key={research.id}
                    className="cursor-pointer hover:bg-bg-hover"
                  >
                    <td className="border-b border-border px-3 py-2 text-amber">
                      <a href={`/research/${research.id}`} className="block">{shortId(research.id).slice(0, 4)}</a>
                    </td>
                    <td className="max-w-[520px] truncate border-b border-border px-3 py-2 text-text-primary">
                      <a href={`/research/${research.id}`} className="block">{research.topic}</a>
                    </td>
                    <td className={`border-b border-border px-3 py-2 ${research.status === 'completed' ? 'text-green' : research.status === 'running' ? 'text-cyan' : 'text-red'}`}>
                      {statusLabel(research.status)}
                    </td>
                    <td className="border-b border-border px-3 py-2 tabular-nums text-amber">{research.spentUsdc}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-text-secondary">
                      NO RESEARCH YET. CLICK [START NEW RESEARCH] ABOVE.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  )
}
