'use client'

import { ConnectWalletButton } from './ConnectWalletButton'
import { useUser } from '@/hooks/useUser'

function LockIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isAuthed, isLoading } = useUser()

  if (isLoading) return null
  if (isAuthed) return <>{children}</>

  return (
    <div className="flex justify-center p-12">
      <div className="w-full max-w-md rounded-lg border border-dashed border-white/15 bg-bg-surface p-12 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-md border border-white/10 bg-bg-elevated text-white/60">
          <LockIcon />
        </div>
        <h3 className="mb-2 text-xl font-semibold">登录后查看</h3>
        <p className="mb-6 text-white/60">连接你的钱包以解锁研究历史、Agent 配置与 USDC 余额面板。</p>
        <div className="flex justify-center">
          <ConnectWalletButton />
        </div>
      </div>
    </div>
  )
}
