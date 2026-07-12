import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  let counter = 0
  const entries: Array<{
    id: string
    address: string
    source: string
    amount: string
    researchId: string | null
    txHash: string | null
    txStatus: 'mock' | 'pending' | 'confirmed' | 'failed'
    chainId: number | null
    blockNumber: string | null
    settlementId: string | null
    requestId: string
    backend?: 'mock' | 'arc' | 'escrow' | null
    version?: number | null
    paymentIntentId?: string | null
    toolOrdinal?: number | null
    requestKey?: string | null
    sourceId?: string | null
    amountUnits?: string | null
    registryRevision?: string | null
    expectedPayout?: string | null
    maxUnitPrice?: string | null
    registryReadBlock?: string | null
    payloadHash?: string | null
    escrowAddress?: string | null
    researchKey?: string | null
    errorMessage: string | null
    createdAt: Date
  }> = []
  const operations = new Map<string, {
    operationKey: string
    type: 'SETTLE'
    phase: 'queued' | 'running' | 'broadcasting' | 'reconciling' | 'succeeded' | 'failed' | 'manual'
    txHash: string | null
    chainId: number | null
    blockNumber: string | null
    lastError: string | null
  }>()

  return {
    entries,
    reset() {
      counter = 0
      entries.length = 0
      operations.clear()
    },
    txLogRepo: {
      async record(entry: {
        address: string
        source: string
        amount: string
        researchId?: string | null
        txHash?: string | null
        txStatus?: 'mock' | 'pending' | 'confirmed' | 'failed'
        chainId?: number | null
        blockNumber?: string | null
        settlementId?: string | null
        requestId?: string
        backend?: 'mock' | 'arc' | 'escrow' | null
        version?: number | null
        paymentIntentId?: string | null
        toolOrdinal?: number | null
        requestKey?: string | null
        sourceId?: string | null
        amountUnits?: string | null
        registryRevision?: string | null
        expectedPayout?: string | null
        maxUnitPrice?: string | null
        registryReadBlock?: string | null
        payloadHash?: string | null
        escrowAddress?: string | null
        researchKey?: string | null
        errorMessage?: string | null
      }) {
        counter += 1
        const tx = {
          id: `tx-${counter}`,
          address: entry.address,
          source: entry.source,
          amount: entry.amount,
          researchId: entry.researchId ?? null,
          txHash: entry.txHash ?? (entry.txStatus === 'failed' ? null : `0x${counter.toString(16).padStart(64, '0')}`),
          txStatus: entry.txStatus ?? 'mock',
          chainId: entry.chainId ?? null,
          blockNumber: entry.blockNumber ?? null,
          settlementId: entry.settlementId ?? null,
          requestId: entry.requestId ?? `req-${counter}`,
          backend: entry.backend ?? null,
          version: entry.version ?? null,
          paymentIntentId: entry.paymentIntentId ?? null,
          toolOrdinal: entry.toolOrdinal ?? null,
          requestKey: entry.requestKey ?? null,
          sourceId: entry.sourceId ?? null,
          amountUnits: entry.amountUnits ?? null,
          registryRevision: entry.registryRevision ?? null,
          expectedPayout: entry.expectedPayout ?? null,
          maxUnitPrice: entry.maxUnitPrice ?? null,
          registryReadBlock: entry.registryReadBlock ?? null,
          payloadHash: entry.payloadHash ?? null,
          escrowAddress: entry.escrowAddress ?? null,
          researchKey: entry.researchKey ?? null,
          errorMessage: entry.errorMessage ?? null,
          createdAt: new Date(Date.UTC(2026, 5, 25, 0, counter, 0)),
        }
        entries.unshift(tx)
        return tx
      },
      async listByAddress(address: string, limit = 50) {
        return entries.filter((entry) => entry.address === address).slice(0, limit)
      },
      async totalSpentByAddress(address: string) {
        return entries
          .filter((entry) => entry.address === address && (entry.txStatus === 'mock' || entry.txStatus === 'confirmed'))
          .reduce((sum, entry) => sum + Number(entry.amount), 0)
          .toFixed(4)
      },
    },
    workflowOutboxRepo: {
      async findByOperationKey(operationKey: string) {
        return operations.get(operationKey) ?? null
      },
    },
    setOperation(operation: {
      operationKey: string
      type: 'SETTLE'
      phase: 'queued' | 'running' | 'broadcasting' | 'reconciling' | 'succeeded' | 'failed' | 'manual'
      txHash?: string | null
      chainId?: number | null
      blockNumber?: string | null
      lastError?: string | null
    }) {
      operations.set(operation.operationKey, {
        txHash: null,
        chainId: null,
        blockNumber: null,
        lastError: null,
        ...operation,
      })
    },
  }
})

vi.mock('@/lib/db', () => ({
  txLogRepo: mockStore.txLogRepo,
  workflowOutboxRepo: mockStore.workflowOutboxRepo,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  mockStore.reset()
})

async function authedRequest(path: string, address = '0xAbCdEf000000000000000000000000000000C1d3') {
  const jwt = await signSessionJwt(address)
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('wallet tx log APIs', () => {
  it('requires auth for tx-log and stats', async () => {
    const txLogRoute = await import('./tx-log/route')
    const statsRoute = await import('./stats/route')

    expect((await txLogRoute.GET(new Request('http://localhost/api/wallet/tx-log'))).status).toBe(401)
    expect((await statsRoute.GET(new Request('http://localhost/api/wallet/stats'))).status).toBe(401)
  })

  it('lists current user tx_log entries', async () => {
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0003',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      settlementId: 'settlement-1',
      requestId: 'req-confirmed',
    })
    await mockStore.txLogRepo.record({ address: '0xother', source: 'sentiment', amount: '0.0001' })
    const { GET } = await import('./tx-log/route')

    const res = await GET(await authedRequest('/api/wallet/tx-log'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.entries).toHaveLength(1)
    expect(body.entries[0]).toMatchObject({
      source: 'news',
      amount: '0.0003',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      settlementId: 'settlement-1',
      requestId: 'req-confirmed',
      errorMessage: null,
    })
  })

  it('keeps escrow operation broadcast facts separate from reconciled wallet payment facts', async () => {
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-escrow',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      txStatus: 'pending',
      chainId: 5_042_002,
      blockNumber: '999',
      settlementId: 'settlement-pending',
      requestId: 'req-escrow-pending',
      backend: 'escrow',
      version: 1,
      paymentIntentId: 'intent-1',
      toolOrdinal: 1,
      requestKey: `0x${'01'.repeat(32)}`,
      sourceId: `0x${'02'.repeat(32)}`,
      amountUnits: '300',
      registryRevision: '7',
      expectedPayout: '0xf000000000000000000000000000000000000001',
      maxUnitPrice: '300',
      registryReadBlock: '123',
      payloadHash: `0x${'03'.repeat(32)}`,
      escrowAddress: '0x4444444444444444444444444444444444444444',
      researchKey: `0x${'04'.repeat(32)}`,
    })
    mockStore.setOperation({
      operationKey: 'SETTLE:research-escrow',
      type: 'SETTLE',
      phase: 'broadcasting',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      chainId: 5_042_002,
      blockNumber: '999',
    })
    const { GET } = await import('./tx-log/route')

    const res = await GET(await authedRequest('/api/wallet/tx-log'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.entries[0]).toMatchObject({
      backend: 'escrow',
      txStatus: 'pending',
      txHash: null,
      chainId: null,
      blockNumber: null,
      operationPhase: 'broadcasting',
      operationTxHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      escrow: expect.objectContaining({
        operationKey: 'SETTLE:research-escrow',
        operationPhase: 'broadcasting',
        operationTxHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        confirmed: false,
        requestKey: `0x${'01'.repeat(32)}`,
      }),
    })
  })

  it('returns billable spend/call counts without counting failed or pending receipts', async () => {
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0009',
      txStatus: 'failed',
      txHash: null,
      requestId: 'req-failed',
      errorMessage: 'RPC timeout',
    })
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'twitter-signals',
      amount: '0.0008',
      txStatus: 'pending',
      requestId: 'req-pending',
    })
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'whale-watch',
      amount: '0.0002',
      txStatus: 'confirmed',
    })
    await mockStore.txLogRepo.record({
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'sentiment',
      amount: '0.0001',
      txStatus: 'mock',
    })
    const { GET } = await import('./stats/route')

    const res = await GET(await authedRequest('/api/wallet/stats'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      totalSpentUsdc: '0.0003',
      totalCalls: 2,
      lastResearchAt: '2026-06-25T00:04:00.000Z',
    })
  })
})
