'use client'

import { useRouter } from 'next/navigation'
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'
import { Logo } from '@/components/Logo'

const marketRows = [
  ['NEWS API', 'ONLINE', '12MS', 'text-green'],
  ['WHALE TRACE', 'SYNC', '31MS', 'text-cyan'],
  ['SOCIAL SIGNAL', 'HOT', '74MS', 'text-yellow'],
  ['USDC BUDGET', 'ARMED', '$25.00', 'text-amber'],
]

export default function HomePage() {
  const router = useRouter()

  return (
    <main className="min-h-screen bg-bg-base pt-8 pb-8 text-text-primary">
      <NetworkGuard />

      <section className="grid min-h-[calc(100vh-64px)] grid-cols-1 border-b border-border lg:grid-cols-[minmax(0,3fr)_minmax(360px,2fr)]">
        <div className="flex flex-col justify-center border-r border-border px-4 py-8 md:px-8">
          <Logo compact />
          <pre className="mt-8 overflow-hidden font-mono text-[10px] font-bold leading-[1.05] text-amber md:text-xs">
{` █████╗ ██████╗  ██████╗
██╔══██╗██╔══██╗██╔════╝
███████║██████╔╝██║
██╔══██║██╔══██╗██║
██║  ██║██║  ██║╚██████╗
╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝
     SIGNAL LEDGER TERMINAL`}
          </pre>

          <div className="mt-6 max-w-[720px]">
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-cyan">
              ● LIVE AGENT PAYMENT RAIL
            </div>
            <h1 className="max-w-[820px] font-mono text-2xl font-bold uppercase leading-[1.08] text-text-primary md:text-4xl">
              AI AGENTS SPEND USDC TO BUY MARKET RESEARCH.
            </h1>
            <p className="mt-4 max-w-[680px] text-sm leading-[1.5] text-text-secondary md:text-base">
              SET A BUDGET. LET THE AGENT CALL SIGNALS, NEWS, WHALE TRACKING, AND ON-CHAIN DATA. EVERY REQUEST IS
              ACCOUNTED FOR IN NANO-USDC.
            </p>
          </div>

          <div className="mt-8 flex flex-col gap-2 sm:flex-row">
            <button onClick={() => router.push('/research')} className="terminal-button h-11 px-5 text-xs">
              [START RESEARCH ▸]
            </button>
            <ConnectWalletButton />
          </div>
        </div>

        <aside className="bg-bg-panel px-3 py-4 md:px-4">
          <div className="border border-border bg-bg-cell">
            <div className="border-b border-border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.05em] text-amber">
              PROVIDER STATUS
            </div>
            <div className="divide-y divide-border">
              {marketRows.map(([name, state, latency, tone]) => (
                <div key={name} className="grid grid-cols-[1fr_72px_64px] px-3 py-2 text-[11px] uppercase tracking-[0.05em]">
                  <span className="text-text-secondary">{name}</span>
                  <span className={tone}>{state}</span>
                  <span className="text-right text-text-muted">{latency}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 border border-border bg-bg-cell p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-amber">TERMINAL LOG</div>
            <div className="mt-3 space-y-1 font-mono text-[11px] uppercase tracking-[0.05em] text-text-secondary">
              <div>&gt; AGENT/007 QUOTED NEWS API: 0.000024 USDC</div>
              <div>&gt; WHALE TRACE DELTA: +12.42M USDC</div>
              <div>&gt; PROVIDER ROUTING MATRIX ONLINE</div>
              <div>&gt; RESEARCH PACKET SEALED: BLOCK #1,247,891</div>
              <div className="text-amber">&gt; READY FOR WALLET AUTH_</div>
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}
