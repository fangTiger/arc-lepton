import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryTxLogRepo } from './tx-log-repo-memory'

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
})
