'use client'

import { useRouter } from 'next/navigation'
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'
import { Logo } from '@/components/Logo'

const stats = [
  { value: '1,247', label: 'researches done' },
  { value: '$3.42', label: 'USDC spent on-chain' },
  { value: 'Arc Testnet', label: 'Built on' },
]

export default function HomePage() {
  const router = useRouter()

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg-base text-text-primary">
      <div className="glow-arc pointer-events-none absolute left-1/2 top-[-220px] h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-arc/15 blur-[120px]" />
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" />

      <header className="relative z-10 flex h-[68px] items-center justify-between border-b border-white/5 px-5 md:px-7">
        <div className="flex items-center gap-8">
          <Logo compact />
          <nav className="hidden items-center gap-5 text-[0.8125rem] text-text-secondary md:flex">
            <a className="py-2 transition hover:text-text-primary" href="#research">
              Research
            </a>
            <a className="py-2 transition hover:text-text-primary" href="#history">
              History
            </a>
            <a className="py-2 transition hover:text-text-primary" href="/docs">
              Docs
            </a>
          </nav>
        </div>
        <ConnectWalletButton />
      </header>

      <div className="relative z-10">
        <NetworkGuard />
      </div>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-68px)] w-full max-w-6xl items-center px-5 py-16 md:px-7 md:py-20">
        <div className="max-w-3xl">
          <div className="mb-4 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-arc">
            ▸ ARC LEPTON · LEPTON HACKATHON
          </div>
          <h1 className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.02em] text-text-primary md:text-7xl">
            让你的 AI Agent
            <br />
            自己花 USDC 做研究
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-text-secondary">
            设个预算，Agent 自主调用链上信号、新闻、鲸鱼追踪 API，每次调用按 nano-USDC 计费，全程链上可查。
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => router.push('/login')}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-sm bg-arc px-6 text-[0.9375rem] font-medium text-white transition duration-200 hover:bg-arc-hover hover:shadow-arc-glow active:translate-y-px"
            >
              Start Researching
              <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
            </button>
            <a
              href="/docs"
              className="inline-flex h-12 items-center justify-center rounded-sm border border-white/10 px-6 text-[0.9375rem] font-medium text-text-primary transition duration-200 hover:border-white/15 hover:bg-bg-surface active:translate-y-px"
            >
              View Docs
            </a>
          </div>

          <div className="mt-10 grid max-w-3xl grid-cols-1 gap-1 rounded-md border border-white/5 bg-bg-inset p-4 sm:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.label} className="px-3 py-2">
                <div className="font-mono text-lg font-medium tabular-nums text-text-primary">{stat.value}</div>
                <div className="mt-0.5 text-[0.6875rem] uppercase tracking-[0.06em] text-text-muted">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
