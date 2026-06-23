'use client'

import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { ARC_CHAIN_ID } from '@/lib/constants'
import { arcTestnet } from '@/lib/wagmi'

export function NetworkGuard() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()

  if (!isConnected || chainId === ARC_CHAIN_ID) return null

  return (
    <div className="px-7 py-5">
      <div className="flex items-center gap-4 rounded-md border border-danger/30 bg-danger/5 px-5 py-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-danger/20 text-danger">!</div>
        <div className="flex-1">
          <div className="text-sm font-medium">钱包当前不在 Arc Testnet</div>
          <div className="mt-0.5 text-xs text-white/55">
            检测到 <span className="font-mono text-white/40">chainId: {chainId}</span> · 切换网络后才能签名登录
          </div>
        </div>
        <button
          onClick={() => switchChain({ chainId: arcTestnet.id })}
          className="h-10 rounded-md bg-arc px-5 text-sm font-medium text-white hover:bg-arc-hover"
        >
          Switch to Arc Testnet
        </button>
      </div>
    </div>
  )
}
