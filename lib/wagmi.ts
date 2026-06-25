import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { defineChain } from 'viem'
import { PRODUCT_NAME, WALLETCONNECT_FALLBACK_PROJECT_ID } from './brand'
import { ARC_CHAIN_ID, ARC_RPC_URL } from './constants'

export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC_URL || 'http://localhost:8545'] } },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: process.env.NEXT_PUBLIC_ARC_EXPLORER_URL ?? '',
    },
  },
  testnet: true,
})

export const wagmiConfig = getDefaultConfig({
  appName: PRODUCT_NAME,
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? WALLETCONNECT_FALLBACK_PROJECT_ID,
  chains: [arcTestnet],
  ssr: true,
})
