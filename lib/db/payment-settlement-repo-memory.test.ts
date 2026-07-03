import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryPaymentSettlementRepo } from './payment-settlement-repo-memory'

describe('MemoryPaymentSettlementRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('claims one broadcasting settlement for an address and research pair', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    const repo = new MemoryPaymentSettlementRepo()

    const claim = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-1', 'req-2'],
      totalAmount: '0.0004',
    })

    expect(claim.status).toBe('claimed')
    expect(claim.settlement).toMatchObject({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-1', 'req-2'],
      totalAmount: '0.0004',
      status: 'broadcasting',
      txHash: null,
      chainId: null,
      blockNumber: null,
      attempts: 1,
      errorMessage: null,
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
      updatedAt: new Date('2026-07-03T00:00:00.000Z'),
    })
  })

  it('returns an existing in-progress settlement instead of creating a duplicate claim', async () => {
    const repo = new MemoryPaymentSettlementRepo()

    const first = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-1'],
      totalAmount: '0.0003',
    })
    const second = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-1'],
      totalAmount: '0.0003',
    })

    expect(second.status).toBe('existing')
    expect(second.settlement.id).toBe(first.settlement.id)
    expect(await repo.count()).toBe(1)
  })

  it('confirms a settlement with shared receipt metadata', async () => {
    const repo = new MemoryPaymentSettlementRepo()
    const claim = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-1'],
      totalAmount: '0.0003',
    })

    const confirmed = await repo.confirmSettlement(claim.settlement.id, {
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 5_042_002,
      blockNumber: '12345',
    })

    expect(confirmed).toMatchObject({
      id: claim.settlement.id,
      status: 'confirmed',
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 5_042_002,
      blockNumber: '12345',
      errorMessage: null,
    })
  })

  it('marks a settlement failed and preserves the error for retry scans', async () => {
    const repo = new MemoryPaymentSettlementRepo()
    const claim = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-1'],
      totalAmount: '0.0003',
    })

    const failed = await repo.failSettlement(claim.settlement.id, {
      errorMessage: 'RPC timeout',
    })

    expect(failed).toMatchObject({
      id: claim.settlement.id,
      status: 'failed',
      attempts: 1,
      errorMessage: 'RPC timeout',
    })
  })

  it('lists failed and stale broadcasting settlements as retryable but excludes confirmed rows', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    const repo = new MemoryPaymentSettlementRepo()

    const failed = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed',
      requestIds: ['req-failed'],
      totalAmount: '0.0003',
    })
    await repo.failSettlement(failed.settlement.id, { errorMessage: 'RPC timeout' })

    const stale = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-stale',
      requestIds: ['req-stale'],
      totalAmount: '0.0001',
    })

    const confirmed = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-confirmed',
      requestIds: ['req-confirmed'],
      totalAmount: '0.0002',
    })
    await repo.confirmSettlement(confirmed.settlement.id, {
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      chainId: 5_042_002,
      blockNumber: '22222',
    })

    vi.setSystemTime(new Date('2026-07-03T00:10:00.000Z'))
    const retryable = await repo.listRetryableSettlements({
      staleBroadcastingBefore: new Date('2026-07-03T00:05:00.000Z'),
    })

    expect(retryable.map((settlement) => settlement.id)).toEqual(expect.arrayContaining([
      failed.settlement.id,
      stale.settlement.id,
    ]))
    expect(retryable.map((settlement) => settlement.id)).not.toContain(confirmed.settlement.id)
  })

  it('excludes failed settlements with txHash from retryable scans', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    const repo = new MemoryPaymentSettlementRepo()

    const failedWithTxHash = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed-with-txhash',
      requestIds: ['req-failed-with-txhash'],
      totalAmount: '0.0003',
    })
    await repo.failSettlement(failedWithTxHash.settlement.id, {
      errorMessage: 'receipt polling timed out',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      chainId: 5_042_002,
      blockNumber: null,
    })

    vi.setSystemTime(new Date('2026-07-03T00:01:00.000Z'))
    const failedWithoutTxHash = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed-without-txhash',
      requestIds: ['req-failed-without-txhash'],
      totalAmount: '0.0001',
    })
    await repo.failSettlement(failedWithoutTxHash.settlement.id, {
      errorMessage: 'RPC timeout',
    })

    const retryable = await repo.listRetryableSettlements({ limit: 1 })

    expect(retryable.map((settlement) => settlement.id)).toEqual([
      failedWithoutTxHash.settlement.id,
    ])
    expect(retryable.map((settlement) => settlement.id)).not.toContain(failedWithTxHash.settlement.id)
  })

  it('lists retryable settlements oldest updatedAt first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    const repo = new MemoryPaymentSettlementRepo()

    const older = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-older',
      requestIds: ['req-older'],
      totalAmount: '0.0001',
    })

    vi.setSystemTime(new Date('2026-07-03T00:02:00.000Z'))
    const newer = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-newer',
      requestIds: ['req-newer'],
      totalAmount: '0.0002',
    })
    await repo.failSettlement(newer.settlement.id, { errorMessage: 'newer failure' })

    vi.setSystemTime(new Date('2026-07-03T00:10:00.000Z'))
    const retryable = await repo.listRetryableSettlements({
      staleBroadcastingBefore: new Date('2026-07-03T00:05:00.000Z'),
    })

    expect(retryable.map((settlement) => settlement.id)).toEqual([
      older.settlement.id,
      newer.settlement.id,
    ])
  })

  it('lists confirmed settlements for reconciliation scans oldest updatedAt first', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    const repo = new MemoryPaymentSettlementRepo()

    const older = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-confirmed-older',
      requestIds: ['req-older'],
      totalAmount: '0.0001',
    })
    await repo.confirmSettlement(older.settlement.id, {
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      chainId: 5_042_002,
      blockNumber: '11111',
    })

    vi.setSystemTime(new Date('2026-07-03T00:02:00.000Z'))
    const newer = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-confirmed-newer',
      requestIds: ['req-newer'],
      totalAmount: '0.0002',
    })
    await repo.confirmSettlement(newer.settlement.id, {
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      chainId: 5_042_002,
      blockNumber: '22222',
    })

    const failed = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed',
      requestIds: ['req-failed'],
      totalAmount: '0.0003',
    })
    await repo.failSettlement(failed.settlement.id, { errorMessage: 'RPC timeout' })

    const confirmed = await repo.listConfirmedSettlementsNeedingReconcile({ limit: 2 })

    expect(confirmed.map((settlement) => settlement.id)).toEqual([
      older.settlement.id,
      newer.settlement.id,
    ])
    expect(confirmed.map((settlement) => settlement.id)).not.toContain(failed.settlement.id)
  })

  it('claims a failed or stale broadcasting settlement for retry and increments attempts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-03T00:00:00.000Z'))
    const repo = new MemoryPaymentSettlementRepo()

    const failed = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed',
      requestIds: ['req-failed'],
      totalAmount: '0.0003',
    })
    await repo.failSettlement(failed.settlement.id, { errorMessage: 'RPC timeout' })

    const stale = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-stale',
      requestIds: ['req-stale'],
      totalAmount: '0.0001',
    })

    vi.setSystemTime(new Date('2026-07-03T00:10:00.000Z'))
    const failedRetry = await repo.claimRetryableSettlement(failed.settlement.id, {
      staleBroadcastingBefore: new Date('2026-07-03T00:05:00.000Z'),
    })
    const staleRetry = await repo.claimRetryableSettlement(stale.settlement.id, {
      staleBroadcastingBefore: new Date('2026-07-03T00:05:00.000Z'),
    })

    expect(failedRetry).toMatchObject({
      status: 'claimed',
      settlement: {
        id: failed.settlement.id,
        status: 'broadcasting',
        attempts: 2,
        errorMessage: null,
      },
    })
    expect(staleRetry).toMatchObject({
      status: 'claimed',
      settlement: {
        id: stale.settlement.id,
        status: 'broadcasting',
        attempts: 2,
      },
    })
  })

  it('does not reclaim a failed settlement that already has a txHash', async () => {
    const repo = new MemoryPaymentSettlementRepo()
    const claim = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed-with-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })
    await repo.failSettlement(claim.settlement.id, {
      errorMessage: 'receipt polling timed out',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      chainId: 5_042_002,
      blockNumber: null,
    })

    const reclaim = await repo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-failed-with-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })

    expect(reclaim).toMatchObject({
      status: 'existing',
      settlement: {
        id: claim.settlement.id,
        status: 'failed',
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 5_042_002,
        blockNumber: null,
        attempts: 1,
      },
    })
  })
})
