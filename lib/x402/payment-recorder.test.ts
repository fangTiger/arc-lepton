import { describe, expect, it, vi } from 'vitest'
import { keccak256, toBytes } from 'viem'
import { requestKey as deriveRequestKey, sourceId as deriveSourceId } from '@/lib/chain/canonical'
import { MemoryTxLogRepo } from '@/lib/db/tx-log-repo-memory'
import vectors from '../../contracts/test/vectors/canonical-vectors.json'

describe('payment-recorder', () => {
  it('records mock receipts without broadcasting', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const recordArcReceipt = vi.fn().mockResolvedValue({
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      txStatus: 'mock',
      chainId: null,
      blockNumber: null,
      requestId: 'req-mock',
    })

    const payment = await recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'sentiment',
        amount: '0.0001',
        mode: 'mock',
      },
      {
        txLogRepo,
        recordArcReceipt,
        createRequestId: () => 'req-mock',
        now: () => new Date('2026-06-27T00:00:00.000Z'),
      },
    )

    expect(recordArcReceipt).toHaveBeenCalledWith(expect.objectContaining({
      buyer: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      requestId: 'req-mock',
      mode: 'mock',
      createdAt: '2026-06-27T00:00:00.000Z',
    }))
    expect(payment).toMatchObject({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      txStatus: 'mock',
      chainId: null,
      blockNumber: null,
      requestId: 'req-mock',
      errorMessage: null,
    })
  })

  it('records confirmed ARC receipts when on-chain recording succeeds', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const recordArcReceipt = vi.fn().mockResolvedValue({
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-arc',
    })

    const payment = await recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        mode: 'arc',
        researchId: 'research-1',
      },
      {
        txLogRepo,
        recordArcReceipt,
        createRequestId: () => 'req-arc',
        now: () => new Date('2026-06-27T00:00:00.000Z'),
      },
    )

    expect(payment).toMatchObject({
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-arc',
      errorMessage: null,
    })

    const [entry] = await txLogRepo.listByAddress('0xabc')
    expect(entry).toMatchObject({
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-arc',
    })
  })

  it('claims a pending receipt before broadcasting and confirms the same record on success', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    let pendingEntryId: string | null = null
    const recordArcReceipt = vi.fn(async () => {
      const pending = await txLogRepo.findByRequestId('0xabc', 'req-claimed')
      pendingEntryId = pending?.id ?? null
      expect(pending).toMatchObject({
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        txHash: null,
        txStatus: 'pending',
        requestId: 'req-claimed',
        researchId: 'research-1',
        errorMessage: null,
      })

      return {
        txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        txStatus: 'confirmed' as const,
        chainId: 5_042_002,
        blockNumber: '67890',
        requestId: 'req-claimed',
      }
    })

    const payment = await recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        requestId: 'req-claimed',
        researchId: 'research-1',
        mode: 'arc',
      },
      {
        txLogRepo,
        recordArcReceipt,
        now: () => new Date('2026-06-27T00:00:00.000Z'),
      },
    )

    expect(payment).toMatchObject({
      id: pendingEntryId,
      txHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '67890',
      requestId: 'req-claimed',
      researchId: 'research-1',
      errorMessage: null,
    })
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it('reuses an existing receipt for the same address and requestId without rebroadcasting', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const existing = await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-existing',
    })
    const recordArcReceipt = vi.fn()

    const payment = await recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        requestId: 'req-existing',
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )

    expect(payment).toEqual(existing)
    expect(recordArcReceipt).not.toHaveBeenCalled()
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it('rejects an already-aborted signal before claiming or broadcasting any receipt', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const recordArcReceipt = vi.fn()
    const abortController = new AbortController()
    abortController.abort()

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        mode: 'arc',
        signal: abortController.signal,
      } as never,
      {
        txLogRepo,
        recordArcReceipt,
      },
    )).rejects.toThrow('Research cancelled')

    expect(recordArcReceipt).not.toHaveBeenCalled()
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(0)
  })

  it('does not mark a receipt successful when cancellation lands after the ARC recorder returns', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const abortController = new AbortController()
    const recordArcReceipt = vi.fn(async () => {
      abortController.abort()
      return {
        txHash: '0xabababababababababababababababababababababababababababababababab',
        txStatus: 'confirmed' as const,
        chainId: 5_042_002,
        blockNumber: '12345',
        requestId: 'req-abort-after-record',
      }
    })

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        requestId: 'req-abort-after-record',
        mode: 'arc',
        signal: abortController.signal,
      } as never,
      {
        txLogRepo,
        recordArcReceipt,
      },
    )).rejects.toThrow('Research cancelled')

    expect(recordArcReceipt).toHaveBeenCalledTimes(1)
    const [entry] = await txLogRepo.listByAddress('0xabc')
    expect(entry).toMatchObject({
      requestId: 'req-abort-after-record',
      txHash: null,
      txStatus: 'pending',
      chainId: null,
      blockNumber: null,
      errorMessage: null,
    })
  })

  it.each([
    'invalid/key',
    'a'.repeat(129),
    '',
    '   ',
    ' req-with-space ',
  ])('rejects an explicit invalid requestId (%s) before broadcasting or writing any receipt', async (requestId) => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const recordArcReceipt = vi.fn()

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        requestId,
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_KEY_INVALID',
    })

    expect(recordArcReceipt).not.toHaveBeenCalled()
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(0)
  })

  it('rejects reusing the same requestId for a different payment scope without rebroadcasting', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    await recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'news',
        amount: '0.0003',
        requestId: 'req-conflict',
        researchId: 'research-1',
        mode: 'arc',
      },
      {
        txLogRepo,
        recordArcReceipt: vi.fn().mockResolvedValue({
          txHash: '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          txStatus: 'confirmed',
          chainId: 5_042_002,
          blockNumber: '12345',
          requestId: 'req-conflict',
        }),
      },
    )
    const recordArcReceipt = vi.fn()

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'sentiment',
        amount: '0.0001',
        requestId: 'req-conflict',
        researchId: 'research-2',
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
      requestId: 'req-conflict',
    })

    expect(recordArcReceipt).not.toHaveBeenCalled()
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it('rethrows an existing failed receipt for the same address and requestId without rebroadcasting', async () => {
    const { PaymentReceiptError, recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    await txLogRepo.record({
      address: '0xabc',
      source: 'whale-watch',
      amount: '0.0002',
      txStatus: 'failed',
      requestId: 'req-failed-existing',
      errorMessage: 'RPC timeout',
    })
    const recordArcReceipt = vi.fn()

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'whale-watch',
        amount: '0.0002',
        requestId: 'req-failed-existing',
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )).rejects.toMatchObject({
      code: 'PAYMENT_RECEIPT_FAILED',
      requestId: 'req-failed-existing',
    })

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'whale-watch',
        amount: '0.0002',
        requestId: 'req-failed-existing',
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )).rejects.toBeInstanceOf(PaymentReceiptError)
    expect(recordArcReceipt).not.toHaveBeenCalled()
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it('allows only one claimant to broadcast while the matching request is still pending', async () => {
    const { recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    let releaseFirstBroadcast: () => void = () => {
      throw new Error('missing releaseFirstBroadcast')
    }
    const firstBroadcastReleased = new Promise<void>((resolve) => {
      releaseFirstBroadcast = resolve
    })
    const recordArcReceipt = vi.fn(async () => {
      if (recordArcReceipt.mock.calls.length > 1) {
        throw new Error('unexpected rebroadcast')
      }
      await firstBroadcastReleased
      return {
        txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        txStatus: 'confirmed' as const,
        chainId: 5_042_002,
        blockNumber: '99999',
        requestId: 'req-pending',
      }
    })

    const firstAttempt = recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'twitter-signals',
        amount: '0.0001',
        requestId: 'req-pending',
        researchId: 'research-1',
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )

    await vi.waitFor(() => {
      expect(recordArcReceipt).toHaveBeenCalledTimes(1)
    })

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'twitter-signals',
        amount: '0.0001',
        requestId: 'req-pending',
        researchId: 'research-1',
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )).rejects.toMatchObject({
      code: 'PAYMENT_RECEIPT_PENDING',
      requestId: 'req-pending',
    })

    releaseFirstBroadcast()
    const payment = await firstAttempt
    expect(payment).toMatchObject({
      txHash: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      txStatus: 'confirmed',
      requestId: 'req-pending',
      researchId: 'research-1',
    })
    expect(recordArcReceipt).toHaveBeenCalledTimes(1)
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it('records failed receipts and throws a payment error when ARC recording fails', async () => {
    const { PaymentReceiptError, recordPaymentReceipt } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const recordArcReceipt = vi.fn().mockRejectedValue({
      code: 'ARC_RECEIPT_RPC_ERROR',
      txStatus: 'failed',
      message: 'RPC timeout',
      chainId: 5_042_002,
      blockNumber: null,
    })

    await expect(recordPaymentReceipt(
      {
        address: '0xabc',
        source: 'whale-watch',
        amount: '0.0002',
        mode: 'arc',
      },
      {
        txLogRepo,
        recordArcReceipt,
        createRequestId: () => 'req-failed',
        now: () => new Date('2026-06-27T00:00:00.000Z'),
      },
    )).rejects.toBeInstanceOf(PaymentReceiptError)

    const [entry] = await txLogRepo.listByAddress('0xabc')
    expect(entry).toMatchObject({
      source: 'whale-watch',
      amount: '0.0002',
      txHash: null,
      txStatus: 'failed',
      chainId: 5_042_002,
      blockNumber: null,
      requestId: 'req-failed',
      errorMessage: 'RPC timeout',
    })
  })

  it('records a research payment intent as pending without calling the ARC recorder', async () => {
    const { recordResearchPaymentIntent } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const recordArcReceipt = vi.fn()

    const payment = await recordResearchPaymentIntent(
      {
        address: '0xabc',
        source: 'sentiment',
        amount: '0.0001',
        requestId: 'req-research-pending',
        researchId: 'research-1',
        mode: 'arc',
      },
      { txLogRepo, recordArcReceipt },
    )

    expect(recordArcReceipt).not.toHaveBeenCalled()
    expect(payment).toMatchObject({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      txHash: null,
      txStatus: 'pending',
      chainId: null,
      blockNumber: null,
      requestId: 'req-research-pending',
      researchId: 'research-1',
      settlementId: null,
      errorMessage: null,
    })
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it('records an escrow research payment intent with canonical keys before any tool side effect', async () => {
    const { recordResearchPaymentIntent } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const recordArcReceipt = vi.fn()

    const payment = await recordResearchPaymentIntent(
      {
        address: vectors.inputs.buyer,
        source: vectors.inputs.source,
        amount: '0.0001',
        researchId: vectors.inputs.canonicalResearchId,
        mode: 'arc',
        paymentIntentId: vectors.inputs.canonicalPaymentIntentId,
        toolOrdinal: 0,
        researchKey: vectors.expected.researchKey,
        escrowAddress: '0x4444444444444444444444444444444444444444',
        registryRevision: vectors.inputs.item.registryRevision,
        expectedPayout: vectors.inputs.item.payout,
        maxUnitPrice: vectors.inputs.item.maxUnitPrice,
        registryReadBlock: '1999998700',
        payload: { window: '1h', token: 'PEPE' },
      },
      { txLogRepo, recordArcReceipt },
    )

    expect(recordArcReceipt).not.toHaveBeenCalled()
    expect(payment).toMatchObject({
      address: vectors.inputs.buyer,
      source: vectors.inputs.source,
      amount: '0.0001',
      txHash: null,
      txStatus: 'pending',
      chainId: null,
      blockNumber: null,
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
      settlementId: null,
      errorMessage: null,
    })
    expect(payment.requestKey).toBe(deriveRequestKey(vectors.expected.researchKey, vectors.inputs.canonicalPaymentIntentId))
    expect(payment.sourceId).toBe(deriveSourceId(vectors.inputs.source))
    expect(await txLogRepo.listByAddress(vectors.inputs.buyer)).toHaveLength(1)
  })

  it('reuses an existing pending research intent for the same payment scope', async () => {
    const { recordResearchPaymentIntent } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()

    const first = await recordResearchPaymentIntent({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-research-replay',
      researchId: 'research-1',
    }, { txLogRepo })
    const second = await recordResearchPaymentIntent({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-research-replay',
      researchId: 'research-1',
    }, { txLogRepo })

    expect(second).toEqual(first)
    expect(second.txStatus).toBe('pending')
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it('reuses an already confirmed research intent without creating a new pending row', async () => {
    const { recordResearchPaymentIntent } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()
    const existing = await txLogRepo.record({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      requestId: 'req-research-confirmed',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
    })

    const payment = await recordResearchPaymentIntent({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-research-confirmed',
      researchId: 'research-1',
    }, { txLogRepo })

    expect(payment).toEqual(existing)
    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(1)
  })

  it.each([
    'invalid/key',
    'a'.repeat(129),
    '',
    '   ',
    ' req-with-space ',
  ])('rejects an invalid research intent requestId (%s) before writing anything', async (requestId) => {
    const { recordResearchPaymentIntent } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()

    await expect(recordResearchPaymentIntent({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId,
      researchId: 'research-1',
    }, { txLogRepo })).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_KEY_INVALID',
    })

    expect(await txLogRepo.listByAddress('0xabc')).toHaveLength(0)
  })

  it('rejects reusing a research intent requestId for a different payment scope', async () => {
    const { recordResearchPaymentIntent } = await import('./payment-recorder')
    const txLogRepo = new MemoryTxLogRepo()

    await recordResearchPaymentIntent({
      address: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-research-conflict',
      researchId: 'research-1',
    }, { txLogRepo })

    await expect(recordResearchPaymentIntent({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      requestId: 'req-research-conflict',
      researchId: 'research-1',
    }, { txLogRepo })).rejects.toMatchObject({
      code: 'PAYMENT_IDEMPOTENCY_CONFLICT',
      requestId: 'req-research-conflict',
    })
  })
})

function stablePayloadHash(value: unknown) {
  return keccak256(toBytes(stableStringify(value)))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}
