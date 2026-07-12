import { describe, expect, it, vi } from 'vitest'
import { itemsHash, settlementKey } from '@/lib/chain/canonical'
import { MemoryTxLogRepo } from '@/lib/db/tx-log-repo-memory'
import { settleEscrowResearchPayments, SettlementReceiptMismatchError } from './settlement-client'

const buyer = '0xabcdef000000000000000000000000000000c1d3'
const escrowAddress = '0x4444000000000000000000000000000000000001'
const payoutA = '0x7777000000000000000000000000000000000001'
const payoutB = '0x7777000000000000000000000000000000000002'
const officialUsdc = '0x3600000000000000000000000000000000000000'
const researchKey = `0x${'42'.repeat(32)}`
const chainId = 5042002
const settlementId = '00000000-0000-4000-8000-000000000011'
const txHash = `0x${'12'.repeat(32)}`

describe('settleEscrowResearchPayments', () => {
  it('builds deterministic settlement items, signs, simulates, writes, verifies receipt evidence, and confirms intents', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    await pendingIntent(txLogRepo, {
      source: 'zeta-source',
      amount: '0.000003',
      paymentIntentId: '00000000-0000-4000-8000-000000000102',
      toolOrdinal: 2,
      expectedPayout: payoutB,
      registryRevision: '7',
      maxUnitPrice: '9',
      registryReadBlock: '9002',
    })
    await pendingIntent(txLogRepo, {
      source: 'alpha-source',
      amount: '0.000002',
      paymentIntentId: '00000000-0000-4000-8000-000000000101',
      toolOrdinal: 1,
      expectedPayout: payoutA,
      registryRevision: '5',
      maxUnitPrice: '6',
      registryReadBlock: '9001',
    })
    const expectedItems = (await txLogRepo.listPendingByResearchId(buyer, 'research-1', 10))
      .map((entry) => ({
        requestKey: entry.requestKey as string,
        sourceId: entry.sourceId as string,
        registryRevision: entry.registryRevision as string,
        expectedPayout: entry.expectedPayout as string,
        maxUnitPrice: entry.maxUnitPrice as string,
        amount: entry.amountUnits as string,
      }))
      .sort((left, right) => left.requestKey.localeCompare(right.requestKey))
    const expectedItemsHash = itemsHash(expectedItems)
    const expectedSettlementKey = settlementKey(researchKey, settlementId)
    const calls: string[] = []
    const signer = {
      signSettlementAuthorization: vi.fn(async (input) => {
        calls.push('sign')
        return {
          ...input,
          nonce: `0x${'77'.repeat(32)}`,
          issuedAt: 1_784_000_000n,
          deadline: 1_784_000_240n,
          signature: `0x${'11'.repeat(65)}`,
        }
      }),
    }
    const chainClient = {
      simulateSettleBatch: vi.fn(async (input) => {
        calls.push('simulate')
        expect(input.items).toEqual(expectedItems)
      }),
      writeSettleBatch: vi.fn(async (input) => {
        calls.push('write')
        expect(input.settlementKey).toBe(expectedSettlementKey)
        expect(input.authorization.itemsHash).toBe(expectedItemsHash)
        return { txHash }
      }),
      waitForSettlementReceipt: vi.fn(async () => {
        calls.push('receipt')
        return settlementReceipt({
          settlementKey: expectedSettlementKey,
          itemsHash: expectedItemsHash,
          total: '5',
          itemCount: 2,
          items: expectedItems,
          transfers: expectedItems.map((item) => ({
            token: officialUsdc,
            from: escrowAddress,
            to: item.expectedPayout,
            value: item.amount,
          })),
        })
      }),
    }

    const result = await settleEscrowResearchPayments({
      research: researchRecord(),
      settlementId,
      officialUsdc,
      txLogRepo,
      signer,
      chainClient,
    })

    expect(calls).toEqual(['sign', 'simulate', 'write', 'receipt'])
    expect(result).toEqual({
      status: 'confirmed',
      settlementId,
      settlementKey: expectedSettlementKey,
      itemsHash: expectedItemsHash,
      total: '5',
      itemCount: 2,
      txHash,
      blockNumber: '123456',
    })
    expect(signer.signSettlementAuthorization).toHaveBeenCalledWith({
      escrow: escrowAddress,
      researchKey,
      settlementKey: expectedSettlementKey,
      itemsHash: expectedItemsHash,
      total: 5n,
      itemCount: 2,
      chainId,
    })
    const confirmed = await txLogRepo.listByResearchId(buyer, 'research-1', 10)
    expect(confirmed).toHaveLength(2)
    expect(confirmed).toEqual(expect.arrayContaining([
      expect.objectContaining({ txStatus: 'confirmed', settlementId, txHash, chainId, blockNumber: '123456' }),
      expect.objectContaining({ txStatus: 'confirmed', settlementId, txHash, chainId, blockNumber: '123456' }),
    ]))
  })

  it('rejects successful receipts whose USDC Transfer evidence does not match the frozen snapshot', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    await pendingIntent(txLogRepo, {
      source: 'alpha-source',
      amount: '0.000002',
      paymentIntentId: '00000000-0000-4000-8000-000000000101',
      toolOrdinal: 1,
      expectedPayout: payoutA,
      registryRevision: '5',
      maxUnitPrice: '6',
      registryReadBlock: '9001',
    })
    const [entry] = await txLogRepo.listPendingByResearchId(buyer, 'research-1', 10)
    const expectedSettlementKey = settlementKey(researchKey, settlementId)
    const expectedItems = [{
      requestKey: entry.requestKey as string,
      sourceId: entry.sourceId as string,
      registryRevision: entry.registryRevision as string,
      expectedPayout: entry.expectedPayout as string,
      maxUnitPrice: entry.maxUnitPrice as string,
      amount: entry.amountUnits as string,
    }]
    const expectedItemsHash = itemsHash(expectedItems)

    await expect(settleEscrowResearchPayments({
      research: researchRecord(),
      settlementId,
      officialUsdc,
      txLogRepo,
      signer: {
        signSettlementAuthorization: async (input) => ({
          ...input,
          nonce: `0x${'77'.repeat(32)}`,
          issuedAt: 1_784_000_000n,
          deadline: 1_784_000_240n,
          signature: `0x${'11'.repeat(65)}`,
        }),
      },
      chainClient: {
        simulateSettleBatch: async () => undefined,
        writeSettleBatch: async () => ({ txHash }),
        waitForSettlementReceipt: async () => settlementReceipt({
          settlementKey: expectedSettlementKey,
          itemsHash: expectedItemsHash,
          total: '2',
          itemCount: 1,
          items: expectedItems,
          transfers: [{
            token: officialUsdc,
            from: escrowAddress,
            to: payoutA,
            value: '3',
          }],
        }),
      },
    })).rejects.toBeInstanceOf(SettlementReceiptMismatchError)

    await expect(txLogRepo.listPendingByResearchId(buyer, 'research-1', 10)).resolves.toHaveLength(1)
  })
})

async function pendingIntent(
  txLogRepo: MemoryTxLogRepo,
  overrides: {
    source: string
    amount: string
    paymentIntentId: string
    toolOrdinal: number
    expectedPayout: string
    registryRevision: string
    maxUnitPrice: string
    registryReadBlock: string
  },
) {
  return txLogRepo.claimResearchPaymentIntent({
    address: buyer,
    researchId: 'research-1',
    researchKey,
    escrowAddress,
    payload: { source: overrides.source, ordinal: overrides.toolOrdinal },
    ...overrides,
  })
}

function researchRecord() {
  return {
    id: 'research-1',
    address: buyer,
    researchKey,
    escrowAddress,
    chainId,
  }
}

function settlementReceipt(input: {
  settlementKey: string
  itemsHash: string
  total: string
  itemCount: number
  items: Array<{
    requestKey: string
    sourceId: string
    registryRevision: string
    expectedPayout: string
    maxUnitPrice: string
    amount: string
  }>
  transfers: Array<{ token: string; from: string; to: string; value: string }>
}) {
  return {
    status: 'success' as const,
    txHash,
    blockNumber: '123456',
    batch: {
      settlementKey: input.settlementKey,
      itemsHash: input.itemsHash,
      total: input.total,
      itemCount: input.itemCount,
    },
    items: input.items,
    transfers: input.transfers,
  }
}
