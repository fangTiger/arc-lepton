import { randomBytes } from 'node:crypto'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  isAddress,
  stringToHex,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ARC_CHAIN_ID, ARC_RPC_URL } from '@/lib/constants'

export type ArcReceiptMode = 'mock' | 'arc'

export type ArcReceiptInput = {
  buyer: string
  source: string
  amount: string
  requestId: string
  researchId?: string
  createdAt?: string
  mode?: ArcReceiptMode
}

export type ArcReceiptPayload = {
  kind: 'arc-lepton.receipt'
  version: 1
  buyer: string
  source: string
  amount: string
  researchId: string | null
  requestId: string
  createdAt: string
}

export type ArcReceiptResult = {
  txHash: string
  txStatus: 'mock' | 'confirmed'
  chainId: number | null
  blockNumber: string | null
  requestId: string
}

type ArcReceiptDeps = {
  createPublicClient: typeof createPublicClient
  createWalletClient: typeof createWalletClient
  http: typeof http
  privateKeyToAccount: typeof privateKeyToAccount
  isAddress: typeof isAddress
}

const defaultDeps: ArcReceiptDeps = {
  createPublicClient,
  createWalletClient,
  http,
  privateKeyToAccount,
  isAddress,
}

function mockTxHash() {
  return `0x${randomBytes(32).toString('hex')}`
}

function currentMode(mode?: ArcReceiptMode): ArcReceiptMode {
  if (mode) return mode
  return process.env.ARC_RECEIPT_MODE?.trim().toLowerCase() === 'arc' ? 'arc' : 'mock'
}

function arcReceiptConfigError(message: string) {
  return new ArcReceiptError({
    code: 'ARC_RECEIPT_CONFIG_INVALID',
    message,
  })
}

export class ArcReceiptError extends Error {
  readonly code: string
  readonly txStatus = 'failed' as const
  readonly txHash?: string
  readonly chainId: number | null
  readonly blockNumber: string | null

  constructor(input: {
    code: string
    message: string
    txHash?: string
    chainId?: number | null
    blockNumber?: string | null
  }) {
    super(input.message)
    this.name = 'ArcReceiptError'
    this.code = input.code
    this.txHash = input.txHash
    this.chainId = input.chainId ?? null
    this.blockNumber = input.blockNumber ?? null
  }
}

export function buildReceiptPayload(input: ArcReceiptInput): ArcReceiptPayload {
  return {
    kind: 'arc-lepton.receipt',
    version: 1,
    buyer: input.buyer,
    source: input.source,
    amount: input.amount,
    researchId: input.researchId ?? null,
    requestId: input.requestId,
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}

export function encodeReceiptPayload(payload: ArcReceiptPayload): Hex {
  return stringToHex(JSON.stringify(payload))
}

function createArcChain(rpcUrl: string) {
  return defineChain({
    id: ARC_CHAIN_ID,
    name: 'Arc Testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: [rpcUrl] } },
    testnet: true,
  })
}

export async function recordArcReceipt(input: ArcReceiptInput, deps: ArcReceiptDeps = defaultDeps): Promise<ArcReceiptResult> {
  const mode = currentMode(input.mode)
  if (mode === 'mock') {
    return {
      txHash: mockTxHash(),
      txStatus: 'mock',
      chainId: null,
      blockNumber: null,
      requestId: input.requestId,
    }
  }

  const rpcUrl = ARC_RPC_URL.trim()
  if (!ARC_CHAIN_ID) throw arcReceiptConfigError('ARC chainId is required for arc receipt mode')
  if (!rpcUrl) throw arcReceiptConfigError('ARC RPC URL is required for arc receipt mode')

  const privateKey = process.env.ARC_RECORDER_PRIVATE_KEY?.trim()
  if (!privateKey) throw arcReceiptConfigError('ARC recorder private key is required for arc receipt mode')

  const account = deps.privateKeyToAccount(privateKey as Hex)
  const receiptToAddress = process.env.ARC_RECEIPT_TO_ADDRESS?.trim() || account.address
  if (!deps.isAddress(receiptToAddress)) {
    throw arcReceiptConfigError('ARC receipt destination address is invalid')
  }

  const chain = createArcChain(rpcUrl)
  const transport = deps.http(rpcUrl)
  const publicClient = deps.createPublicClient({ chain, transport })
  const walletClient = deps.createWalletClient({ account, chain, transport })
  const data = encodeReceiptPayload(buildReceiptPayload(input))

  let txHash: Hex | undefined
  try {
    txHash = await walletClient.sendTransaction({
      account,
      to: receiptToAddress,
      value: 0n,
      data,
      chain,
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
    const blockNumber = receipt.blockNumber?.toString() ?? null
    if (receipt.status !== 'success') {
      throw new ArcReceiptError({
        code: 'ARC_RECEIPT_REVERTED',
        message: 'ARC receipt transaction failed on chain',
        txHash,
        chainId: chain.id,
        blockNumber,
      })
    }

    return {
      txHash,
      txStatus: 'confirmed',
      chainId: chain.id,
      blockNumber,
      requestId: input.requestId,
    }
  } catch (error) {
    if (error instanceof ArcReceiptError) throw error
    const message = error instanceof Error ? error.message : 'ARC receipt broadcast failed'
    throw new ArcReceiptError({
      code: 'ARC_RECEIPT_RPC_ERROR',
      message,
      txHash,
      chainId: ARC_CHAIN_ID || null,
      blockNumber: null,
    })
  }
}
