'use client'

import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import { ARC_CHAIN_ID } from '@/lib/constants'
import { arcTestnet } from '@/lib/wagmi'

function chainLabel(chainId: number) {
  if (chainId === 1) return 'ETHEREUM (1)'
  if (chainId === ARC_CHAIN_ID) return `ARC-TESTNET (${chainId || 5_042_002})`
  return `CHAIN (${chainId})`
}

export function NetworkGuard() {
  const { isConnected } = useAccount()
  const chainId = useChainId()
  const { switchChain } = useSwitchChain()
  const expectedChainId = arcTestnet.id || 5_042_002

  if (!isConnected || chainId === ARC_CHAIN_ID) return null

  return (
    <div className="w-full border-b border-red bg-bg-base px-2 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.05em] text-red md:px-4">
      <div className="flex items-center gap-3 overflow-x-auto whitespace-nowrap">
        <span>[!! NETWORK_MISMATCH]</span>
        <span>EXPECTED: ARC-TESTNET ({expectedChainId})</span>
        <span>CURRENT: {chainLabel(chainId)}</span>
        <button
          type="button"
          onClick={() => switchChain({ chainId: arcTestnet.id })}
          className="border border-red px-2 py-1 text-red hover:bg-red hover:text-bg-base"
        >
          [SWITCH NETWORK]
        </button>
      </div>
    </div>
  )
}
