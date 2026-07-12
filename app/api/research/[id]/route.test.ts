import { beforeAll, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'

const mockStore = vi.hoisted(() => {
  const researches = [
    {
      id: 'research-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      spentUsdc: '0.0012',
      status: 'completed' as const,
      activationPhase: 'active' as const,
      finalizationState: 'closed' as const,
      quotaReservationState: 'consumed' as const,
      reportMd: '# Report',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:00.000Z'),
      preparedAt: null,
      fundingExpiresAt: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: new Date('2026-06-25T00:00:18.000Z'),
    },
  ]
  const txEntries = [
    {
      id: 'tx-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed' as const,
      chainId: 5_042_002,
      blockNumber: '12345',
      settlementId: 'settlement-1',
      requestId: 'req-1',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:05.000Z'),
    },
    {
      id: 'tx-1b',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      txStatus: 'confirmed' as const,
      chainId: 5_042_002,
      blockNumber: '12345',
      settlementId: 'settlement-1',
      requestId: 'req-1b',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:06.000Z'),
    },
    {
      id: 'tx-2',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-2',
      txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
      txStatus: 'confirmed' as const,
      chainId: 5_042_002,
      blockNumber: '12346',
      settlementId: null,
      requestId: 'req-2',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:08.000Z'),
    },
    {
      id: 'tx-3',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'twitter-signals',
      amount: '0.0001',
      researchId: null,
      txHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
      txStatus: 'mock' as const,
      chainId: null,
      blockNumber: null,
      settlementId: null,
      requestId: 'req-3',
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:10.000Z'),
    },
  ]
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
    researches,
    txEntries,
    researchRepo: {
      async findById(id: string) {
        return researches.find((research) => research.id === id) ?? null
      },
    },
    txLogRepo: {
      async listByAddress(address: string, limit = 50) {
        return txEntries.filter((entry) => entry.address === address).slice(0, limit)
      },
      async listByResearchId(address: string, researchId: string, limit = 50) {
        return txEntries
          .filter((entry) => entry.address === address && entry.researchId === researchId)
          .slice(0, limit)
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
  researchRepo: mockStore.researchRepo,
  txLogRepo: mockStore.txLogRepo,
  workflowOutboxRepo: mockStore.workflowOutboxRepo,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

async function authedRequest(path = '/api/research/research-1') {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request(`http://localhost${path}`, {
    headers: { cookie: `arc_session=${jwt}` },
  })
}

describe('GET /api/research/[id]', () => {
  it('returns only tx_log rows that match the same researchId', async () => {
    const { GET } = await import('./route')

    const res = await GET(await authedRequest(), { params: { id: 'research-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.txLog).toHaveLength(2)
    expect(body.txLog).toEqual([
      expect.objectContaining({
        id: 'tx-1',
        source: 'news',
        requestId: 'req-1',
        settlementId: 'settlement-1',
        txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      }),
      expect.objectContaining({
        id: 'tx-1b',
        source: 'sentiment',
        requestId: 'req-1b',
        settlementId: 'settlement-1',
        txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      }),
    ])
  })

  it('separates escrow operation phase from reconciled payment facts in research detail', async () => {
    mockStore.txEntries.unshift({
      id: 'tx-escrow-pending',
      address: '0xabcdef000000000000000000000000000000c1d3',
      source: 'news',
      amount: '0.0003',
      researchId: 'research-1',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      txStatus: 'pending' as const,
      chainId: 5_042_002,
      blockNumber: '999',
      settlementId: 'settlement-pending',
      requestId: 'req-escrow-pending',
      backend: 'escrow' as const,
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
      errorMessage: null,
      createdAt: new Date('2026-06-25T00:00:07.000Z'),
    } as never)
    mockStore.setOperation({
      operationKey: 'SETTLE:research-1',
      type: 'SETTLE',
      phase: 'broadcasting',
      txHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      chainId: 5_042_002,
      blockNumber: '999',
    })
    const { GET } = await import('./route')

    const res = await GET(await authedRequest(), { params: { id: 'research-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.txLog[0]).toMatchObject({
      id: 'tx-escrow-pending',
      backend: 'escrow',
      txStatus: 'pending',
      txHash: null,
      chainId: null,
      blockNumber: null,
      operationPhase: 'broadcasting',
      operationTxHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      escrow: expect.objectContaining({
        operationPhase: 'broadcasting',
        confirmed: false,
      }),
    })
  })

  it('returns public escrow config for escrow-bound research without signing secrets', async () => {
    process.env.NEXT_PUBLIC_ARC_CHAIN_ID = '5042002'
    process.env.NEXT_PUBLIC_ARC_EXPLORER_URL = 'https://arc.example'
    process.env.ARC_RESEARCH_FACTORY_ADDRESS = '0x3333333333333333333333333333333333333333'
    process.env.ARC_RESEARCH_USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
    mockStore.researches.push({
      id: 'research-funded',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'FUNDED ESCROW',
      budgetUsdc: '1.00',
      budgetUnits: '1000000',
      spentUsdc: '0',
      status: 'funding' as const,
      activationPhase: 'funded' as const,
      finalizationState: 'none' as const,
      quotaReservationState: 'reserved' as const,
      prepareRequestId: 'idem-1',
      buyer: '0xabcdef000000000000000000000000000000c1d3',
      researchKey: `0x${'aa'.repeat(32)}`,
      expectedEscrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      reportMd: null,
      errorMessage: null,
      createdAt: new Date('2026-07-11T00:00:00.000Z'),
      preparedAt: new Date('2026-07-11T00:00:00.000Z'),
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
      expectedExpiresAt: new Date('2026-07-12T00:00:00.000Z'),
      fundingDeadline: new Date('2026-07-11T00:15:00.000Z'),
      intentSigner: '0x5555555555555555555555555555555555555555',
      voucherNonce: '7',
      quotaDate: '2026-07-11',
      cancelRequestedAt: null,
      chainId: 5_042_002,
      startedAt: null,
      completedAt: null,
    } as never)
    const { GET } = await import('./route')

    try {
      const res = await GET(await authedRequest('/api/research/research-funded'), { params: { id: 'research-funded' } })
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.escrowConfig).toEqual({
        chainId: 5_042_002,
        factory: '0x3333333333333333333333333333333333333333',
        usdc: '0x3600000000000000000000000000000000000000',
        explorerBase: 'https://arc.example',
      })
      expect(JSON.stringify(body)).not.toContain('PRIVATE_KEY')
      expect(JSON.stringify(body)).not.toContain('fundingSignature')
    } finally {
      mockStore.researches.pop()
      delete process.env.ARC_RESEARCH_FACTORY_ADDRESS
      delete process.env.ARC_RESEARCH_USDC_ADDRESS
    }
  })
})
