'use client'

import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { ARC_CHAIN_ID } from '@/lib/constants'
import { arcTestnet } from '@/lib/wagmi'

function WarningIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 8v4M12 16h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  )
}

function chainLabel(chainId: number) {
  if (chainId === 1) return 'Ethereum Mainnet (chainId: 1)'
  return `chainId: ${chainId}`
}

export function NetworkGuard() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  if (!isConnected || chainId === ARC_CHAIN_ID) return null

  return (
    <div className="px-5 py-5 md:px-7">
      <div className="flex flex-col gap-4 rounded-md border border-danger/25 bg-gradient-to-b from-danger/10 to-danger/5 px-5 py-4 md:flex-row md:items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-danger/15 text-danger">
          <WarningIcon />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary">钱包当前不在 Arc Testnet</div>
          <div className="mt-0.5 text-[0.8125rem] text-text-secondary">
            检测到 <span className="font-mono tabular-nums text-text-muted">{chainLabel(chainId)}</span> · 切换网络后才能签名登录
          </div>
        </div>
        <button
          onClick={() => switchChain({ chainId: arcTestnet.id })}
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-sm bg-arc px-5 text-sm font-medium text-white transition duration-200 hover:bg-arc-hover hover:shadow-arc-glow active:translate-y-px"
        >
          Switch to Arc Testnet
        </button>
      </div>
    </div>
  )
}
