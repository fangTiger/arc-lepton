import { itemsHash, settlementKey, type CanonicalSettlementItem } from '@/lib/chain/canonical'
import type { TxLogRepo, TxLogScopedEntry } from '@/lib/db/tx-log-repo'

export class SettlementReceiptMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettlementReceiptMismatchError'
  }
}

export type EscrowSettlementResearch = {
  id: string
  address: string
  researchKey: string
  escrowAddress: string
  chainId: number
}

export type SettlementAuthorization = {
  escrow: string
  researchKey: string
  settlementKey: string
  itemsHash: string
  total: bigint
  itemCount: number
  chainId: number
  nonce: string
  issuedAt: bigint
  deadline: bigint
  signature: string
}

export type SettlementSigner = {
  signSettlementAuthorization(input: {
    escrow: string
    researchKey: string
    settlementKey: string
    itemsHash: string
    total: bigint
    itemCount: number
    chainId: number
  }): Promise<SettlementAuthorization>
}

export type SettlementChainClient = {
  simulateSettleBatch(input: SettlementChainInput): Promise<unknown>
  writeSettleBatch(input: SettlementChainInput): Promise<{ txHash: string }>
  waitForSettlementReceipt(input: { txHash: string; settlementKey: string }): Promise<SettlementReceipt>
}

export type SettlementChainInput = {
  escrowAddress: string
  settlementKey: string
  items: SettlementItem[]
  authorization: SettlementAuthorization
}

export type SettlementItem = {
  requestKey: string
  sourceId: string
  registryRevision: string
  expectedPayout: string
  maxUnitPrice: string
  amount: string
}

export type SettlementReceipt = {
  status: 'success' | 'reverted'
  txHash: string
  blockNumber: string | number | bigint
  batch: {
    settlementKey: string
    itemsHash: string
    total: string
    itemCount: number
  }
  items: SettlementItem[]
  transfers: Array<{
    token: string
    from: string
    to: string
    value: string
  }>
}

export type SettleEscrowResearchPaymentsInput = {
  research: EscrowSettlementResearch
  settlementId: string
  officialUsdc: string
  txLogRepo: TxLogRepo
  signer: SettlementSigner
  chainClient: SettlementChainClient
}

export async function settleEscrowResearchPayments(input: SettleEscrowResearchPaymentsInput) {
  const intents = await pendingEscrowIntents(input)
  const settlementItems = intents
    .map((entry) => settlementItemFromIntent(entry))
    .sort((left, right) => left.requestKey.localeCompare(right.requestKey))
  if (settlementItems.length === 0) {
    throw new SettlementReceiptMismatchError('No pending escrow payment intents to settle')
  }

  const derivedSettlementKey = settlementKey(input.research.researchKey, input.settlementId)
  const derivedItemsHash = itemsHash(settlementItems)
  const total = settlementItems.reduce((sum, item) => sum + BigInt(item.amount), 0n)
  const authorization = await input.signer.signSettlementAuthorization({
    escrow: input.research.escrowAddress,
    researchKey: input.research.researchKey,
    settlementKey: derivedSettlementKey,
    itemsHash: derivedItemsHash,
    total,
    itemCount: settlementItems.length,
    chainId: input.research.chainId,
  })

  const chainInput = {
    escrowAddress: input.research.escrowAddress,
    settlementKey: derivedSettlementKey,
    items: settlementItems,
    authorization,
  }
  await input.chainClient.simulateSettleBatch(chainInput)
  const { txHash } = await input.chainClient.writeSettleBatch(chainInput)
  const receipt = await input.chainClient.waitForSettlementReceipt({ txHash, settlementKey: derivedSettlementKey })
  assertSettlementReceiptMatches({
    receipt,
    txHash,
    settlementKey: derivedSettlementKey,
    itemsHash: derivedItemsHash,
    total,
    items: settlementItems,
    escrowAddress: input.research.escrowAddress,
    officialUsdc: input.officialUsdc,
  })

  await input.txLogRepo.markResearchSettlementConfirmed({
    address: input.research.address,
    researchId: input.research.id,
    requestIds: intents.map((entry) => entry.requestId),
    settlementId: input.settlementId,
    txHash,
    txStatus: 'confirmed',
    chainId: input.research.chainId,
    blockNumber: String(receipt.blockNumber),
  })

  return {
    status: 'confirmed' as const,
    settlementId: input.settlementId,
    settlementKey: derivedSettlementKey,
    itemsHash: derivedItemsHash,
    total: total.toString(),
    itemCount: settlementItems.length,
    txHash,
    blockNumber: String(receipt.blockNumber),
  }
}

async function pendingEscrowIntents(input: SettleEscrowResearchPaymentsInput) {
  const entries = await input.txLogRepo.listPendingByResearchId(input.research.address, input.research.id, 200)
  return entries.filter((entry) => (
    entry.backend === 'escrow'
    && lower(entry.escrowAddress) === lower(input.research.escrowAddress)
    && lower(entry.researchKey) === lower(input.research.researchKey)
  ))
}

function settlementItemFromIntent(entry: TxLogScopedEntry): SettlementItem {
  if (!entry.requestKey || !entry.sourceId || !entry.registryRevision || !entry.expectedPayout || !entry.maxUnitPrice || !entry.amountUnits) {
    throw new SettlementReceiptMismatchError(`Payment intent ${entry.requestId} is missing escrow settlement snapshot fields`)
  }
  return {
    requestKey: entry.requestKey,
    sourceId: entry.sourceId,
    registryRevision: entry.registryRevision,
    expectedPayout: entry.expectedPayout.toLowerCase(),
    maxUnitPrice: entry.maxUnitPrice,
    amount: entry.amountUnits,
  }
}

function assertSettlementReceiptMatches(input: {
  receipt: SettlementReceipt
  txHash: string
  settlementKey: string
  itemsHash: string
  total: bigint
  items: SettlementItem[]
  escrowAddress: string
  officialUsdc: string
}) {
  if (input.receipt.status !== 'success') throw mismatch('settlement receipt did not succeed')
  if (lower(input.receipt.txHash) !== lower(input.txHash)) throw mismatch('settlement receipt txHash mismatch')
  if (lower(input.receipt.batch.settlementKey) !== lower(input.settlementKey)) throw mismatch('settlementKey mismatch')
  if (lower(input.receipt.batch.itemsHash) !== lower(input.itemsHash)) throw mismatch('itemsHash mismatch')
  if (BigInt(input.receipt.batch.total) !== input.total) throw mismatch('settlement total mismatch')
  if (input.receipt.batch.itemCount !== input.items.length) throw mismatch('settlement itemCount mismatch')
  if (input.receipt.items.length !== input.items.length) throw mismatch('settlement item event count mismatch')
  for (let index = 0; index < input.items.length; index += 1) {
    assertItemMatches(input.receipt.items[index], input.items[index], index)
  }

  const settlementTransfers = input.receipt.transfers.filter((transfer) => (
    lower(transfer.token) === lower(input.officialUsdc)
    && lower(transfer.from) === lower(input.escrowAddress)
  ))
  if (settlementTransfers.length !== input.items.length) throw mismatch('USDC Transfer count mismatch')
  for (const item of input.items) {
    const matched = settlementTransfers.find((transfer) => (
      lower(transfer.to) === lower(item.expectedPayout)
      && BigInt(transfer.value) === BigInt(item.amount)
    ))
    if (!matched) throw mismatch(`USDC Transfer missing for requestKey ${item.requestKey}`)
  }
}

function assertItemMatches(actual: SettlementItem, expected: SettlementItem, index: number) {
  const actualCanonical = canonicalItem(actual)
  const expectedCanonical = canonicalItem(expected)
  if (JSON.stringify(actualCanonical) !== JSON.stringify(expectedCanonical)) {
    throw mismatch(`settlement item ${index} mismatch`)
  }
}

function canonicalItem(item: SettlementItem): CanonicalSettlementItem {
  return {
    requestKey: item.requestKey.toLowerCase(),
    sourceId: item.sourceId.toLowerCase(),
    registryRevision: BigInt(item.registryRevision).toString(),
    expectedPayout: item.expectedPayout.toLowerCase(),
    maxUnitPrice: BigInt(item.maxUnitPrice).toString(),
    amount: BigInt(item.amount).toString(),
  }
}

function mismatch(message: string) {
  return new SettlementReceiptMismatchError(message)
}

function lower(value: string | null | undefined) {
  return value?.toLowerCase() ?? null
}
