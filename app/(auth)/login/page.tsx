'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton'
import { NetworkGuard } from '@/components/auth/NetworkGuard'
import { useUser } from '@/hooks/useUser'

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
    <main className="relative flex min-h-screen items-center justify-center px-5">
      <div className="absolute left-0 right-0 top-0">
        <NetworkGuard />
      </div>
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-bg-surface p-10 shadow-2xl shadow-black/40">
        <div className="mb-3 font-mono text-xs uppercase tracking-widest text-arc">- CONNECT TO START</div>
        <h2 className="mb-3 text-3xl font-semibold leading-tight">
          给你的 Agent
          <br />
          一笔预算去做研究
        </h2>
        <p className="mb-7 text-white/60">
          用钱包登录，Agent 即可在你设定的 USDC 预算内自主调用数据源、生成研究报告。
        </p>
        <div className="flex">
          <ConnectWalletButton />
        </div>
        <p className="mt-5 text-center text-xs text-white/40">We don't store your private key - only your public address.</p>
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
