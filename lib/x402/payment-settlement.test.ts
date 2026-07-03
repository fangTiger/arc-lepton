import { describe, expect, it, vi } from 'vitest'
import { MemoryPaymentSettlementRepo } from '@/lib/db/payment-settlement-repo-memory'
import type { TxLogRepo } from '@/lib/db/tx-log-repo'
import { MemoryTxLogRepo } from '@/lib/db/tx-log-repo-memory'
import {
  reconcileResearchSettlement,
  retryResearchSettlements,
  settleResearchPayments,
} from './payment-settlement'

describe('settleResearchPayments', () => {
  it('skips ARC settlement when the research has no pending payment intents', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    const recordArcResearchSettlement = vi.fn()

    const result = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-empty' },
      { txLogRepo, paymentSettlementRepo, recordArcResearchSettlement },
    )

    expect(result).toEqual({
      status: 'skipped',
      reason: 'no_pending',
      settledCount: 0,
    })
    expect(recordArcResearchSettlement).not.toHaveBeenCalled()
    expect(await paymentSettlementRepo.count()).toBe(0)
  })

  it('settles multiple pending intents for one research with a single ARC call', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    await txLogRepo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-sentiment',
      txStatus: 'pending',
    })
    const recordArcResearchSettlement = vi.fn().mockResolvedValue({
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
    })

    const result = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-1' },
      {
        txLogRepo,
        paymentSettlementRepo,
        recordArcResearchSettlement,
        now: () => new Date('2026-07-03T00:00:00.000Z'),
      },
    )

    expect(recordArcResearchSettlement).toHaveBeenCalledTimes(1)
    expect(recordArcResearchSettlement).toHaveBeenCalledWith(expect.objectContaining({
      buyer: '0xabc',
      researchId: 'research-1',
      totalAmount: '0.0004',
      items: [
        { requestId: 'req-sentiment', source: 'sentiment', amount: '0.0001' },
        { requestId: 'req-news', source: 'news', amount: '0.0003' },
      ],
      createdAt: '2026-07-03T00:00:00.000Z',
    }))
    expect(result).toMatchObject({
      status: 'confirmed',
      settledCount: 2,
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })

    const entries = await txLogRepo.listByResearchId('0xabc', 'research-1', 10)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestId: 'req-news',
        txStatus: 'confirmed',
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 5_042_002,
        blockNumber: '12345',
        settlementId: expect.any(String),
      }),
      expect.objectContaining({
        requestId: 'req-sentiment',
        txStatus: 'confirmed',
        txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        chainId: 5_042_002,
        blockNumber: '12345',
        settlementId: expect.any(String),
      }),
    ]))
  })

  it('marks all pending intents failed when ARC settlement fails', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    await txLogRepo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-sentiment',
      txStatus: 'pending',
    })
    const recordArcResearchSettlement = vi.fn().mockRejectedValue(new Error('RPC timeout'))

    const result = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-1' },
      { txLogRepo, paymentSettlementRepo, recordArcResearchSettlement },
    )

    expect(result).toMatchObject({
      status: 'failed',
      settledCount: 2,
      errorMessage: 'RPC timeout',
    })
    const entries = await txLogRepo.listByResearchId('0xabc', 'research-1', 10)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestId: 'req-news',
        txStatus: 'failed',
        txHash: null,
        errorMessage: 'RPC timeout',
        settlementId: expect.any(String),
      }),
      expect.objectContaining({
        requestId: 'req-sentiment',
        txStatus: 'failed',
        txHash: null,
        errorMessage: 'RPC timeout',
        settlementId: expect.any(String),
      }),
    ]))
  })

  it('does not rebroadcast when another worker already claimed the research settlement', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const existing = await paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })
    const recordArcResearchSettlement = vi.fn()

    const result = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-1' },
      { txLogRepo, paymentSettlementRepo, recordArcResearchSettlement },
    )

    expect(result).toEqual({
      status: 'in_progress',
      settlementId: existing.settlement.id,
      settledCount: 1,
    })
    expect(recordArcResearchSettlement).not.toHaveBeenCalled()
    expect(await paymentSettlementRepo.count()).toBe(1)
  })

  it('retries a failed settlement and confirms the failed tx_log rows with the new shared txHash', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    await txLogRepo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-sentiment',
      txStatus: 'pending',
    })
    await settleResearchPayments(
      { address: '0xabc', researchId: 'research-1' },
      {
        txLogRepo,
        paymentSettlementRepo,
        recordArcResearchSettlement: vi.fn().mockRejectedValue(new Error('RPC timeout')),
      },
    )
    const recordArcResearchSettlement = vi.fn().mockResolvedValue({
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '54321',
    })

    const result = await retryResearchSettlements({
      txLogRepo,
      paymentSettlementRepo,
      recordArcResearchSettlement,
      now: () => new Date('2026-07-03T00:15:00.000Z'),
    })

    expect(result).toMatchObject({
      attempted: 1,
      results: [
        {
          status: 'confirmed',
          settledCount: 2,
          txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
      ],
    })
    expect(recordArcResearchSettlement).toHaveBeenCalledTimes(1)
    expect(recordArcResearchSettlement).toHaveBeenCalledWith(expect.objectContaining({
      buyer: '0xabc',
      researchId: 'research-1',
      totalAmount: '0.0004',
      items: [
        { requestId: 'req-sentiment', source: 'sentiment', amount: '0.0001' },
        { requestId: 'req-news', source: 'news', amount: '0.0003' },
      ],
      createdAt: '2026-07-03T00:15:00.000Z',
    }))
    const entries = await txLogRepo.listByResearchId('0xabc', 'research-1', 10)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        requestId: 'req-news',
        txStatus: 'confirmed',
        txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        chainId: 5_042_002,
        blockNumber: '54321',
      }),
      expect.objectContaining({
        requestId: 'req-sentiment',
        txStatus: 'confirmed',
        txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        chainId: 5_042_002,
        blockNumber: '54321',
      }),
    ]))
  })

  it('does not rebroadcast a stale broadcasting settlement without persisted receipt metadata', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-stale',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const claimed = await paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-stale',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })
    const recordArcResearchSettlement = vi.fn().mockRejectedValue(new Error('duplicate broadcast must not happen'))

    const result = await retryResearchSettlements({
      txLogRepo,
      paymentSettlementRepo,
      recordArcResearchSettlement,
      staleBroadcastingBefore: new Date(Date.now() + 1_000),
    })

    expect(result.results).toEqual([
      expect.objectContaining({
        status: 'needs_manual_recovery',
        settlementId: claimed.settlement.id,
        settledCount: 1,
      }),
    ])
    expect(recordArcResearchSettlement).not.toHaveBeenCalled()
    await expect(paymentSettlementRepo.findById(claimed.settlement.id)).resolves.toMatchObject({
      status: 'failed',
      txHash: null,
      errorMessage: expect.stringContaining('manual recovery required'),
    })
    const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-stale', 10)
    expect(entry).toMatchObject({
      requestId: 'req-news',
      txStatus: 'pending',
      txHash: null,
      settlementId: null,
    })
  })

  it('retryResearchSettlements reconciles confirmed settlements that still have pending tx_log rows', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-confirmed-pending-retry',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const claim = await paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-confirmed-pending-retry',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })
    await paymentSettlementRepo.confirmSettlement(claim.settlement.id, {
      txHash: '0x1212121212121212121212121212121212121212121212121212121212121212',
      chainId: 5_042_002,
      blockNumber: '121212',
    })
    const recordArcResearchSettlement = vi.fn()

    const result = await retryResearchSettlements({
      txLogRepo,
      paymentSettlementRepo,
      recordArcResearchSettlement,
    })

    expect(result).toMatchObject({
      attempted: 1,
      results: [
        {
          status: 'reconciled',
          settlementId: claim.settlement.id,
          settledCount: 1,
        },
      ],
    })
    expect(recordArcResearchSettlement).not.toHaveBeenCalled()
    const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-confirmed-pending-retry', 10)
    expect(entry).toMatchObject({
      requestId: 'req-news',
      txStatus: 'confirmed',
      txHash: '0x1212121212121212121212121212121212121212121212121212121212121212',
      chainId: 5_042_002,
      blockNumber: '121212',
      settlementId: claim.settlement.id,
    })
  })

  it('does not include a failed settlement that already has a txHash in automatic retry scans', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-failed-with-txhash',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const arcError = Object.assign(new Error('receipt polling timed out'), {
      txHash: '0x3434343434343434343434343434343434343434343434343434343434343434',
      chainId: 5_042_002,
      blockNumber: null,
    })
    const initial = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-failed-with-txhash' },
      {
        txLogRepo,
        paymentSettlementRepo,
        recordArcResearchSettlement: vi.fn().mockRejectedValue(arcError),
      },
    )
    expect(initial).toMatchObject({
      status: 'failed',
      settlementId: expect.any(String),
    })
    if (initial.status !== 'failed') throw new Error('expected failed initial settlement')
    await expect(paymentSettlementRepo.findById(initial.settlementId)).resolves.toMatchObject({
      status: 'failed',
      txHash: '0x3434343434343434343434343434343434343434343434343434343434343434',
      errorMessage: 'receipt polling timed out',
    })
    const retryArcRecorder = vi.fn().mockResolvedValue({
      txHash: '0x5656565656565656565656565656565656565656565656565656565656565656',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '565656',
    })

    const retry = await retryResearchSettlements({
      txLogRepo,
      paymentSettlementRepo,
      recordArcResearchSettlement: retryArcRecorder,
    })

    expect(retryArcRecorder).not.toHaveBeenCalled()
    expect(retry.results).toEqual([])
    await expect(paymentSettlementRepo.findById(initial.settlementId)).resolves.toMatchObject({
      status: 'failed',
      txHash: '0x3434343434343434343434343434343434343434343434343434343434343434',
      chainId: 5_042_002,
      blockNumber: null,
      errorMessage: 'receipt polling timed out',
    })
  })

  it('settleResearchPayments does not reclaim or rebroadcast a failed settlement that already has a txHash', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-direct-failed-with-txhash',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const claim = await paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-direct-failed-with-txhash',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })
    await paymentSettlementRepo.failSettlement(claim.settlement.id, {
      errorMessage: 'receipt polling timed out',
      txHash: '0x7878787878787878787878787878787878787878787878787878787878787878',
      chainId: 5_042_002,
      blockNumber: null,
    })
    const recordArcResearchSettlement = vi.fn().mockResolvedValue({
      txHash: '0x9999999999999999999999999999999999999999999999999999999999999999',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '999999',
    })

    const result = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-direct-failed-with-txhash' },
      { txLogRepo, paymentSettlementRepo, recordArcResearchSettlement },
    )

    expect(result).toMatchObject({
      status: 'needs_manual_recovery',
      settlementId: claim.settlement.id,
      settledCount: 1,
    })
    expect(recordArcResearchSettlement).not.toHaveBeenCalled()
    await expect(paymentSettlementRepo.findById(claim.settlement.id)).resolves.toMatchObject({
      status: 'failed',
      txHash: '0x7878787878787878787878787878787878787878787878787878787878787878',
      chainId: 5_042_002,
      blockNumber: null,
      errorMessage: expect.stringContaining('manual recovery required'),
    })
  })

  it('retryResearchSettlements reconciles confirmed pending rows even when manual recovery rows fill the retry limit', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()

    for (let index = 0; index < 2; index += 1) {
      const researchId = `research-manual-${index}`
      const requestId = `req-manual-${index}`
      await txLogRepo.record({
        address: '0xabc',
        source: 'news',
        amount: '0.0001',
        researchId,
        requestId,
        txStatus: 'pending',
      })
      const manualClaim = await paymentSettlementRepo.claimResearchSettlement({
        address: '0xabc',
        researchId,
        requestIds: [requestId],
        totalAmount: '0.0001',
      })
      await paymentSettlementRepo.failSettlement(manualClaim.settlement.id, {
        errorMessage: 'receipt polling timed out',
        txHash: `0x${(index + 70).toString(16).padStart(64, '0')}`,
        chainId: 5_042_002,
        blockNumber: null,
      })
    }

    await txLogRepo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0003',
      researchId: 'research-confirmed-after-manual',
      requestId: 'req-confirmed-after-manual',
      txStatus: 'pending',
    })
    const pendingClaim = await paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-confirmed-after-manual',
      requestIds: ['req-confirmed-after-manual'],
      totalAmount: '0.0003',
    })
    await paymentSettlementRepo.confirmSettlement(pendingClaim.settlement.id, {
      txHash: '0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef',
      chainId: 5_042_002,
      blockNumber: '707070',
    })

    const result = await retryResearchSettlements({
      txLogRepo,
      paymentSettlementRepo,
      recordArcResearchSettlement: vi.fn(),
      limit: 1,
    })

    expect(result.results).toEqual([
      expect.objectContaining({
        status: 'reconciled',
        settlementId: pendingClaim.settlement.id,
        settledCount: 1,
      }),
    ])
    const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-confirmed-after-manual', 10)
    expect(entry).toMatchObject({
      requestId: 'req-confirmed-after-manual',
      txStatus: 'confirmed',
      txHash: '0xefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef',
      settlementId: pendingClaim.settlement.id,
    })
  })

  it('retryResearchSettlements skips manual recovery rows when selecting automatic retry work', async () => {
    vi.useFakeTimers()
    try {
      const txLogRepo = new MemoryTxLogRepo()
      const paymentSettlementRepo = new MemoryPaymentSettlementRepo()

      for (let index = 0; index < 2; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 6, 3, 0, 0, index)))
        const researchId = `research-manual-retryable-${index}`
        const requestId = `req-manual-retryable-${index}`
        await txLogRepo.record({
          address: '0xabc',
          source: 'news',
          amount: '0.0001',
          researchId,
          requestId,
          txStatus: 'pending',
        })
        const manualClaim = await paymentSettlementRepo.claimResearchSettlement({
          address: '0xabc',
          researchId,
          requestIds: [requestId],
          totalAmount: '0.0001',
        })
        await paymentSettlementRepo.failSettlement(manualClaim.settlement.id, {
          errorMessage: 'manual recovery required: failed settlement already has an ARC txHash',
          txHash: `0x${(index + 80).toString(16).padStart(64, '0')}`,
          chainId: 5_042_002,
          blockNumber: null,
        })
      }

      vi.setSystemTime(new Date('2026-07-03T00:01:00.000Z'))
      await txLogRepo.record({
        address: '0xabc',
        source: 'sentiment',
        amount: '0.0003',
        researchId: 'research-auto-retry-after-manual',
        requestId: 'req-auto-retry',
        txStatus: 'pending',
      })
      const autoRetryClaim = await paymentSettlementRepo.claimResearchSettlement({
        address: '0xabc',
        researchId: 'research-auto-retry-after-manual',
        requestIds: ['req-auto-retry'],
        totalAmount: '0.0003',
      })
      await paymentSettlementRepo.failSettlement(autoRetryClaim.settlement.id, {
        errorMessage: 'RPC timeout',
      })

      const recordArcResearchSettlement = vi.fn().mockResolvedValue({
        txHash: '0x4545454545454545454545454545454545454545454545454545454545454545',
        txStatus: 'confirmed',
        chainId: 5_042_002,
        blockNumber: '454545',
      })

      const result = await retryResearchSettlements({
        txLogRepo,
        paymentSettlementRepo,
        recordArcResearchSettlement,
        limit: 1,
        now: () => new Date('2026-07-03T00:02:00.000Z'),
      })

      expect(recordArcResearchSettlement).toHaveBeenCalledTimes(1)
      expect(recordArcResearchSettlement).toHaveBeenCalledWith(expect.objectContaining({
        researchId: 'research-auto-retry-after-manual',
        totalAmount: '0.0003',
      }))
      expect(result).toMatchObject({
        attempted: 1,
        results: [
          {
            status: 'confirmed',
            settlementId: autoRetryClaim.settlement.id,
            settledCount: 1,
            txHash: '0x4545454545454545454545454545454545454545454545454545454545454545',
          },
        ],
      })
      const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-auto-retry-after-manual', 10)
      expect(entry).toMatchObject({
        requestId: 'req-auto-retry',
        txStatus: 'confirmed',
        txHash: '0x4545454545454545454545454545454545454545454545454545454545454545',
        settlementId: autoRetryClaim.settlement.id,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retryResearchSettlements skips failed settlements with txHash when selecting automatic retry work', async () => {
    vi.useFakeTimers()
    try {
      const txLogRepo = new MemoryTxLogRepo()
      const paymentSettlementRepo = new MemoryPaymentSettlementRepo()

      for (let index = 0; index < 2; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 6, 3, 0, 0, index)))
        const researchId = `research-failed-txhash-retryable-${index}`
        const requestId = `req-failed-txhash-retryable-${index}`
        await txLogRepo.record({
          address: '0xabc',
          source: 'news',
          amount: '0.0001',
          researchId,
          requestId,
          txStatus: 'pending',
        })
        const failedWithTxHash = await paymentSettlementRepo.claimResearchSettlement({
          address: '0xabc',
          researchId,
          requestIds: [requestId],
          totalAmount: '0.0001',
        })
        await paymentSettlementRepo.failSettlement(failedWithTxHash.settlement.id, {
          errorMessage: 'receipt polling timed out',
          txHash: `0x${(index + 90).toString(16).padStart(64, '0')}`,
          chainId: 5_042_002,
          blockNumber: null,
        })
      }

      vi.setSystemTime(new Date('2026-07-03T00:01:00.000Z'))
      await txLogRepo.record({
        address: '0xabc',
        source: 'sentiment',
        amount: '0.0003',
        researchId: 'research-auto-retry-after-txhash',
        requestId: 'req-auto-retry-after-txhash',
        txStatus: 'pending',
      })
      const autoRetryClaim = await paymentSettlementRepo.claimResearchSettlement({
        address: '0xabc',
        researchId: 'research-auto-retry-after-txhash',
        requestIds: ['req-auto-retry-after-txhash'],
        totalAmount: '0.0003',
      })
      await paymentSettlementRepo.failSettlement(autoRetryClaim.settlement.id, {
        errorMessage: 'RPC timeout',
      })

      const recordArcResearchSettlement = vi.fn().mockResolvedValue({
        txHash: '0x4646464646464646464646464646464646464646464646464646464646464646',
        txStatus: 'confirmed',
        chainId: 5_042_002,
        blockNumber: '464646',
      })

      const result = await retryResearchSettlements({
        txLogRepo,
        paymentSettlementRepo,
        recordArcResearchSettlement,
        limit: 1,
        now: () => new Date('2026-07-03T00:02:00.000Z'),
      })

      expect(recordArcResearchSettlement).toHaveBeenCalledTimes(1)
      expect(recordArcResearchSettlement).toHaveBeenCalledWith(expect.objectContaining({
        researchId: 'research-auto-retry-after-txhash',
        totalAmount: '0.0003',
      }))
      expect(result).toMatchObject({
        attempted: 1,
        results: [
          {
            status: 'confirmed',
            settlementId: autoRetryClaim.settlement.id,
            settledCount: 1,
            txHash: '0x4646464646464646464646464646464646464646464646464646464646464646',
          },
        ],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('retryResearchSettlements scans past more than 1000 clean confirmed settlements to reconcile later pending tx_log rows', async () => {
    vi.useFakeTimers()
    try {
      const txLogRepo = new MemoryTxLogRepo()
      const paymentSettlementRepo = new MemoryPaymentSettlementRepo()

      for (let index = 0; index < 1_005; index += 1) {
        const suffix = index.toString().padStart(2, '0')
        vi.setSystemTime(new Date(Date.UTC(2026, 6, 3, 0, 0, 0, index)))
        const researchId = `research-clean-${suffix}`
        const requestId = `req-clean-${suffix}`
        await txLogRepo.record({
          address: '0xabc',
          source: 'news',
          amount: '0.0001',
          researchId,
          requestId,
          txStatus: 'pending',
        })
        const cleanClaim = await paymentSettlementRepo.claimResearchSettlement({
          address: '0xabc',
          researchId,
          requestIds: [requestId],
          totalAmount: '0.0001',
        })
        const txHash = `0x${(index + 1).toString(16).padStart(64, '0')}`
        await paymentSettlementRepo.confirmSettlement(cleanClaim.settlement.id, {
          txHash,
          chainId: 5_042_002,
          blockNumber: `${10_000 + index}`,
        })
        await txLogRepo.markResearchSettlementConfirmed({
          address: '0xabc',
          researchId,
          requestIds: [requestId],
          settlementId: cleanClaim.settlement.id,
          txHash,
          txStatus: 'confirmed',
          chainId: 5_042_002,
          blockNumber: `${10_000 + index}`,
        })
      }

      vi.setSystemTime(new Date('2026-07-03T00:01:00.000Z'))
      await txLogRepo.record({
        address: '0xabc',
        source: 'sentiment',
        amount: '0.0003',
        researchId: 'research-late-unreconciled',
        requestId: 'req-late',
        txStatus: 'pending',
      })
      const pendingClaim = await paymentSettlementRepo.claimResearchSettlement({
        address: '0xabc',
        researchId: 'research-late-unreconciled',
        requestIds: ['req-late'],
        totalAmount: '0.0003',
      })
      await paymentSettlementRepo.confirmSettlement(pendingClaim.settlement.id, {
        txHash: '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        chainId: 5_042_002,
        blockNumber: '60000',
      })

      const result = await retryResearchSettlements({
        txLogRepo,
        paymentSettlementRepo,
        recordArcResearchSettlement: vi.fn(),
        limit: 1,
      })

      expect(result).toMatchObject({
        attempted: 1,
        results: [
          {
            status: 'reconciled',
            settlementId: pendingClaim.settlement.id,
            settledCount: 1,
          },
        ],
      })
      const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-late-unreconciled', 10)
      expect(entry).toMatchObject({
        requestId: 'req-late',
        txStatus: 'confirmed',
        txHash: '0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
        settlementId: pendingClaim.settlement.id,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not blindly rebroadcast when confirmSettlement fails after ARC returned a receipt', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-confirm-persist-failure',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const originalConfirmSettlement = paymentSettlementRepo.confirmSettlement.bind(paymentSettlementRepo)
    let confirmAttempts = 0
    const confirmSettlement = vi.fn(async (...args: Parameters<typeof paymentSettlementRepo.confirmSettlement>) => {
      confirmAttempts += 1
      if (confirmAttempts === 1) throw new Error('settlement confirm write failed')
      return originalConfirmSettlement(...args)
    })
    const failSettlement = vi.spyOn(paymentSettlementRepo, 'failSettlement')
    const guardedPaymentSettlementRepo = new Proxy(paymentSettlementRepo, {
      get(target, prop, receiver) {
        if (prop === 'confirmSettlement') return confirmSettlement
        const value = Reflect.get(target, prop, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const initialArcRecorder = vi.fn().mockResolvedValue({
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '99999',
    })

    const error = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-confirm-persist-failure' },
      {
        txLogRepo,
        paymentSettlementRepo: guardedPaymentSettlementRepo,
        recordArcResearchSettlement: initialArcRecorder,
      },
    ).then(
      () => {
        throw new Error('expected settlement confirm persistence failure')
      },
      (caught: unknown) => caught as { code: string; settlementId: string },
    )

    expect(error).toMatchObject({
      code: 'SETTLEMENT_CONFIRM_PERSIST_FAILED',
      settlementId: expect.any(String),
    })
    expect(initialArcRecorder).toHaveBeenCalledTimes(1)
    expect(failSettlement).not.toHaveBeenCalled()
    await expect(paymentSettlementRepo.findById(error.settlementId)).resolves.toMatchObject({
      status: 'broadcasting',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      chainId: 5_042_002,
      blockNumber: '99999',
    })

    const retryArcRecorder = vi.fn().mockRejectedValue(new Error('duplicate broadcast must not happen'))
    const retry = await retryResearchSettlements({
      txLogRepo,
      paymentSettlementRepo: guardedPaymentSettlementRepo,
      recordArcResearchSettlement: retryArcRecorder,
      staleBroadcastingBefore: new Date(Date.now() + 60_000),
    })

    expect(retryArcRecorder).not.toHaveBeenCalled()
    expect(retry.results).toEqual([
      expect.objectContaining({
        status: 'confirmed',
        settlementId: error.settlementId,
        txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      }),
    ])
    const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-confirm-persist-failure', 10)
    expect(entry).toMatchObject({
      requestId: 'req-news',
      txStatus: 'confirmed',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      settlementId: error.settlementId,
    })
  })

  it('reconciles an existing confirmed settlement when pending tx_log rows still exist', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-existing-confirmed',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const claim = await paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-existing-confirmed',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })
    await paymentSettlementRepo.confirmSettlement(claim.settlement.id, {
      txHash: '0xabababababababababababababababababababababababababababababababab',
      chainId: 5_042_002,
      blockNumber: '123456',
    })
    const recordArcResearchSettlement = vi.fn()

    const result = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-existing-confirmed' },
      { txLogRepo, paymentSettlementRepo, recordArcResearchSettlement },
    )

    expect(result).toMatchObject({
      status: 'reconciled',
      settlementId: claim.settlement.id,
      settledCount: 1,
    })
    expect(recordArcResearchSettlement).not.toHaveBeenCalled()
    const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-existing-confirmed', 10)
    expect(entry).toMatchObject({
      requestId: 'req-news',
      txStatus: 'confirmed',
      txHash: '0xabababababababababababababababababababababababababababababababab',
      chainId: 5_042_002,
      blockNumber: '123456',
      settlementId: claim.settlement.id,
    })
  })

  it('does not mark settlement or tx_log failed when local confirmation persistence fails after ARC success', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-local-failure',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const markResearchSettlementConfirmed = vi.fn(async () => {
      throw new Error('database write failed')
    })
    const markResearchSettlementFailed = vi.fn(txLogRepo.markResearchSettlementFailed.bind(txLogRepo))
    const guardedTxLogRepo = new Proxy(txLogRepo, {
      get(target, prop, receiver) {
        if (prop === 'markResearchSettlementConfirmed') return markResearchSettlementConfirmed
        if (prop === 'markResearchSettlementFailed') return markResearchSettlementFailed
        const value = Reflect.get(target, prop, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as TxLogRepo
    const failSettlement = vi.spyOn(paymentSettlementRepo, 'failSettlement')

    const error = await settleResearchPayments(
      { address: '0xabc', researchId: 'research-local-failure' },
      {
        txLogRepo: guardedTxLogRepo,
        paymentSettlementRepo,
        recordArcResearchSettlement: vi.fn().mockResolvedValue({
          txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          txStatus: 'confirmed',
          chainId: 5_042_002,
          blockNumber: '77777',
        }),
      },
    ).then(
      () => {
        throw new Error('expected local reconciliation failure')
      },
      (caught: unknown) => caught as { code: string; settlementId: string },
    )

    expect(error).toMatchObject({
      code: 'PAYMENT_SETTLEMENT_RECONCILE_FAILED',
      settlementId: expect.any(String),
    })
    expect(failSettlement).not.toHaveBeenCalled()
    expect(markResearchSettlementFailed).not.toHaveBeenCalled()
    await expect(paymentSettlementRepo.findById(error.settlementId)).resolves.toMatchObject({
      status: 'confirmed',
      txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    })
    const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-local-failure', 10)
    expect(entry).toMatchObject({
      requestId: 'req-news',
      txStatus: 'pending',
      txHash: null,
      errorMessage: null,
    })
  })

  it('reconciles tx_log rows from an already confirmed settlement without rebroadcasting ARC', async () => {
    const txLogRepo = new MemoryTxLogRepo()
    const paymentSettlementRepo = new MemoryPaymentSettlementRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-reconcile',
      requestId: 'req-news',
      txStatus: 'pending',
    })
    const claim = await paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-reconcile',
      requestIds: ['req-news'],
      totalAmount: '0.0003',
    })
    await paymentSettlementRepo.confirmSettlement(claim.settlement.id, {
      txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      chainId: 5_042_002,
      blockNumber: '88888',
    })
    const recordArcResearchSettlement = vi.fn()

    const result = await reconcileResearchSettlement(claim.settlement.id, {
      txLogRepo,
      paymentSettlementRepo,
      recordArcResearchSettlement,
    })

    expect(result).toMatchObject({
      status: 'reconciled',
      settlementId: claim.settlement.id,
      settledCount: 1,
    })
    expect(recordArcResearchSettlement).not.toHaveBeenCalled()
    const [entry] = await txLogRepo.listByResearchId('0xabc', 'research-reconcile', 10)
    expect(entry).toMatchObject({
      requestId: 'req-news',
      txStatus: 'confirmed',
      txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      chainId: 5_042_002,
      blockNumber: '88888',
      settlementId: claim.settlement.id,
    })
  })
})
