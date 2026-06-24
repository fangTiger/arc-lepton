'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'
import { Logo } from '@/components/Logo'
import { useUser } from '@/hooks/useUser'

function DocsIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  )
}

function LoginContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { isAuthed } = useUser()

  useEffect(() => {
    if (isAuthed) {
      const redirect = params.get('redirect') ?? '/dashboard'
      router.replace(redirect)
    }
  }, [isAuthed, router, params])

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-bg-base px-5 py-24 text-text-primary">
      <div className="glow-arc pointer-events-none absolute left-1/2 top-[-210px] h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-arc/15 blur-[120px]" />
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" />

      <div className="absolute left-0 right-0 top-0 z-20">
        <NetworkGuard />
      </div>

      <div className="absolute left-5 right-5 top-5 z-10 flex items-center justify-between md:left-8 md:right-8">
        <Logo />
        <a
          href="/docs"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/10 px-4 text-[0.8125rem] font-medium text-text-primary transition duration-200 hover:border-white/15 hover:bg-bg-surface active:translate-y-px"
        >
          <DocsIcon />
          Docs
        </a>
      </div>

      <div className="float-in relative z-10 w-full max-w-[420px] rounded-lg border border-white/10 bg-bg-surface p-8 shadow-[0_16px_64px_rgba(0,0,0,0.70),0_0_0_1px_rgba(255,255,255,0.16)]">
        <div className="mb-3 inline-flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-arc before:h-px before:w-4 before:bg-current">
          ▸ CONNECT TO START
        </div>
        <h2 className="mb-3 text-[1.625rem] font-semibold leading-[1.2] tracking-[-0.015em] text-text-primary">
          给你的 Agent
          <br />
          一笔预算去做研究
        </h2>
        <p className="mb-8 text-[0.9375rem] leading-6 text-text-secondary">
          用钱包登录，Agent 即可在你设定的 USDC 预算内自主调用数据源、生成研究报告。
        </p>

        <ConnectWalletButton variant="cta" />

        <div className="my-5 flex items-center gap-3 font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-text-disabled before:h-px before:flex-1 before:bg-white/5 after:h-px after:flex-1 after:bg-white/5">
          TRUSTED BY
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-md border border-white/5 bg-bg-inset p-4">
          <div>
            <div className="font-mono text-lg font-medium tabular-nums text-text-primary">1,247</div>
            <div className="mt-0.5 text-[0.6875rem] uppercase tracking-[0.06em] text-text-muted">researches done</div>
          </div>
          <div>
            <div className="font-mono text-lg font-medium tabular-nums text-text-primary">$3.42</div>
            <div className="mt-0.5 text-[0.6875rem] uppercase tracking-[0.06em] text-text-muted">USDC spent on-chain</div>
          </div>
        </div>

        <div className="mt-5 text-center text-xs leading-6 text-text-muted">
          We don't store your private key — only your public address.
          <br />
          By connecting you agree to our{' '}
          <a href="/terms" className="text-text-secondary underline underline-offset-2">
            Terms
          </a>
          .
        </div>
      </div>
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
