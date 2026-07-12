import { afterEach, describe, expect, it, vi } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { requestKey as deriveRequestKey, sourceId as deriveSourceId } from '@/lib/chain/canonical'
import { MemoryTxLogRepo } from './tx-log-repo-memory'
import vectors from '../../contracts/test/vectors/canonical-vectors.json'

describe('MemoryTxLogRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('records tx_log entries with generated id, txHash, and createdAt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    const repo = new MemoryTxLogRepo()

    const tx = await repo.record({
      address: '0xabc',
      source: 'whale-watch',
      amount: '0.0002',
    })

    expect(tx.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(tx.txHash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(tx.createdAt).toEqual(new Date('2026-06-25T00:00:00.000Z'))
    expect(tx.txStatus).toBe('mock')
    expect(tx.chainId).toBeNull()
    expect(tx.blockNumber).toBeNull()
    expect(tx.errorMessage).toBeNull()
    expect(tx.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('lists entries by address in newest-first order with a limit', async () => {
    vi.useFakeTimers()
    const repo = new MemoryTxLogRepo()

    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'))
    await repo.record({ address: '0xabc', source: 'sentiment', amount: '0.0001' })
    vi.setSystemTime(new Date('2026-06-25T00:01:00.000Z'))
    await repo.record({ address: '0xdef', source: 'news', amount: '0.0003' })
    vi.setSystemTime(new Date('2026-06-25T00:02:00.000Z'))
    await repo.record({ address: '0xabc', source: 'kline-pattern', amount: '0.0005' })

    const entries = await repo.listByAddress('0xabc', 1)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      address: '0xabc',
      source: 'kline-pattern',
      amount: '0.0005',
      createdAt: new Date('2026-06-25T00:02:00.000Z'),
    })
  })

  it('sums total spend by address as a decimal string', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({ address: '0xabc', source: 'sentiment', amount: '0.0001' })
    await repo.record({ address: '0xabc', source: 'whale-watch', amount: '0.0002' })
    await repo.record({ address: '0xdef', source: 'news', amount: '0.0003' })

    expect(await repo.totalSpentByAddress('0xabc')).toBe('0.0003')
  })

  it('finds an existing tx_log entry by address and requestId', async () => {
    const repo = new MemoryTxLogRepo()

    const recorded = await repo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      requestId: 'req-existing',
    })

    await expect(repo.findByRequestId('0xabc', 'req-existing')).resolves.toEqual(recorded)
    await expect(repo.findByRequestId('0xabc', 'req-missing')).resolves.toBeNull()
    await expect(repo.findByRequestId('0xdef', 'req-existing')).resolves.toBeNull()
  })

  it('lists only tx_log entries for the same address and researchId', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-r1',
    })
    await repo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-2',
      requestId: 'req-r2',
    })
    await repo.record({
      address: '0xabc',
      source: 'twitter-signals',
      amount: '0.0001',
      requestId: 'req-direct',
    })
    await repo.record({
      address: '0xdef',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-other-address',
    })

    const entries = await repo.listByResearchId('0xabc', 'research-1', 50)

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      address: '0xabc',
      source: 'news',
      researchId: 'research-1',
      requestId: 'req-r1',
    })
  })

  it('claims a pending request once and reuses the same record after confirmation', async () => {
    const repo = new MemoryTxLogRepo()
    const claimableRepo = repo as MemoryTxLogRepo & {
      claimRequest: (input: {
        address: string
        source: string
        amount: string
        requestId: string
        researchId?: string | null
      }) => Promise<{
        status: 'claimed' | 'existing' | 'pending' | 'failed'
        entry: {
          id: string
          txStatus: 'pending' | 'confirmed' | 'failed' | 'mock'
          txHash: string | null
          requestId: string
          researchId?: string | null
        }
      }>
      updateReceipt: (id: string, patch: {
        txHash?: string | null
        txStatus?: 'pending' | 'confirmed' | 'failed' | 'mock'
        chainId?: number | null
        blockNumber?: string | null
        errorMessage?: string | null
      }) => Promise<{
        id: string
        txStatus: 'pending' | 'confirmed' | 'failed' | 'mock'
        txHash: string | null
        requestId: string
        researchId?: string | null
      }>
    }

    const claimed = await claimableRepo.claimRequest({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-claim',
      researchId: 'research-1',
    })

    expect(claimed).toMatchObject({
      status: 'claimed',
      entry: {
        txHash: null,
        txStatus: 'pending',
        requestId: 'req-claim',
        researchId: 'research-1',
      },
    })

    const pending = await claimableRepo.claimRequest({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-claim',
      researchId: 'research-1',
    })
    expect(pending).toMatchObject({
      status: 'pending',
      entry: {
        id: claimed.entry.id,
        txStatus: 'pending',
        requestId: 'req-claim',
      },
    })

    const confirmed = await claimableRepo.updateReceipt(claimed.entry.id, {
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      errorMessage: null,
    })
    expect(confirmed).toMatchObject({
      id: claimed.entry.id,
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      requestId: 'req-claim',
      researchId: 'research-1',
    })

    const existing = await claimableRepo.claimRequest({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-claim',
      researchId: 'research-1',
    })
    expect(existing).toMatchObject({
      status: 'existing',
      entry: {
        id: claimed.entry.id,
        txStatus: 'confirmed',
        requestId: 'req-claim',
      },
    })
  })

  it('rejects reusing the same requestId for another source, amount, or researchId', async () => {
    const repo = new MemoryTxLogRepo()
    const claimableRepo = repo as MemoryTxLogRepo & {
      claimRequest: (input: {
        address: string
        source: string
        amount: string
        requestId: string
        researchId?: string | null
      }) => Promise<unknown>
    }

    await claimableRepo.claimRequest({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-conflict',
      researchId: 'research-1',
    })

    await expect(claimableRepo.claimRequest({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      requestId: 'req-conflict',
      researchId: 'research-2',
    })).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
      requestId: 'req-conflict',
    })
  })

  it('only counts mock and confirmed entries in spend totals and aggregate call counts', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({ address: '0xabc', source: 'sentiment', amount: '0.0001', txStatus: 'mock' })
    await repo.record({ address: '0xabc', source: 'whale-watch', amount: '0.0002', txStatus: 'confirmed' })
    await repo.record({ address: '0xabc', source: 'news', amount: '0.0003', txStatus: 'failed', requestId: 'req-failed' })
    await repo.record({ address: '0xabc', source: 'kline-pattern', amount: '0.0004', txStatus: 'pending' })
    await repo.record({ address: '0xdef', source: 'twitter-signals', amount: '0.0005', txStatus: 'confirmed' })

    expect(await repo.totalSpentByAddress('0xabc')).toBe('0.0003')
    expect(await repo.count()).toBe(3)
    expect(await repo.totalSpent()).toBe('0.0008')
  })

  it('persists confirmed receipt fields when provided', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-confirmed',
    })

    const [entry] = await repo.listByAddress('0xabc')

    expect(entry).toMatchObject({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-confirmed',
      errorMessage: null,
    })
  })

  it('persists failed receipt fields when provided', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({
      address: '0xabc',
      source: 'kline-pattern',
      amount: '0.0005',
      txStatus: 'failed',
      requestId: 'req-failed',
      errorMessage: 'RPC timeout',
    })

    const [entry] = await repo.listByAddress('0xabc')

    expect(entry).toMatchObject({
      address: '0xabc',
      source: 'kline-pattern',
      amount: '0.0005',
      txStatus: 'failed',
      requestId: 'req-failed',
      errorMessage: 'RPC timeout',
      chainId: null,
      blockNumber: null,
      txHash: null,
    })
  })

  it('stores a settlement id on pending research payment intents', async () => {
    const repo = new MemoryTxLogRepo()

    const entry = await repo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-pending-settlement',
      txStatus: 'pending',
      settlementId: 'settlement-1',
    })

    expect(entry).toMatchObject({
      txStatus: 'pending',
      txHash: null,
      settlementId: 'settlement-1',
    })
  })

  it('lists only pending payment intents for the owned research', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-pending-1',
      txStatus: 'pending',
    })
    await repo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-confirmed',
      txStatus: 'confirmed',
    })
    await repo.record({
      address: '0xabc',
      source: 'whale-watch',
      amount: '0.0002',
      researchId: 'research-2',
      requestId: 'req-other-research',
      txStatus: 'pending',
    })
    await repo.record({
      address: '0xdef',
      source: 'twitter-signals',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-other-address',
      txStatus: 'pending',
    })

    const pending = await repo.listPendingByResearchId('0xabc', 'research-1', 50)

    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      address: '0xabc',
      researchId: 'research-1',
      requestId: 'req-pending-1',
      txStatus: 'pending',
    })
  })

  it('marks a research settlement batch confirmed with one shared chain receipt', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    await repo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-sentiment',
      txStatus: 'pending',
    })

    const updated = await repo.markResearchSettlementConfirmed({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-news', 'req-sentiment'],
      settlementId: 'settlement-1',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 5_042_002,
      blockNumber: '12345',
    })

    expect(updated).toHaveLength(2)
    expect(updated).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestId: 'req-news',
        settlementId: 'settlement-1',
        txStatus: 'confirmed',
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 5_042_002,
        blockNumber: '12345',
      }),
      expect.objectContaining({
        requestId: 'req-sentiment',
        settlementId: 'settlement-1',
        txStatus: 'confirmed',
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 5_042_002,
        blockNumber: '12345',
      }),
    ]))
  })

  it('marks a research settlement batch failed with the shared failure reason', async () => {
    const repo = new MemoryTxLogRepo()

    await repo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    await repo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-sentiment',
      txStatus: 'pending',
    })

    const updated = await repo.markResearchSettlementFailed({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-news', 'req-sentiment'],
      settlementId: 'settlement-1',
      errorMessage: 'RPC timeout',
    })

    expect(updated).toHaveLength(2)
    expect(updated).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestId: 'req-news',
        settlementId: 'settlement-1',
        txStatus: 'failed',
        txHash: null,
        chainId: null,
        blockNumber: null,
        errorMessage: 'RPC timeout',
      }),
      expect.objectContaining({
        requestId: 'req-sentiment',
        settlementId: 'settlement-1',
        txStatus: 'failed',
        txHash: null,
        chainId: null,
        blockNumber: null,
        errorMessage: 'RPC timeout',
      }),
    ]))
  })

  it('claims an escrow research payment intent with a canonical immutable snapshot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T02:00:00.000Z'))
    const repo = new MemoryTxLogRepo()
    const claimableRepo = repo as MemoryTxLogRepo & {
      claimResearchPaymentIntent: (input: ReturnType<typeof escrowIntentInput>) => Promise<{
        status: 'claimed' | 'existing' | 'pending' | 'failed'
        entry: Record<string, unknown>
      }>
    }

    const input = escrowIntentInput()
    const claimed = await claimableRepo.claimResearchPaymentIntent(input)

    expect(claimed.status).toBe('claimed')
    expect(claimed.entry).toMatchObject({
      address: input.address,
      researchId: input.researchId,
      source: input.source,
      amount: '0.0001',
      txHash: null,
      txStatus: 'pending',
      chainId: null,
      blockNumber: null,
      settlementId: null,
      requestId: vectors.expected.requestKey,
      paymentIntentId: vectors.inputs.canonicalPaymentIntentId,
      toolOrdinal: 0,
      requestKey: vectors.expected.requestKey,
      sourceId: vectors.expected.sourceId,
      amountUnits: vectors.inputs.item.amount,
      registryRevision: vectors.inputs.item.registryRevision,
      expectedPayout: vectors.inputs.item.payout,
      maxUnitPrice: vectors.inputs.item.maxUnitPrice,
      registryReadBlock: '1999998700',
      payloadHash: stablePayloadHash({ token: 'PEPE', window: '1h' }),
      escrowAddress: '0x4444444444444444444444444444444444444444',
      researchKey: vectors.expected.researchKey,
      backend: 'escrow',
      version: 1,
      errorMessage: null,
      createdAt: new Date('2026-07-11T02:00:00.000Z'),
    })
    expect(claimed.entry.requestKey).toBe(deriveRequestKey(input.researchKey, input.paymentIntentId))
    expect(claimed.entry.sourceId).toBe(deriveSourceId(input.source))
  })

  it('reuses the same escrow intent retry but rejects immutable snapshot drift', async () => {
    const repo = new MemoryTxLogRepo()
    const claimableRepo = repo as MemoryTxLogRepo & {
      claimResearchPaymentIntent: (input: ReturnType<typeof escrowIntentInput>) => Promise<{
        status: 'claimed' | 'existing' | 'pending' | 'failed'
        entry: Record<string, unknown>
      }>
    }
    const input = escrowIntentInput()

    const first = await claimableRepo.claimResearchPaymentIntent(input)
    const retry = await claimableRepo.claimResearchPaymentIntent(input)

    expect(retry).toMatchObject({
      status: 'pending',
      entry: {
        id: first.entry.id,
        requestId: vectors.expected.requestKey,
        requestKey: vectors.expected.requestKey,
        paymentIntentId: vectors.inputs.canonicalPaymentIntentId,
        toolOrdinal: 0,
      },
    })
    expect(await repo.listByAddress(input.address)).toHaveLength(1)

    await expect(claimableRepo.claimResearchPaymentIntent({
      ...input,
      maxUnitPrice: '1001',
    })).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
      requestId: vectors.expected.requestKey,
    })

    await expect(claimableRepo.claimResearchPaymentIntent({
      ...input,
      paymentIntentId: '00000000-0000-4000-8000-000000000004',
    })).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
    })
  })

  it('does not let legacy request claiming reuse an escrow payment intent requestKey', async () => {
    const repo = new MemoryTxLogRepo()
    const input = escrowIntentInput()
    await repo.claimResearchPaymentIntent(input)

    await expect(repo.claimRequest({
      address: input.address,
      source: input.source,
      amount: input.amount,
      requestId: vectors.expected.requestKey,
      researchId: input.researchId,
    })).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
      requestId: vectors.expected.requestKey,
    })
  })

  it('rejects escrow intent amounts that cannot be represented as six-decimal USDC units', async () => {
    const repo = new MemoryTxLogRepo() as MemoryTxLogRepo & {
      claimResearchPaymentIntent: (input: ReturnType<typeof escrowIntentInput>) => Promise<unknown>
    }

    await expect(repo.claimResearchPaymentIntent({
      ...escrowIntentInput(),
      amount: '0.00000001',
    })).rejects.toMatchObject({
      code: 'SCALE8_TRUNCATION',
    })
  })
})

function escrowIntentInput() {
  return {
    address: vectors.inputs.buyer,
    researchId: vectors.inputs.canonicalResearchId,
    source: vectors.inputs.source,
    amount: '0.0001',
    paymentIntentId: vectors.inputs.canonicalPaymentIntentId,
    toolOrdinal: 0,
    researchKey: vectors.expected.researchKey,
    escrowAddress: '0x4444444444444444444444444444444444444444',
    registryRevision: vectors.inputs.item.registryRevision,
    expectedPayout: vectors.inputs.item.payout,
    maxUnitPrice: vectors.inputs.item.maxUnitPrice,
    registryReadBlock: '1999998700',
    payload: { window: '1h', token: 'PEPE' },
  }
}

function stablePayloadHash(value: unknown) {
  return keccak256(toBytes(stableStringify(value)))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
