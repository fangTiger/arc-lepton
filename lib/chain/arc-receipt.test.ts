import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VALID_PRIVATE_KEY = `0x${'1'.repeat(64)}`
const RECORDER_ADDRESS = '0x1111111111111111111111111111111111111111'
const RECEIPT_ADDRESS = '0x2222222222222222222222222222222222222222'

type ArcReceiptDeps = {
  createPublicClient: ReturnType<typeof vi.fn>
  createWalletClient: ReturnType<typeof vi.fn>
  http: ReturnType<typeof vi.fn>
  privateKeyToAccount: ReturnType<typeof vi.fn>
  isAddress: ReturnType<typeof vi.fn>
}

function createDeps() {
  const waitForTransactionReceipt = vi.fn()
  const sendTransaction = vi.fn()
  const deps: ArcReceiptDeps = {
    createPublicClient: vi.fn(() => ({ waitForTransactionReceipt })),
    createWalletClient: vi.fn(() => ({ sendTransaction })),
    http: vi.fn((url: string) => ({ url })),
    privateKeyToAccount: vi.fn(() => ({ address: RECORDER_ADDRESS })),
    isAddress: vi.fn(() => true),
  }

  return {
    deps,
    waitForTransactionReceipt,
    sendTransaction,
  }
}

describe('arc-receipt', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.NEXT_PUBLIC_ARC_CHAIN_ID = '5042002'
    process.env.NEXT_PUBLIC_ARC_RPC_URL = 'https://arc.example/rpc'
    process.env.ARC_RECEIPT_MODE = 'mock'
    delete process.env.ARC_RECORDER_PRIVATE_KEY
    delete process.env.ARC_RECEIPT_TO_ADDRESS
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds a structured ARC receipt payload and encodes it as calldata', async () => {
    const { buildReceiptPayload, encodeReceiptPayload } = await import('./arc-receipt')

    const payload = buildReceiptPayload({
      buyer: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      requestId: 'req-1',
      researchId: 'research-1',
      createdAt: '2026-06-27T00:00:00.000Z',
    })

    expect(payload).toEqual({
      kind: 'arc-lepton.receipt',
      version: 1,
      buyer: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
      researchId: 'research-1',
      requestId: 'req-1',
      createdAt: '2026-06-27T00:00:00.000Z',
    })
    expect(encodeReceiptPayload(payload)).toMatch(/^0x[0-9a-f]+$/)
  })

  it('builds a structured ARC research settlement payload and encodes it as calldata', async () => {
    const { buildResearchSettlementPayload, encodeReceiptPayload } = await import('./arc-receipt')

    const payload = buildResearchSettlementPayload({
      buyer: '0xabc',
      researchId: 'research-1',
      totalAmount: '0.0004',
      items: [
        { requestId: 'req-news', source: 'news', amount: '0.0003' },
        { requestId: 'req-sentiment', source: 'sentiment', amount: '0.0001' },
      ],
      createdAt: '2026-07-03T00:00:00.000Z',
    })

    expect(payload).toEqual({
      kind: 'arc-lepton.research-settlement',
      version: 1,
      buyer: '0xabc',
      researchId: 'research-1',
      totalAmount: '0.0004',
      itemCount: 2,
      items: [
        { requestId: 'req-news', source: 'news', amount: '0.0003' },
        { requestId: 'req-sentiment', source: 'sentiment', amount: '0.0001' },
      ],
      createdAt: '2026-07-03T00:00:00.000Z',
    })
    expect(encodeReceiptPayload(payload)).toMatch(/^0x[0-9a-f]+$/)
  })

  it('returns a mock receipt without broadcasting in mock mode', async () => {
    const { recordArcReceipt } = await import('./arc-receipt')
    const { deps, sendTransaction, waitForTransactionReceipt } = createDeps()

    const receipt = await recordArcReceipt(
      {
        buyer: '0xabc',
        source: 'news',
        amount: '0.0003',
        requestId: 'req-mock',
        mode: 'mock',
        createdAt: '2026-06-27T00:00:00.000Z',
      },
      deps as never,
    )

    expect(receipt).toMatchObject({
      txStatus: 'mock',
      chainId: null,
      blockNumber: null,
      requestId: 'req-mock',
    })
    expect(receipt.txHash).toMatch(/^0x[a-f0-9]{64}$/)
    expect(sendTransaction).not.toHaveBeenCalled()
    expect(waitForTransactionReceipt).not.toHaveBeenCalled()
  })

  it('fails closed when arc mode is missing required chain config', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    delete process.env.NEXT_PUBLIC_ARC_RPC_URL
    const { recordArcReceipt } = await import('./arc-receipt')

    await expect(recordArcReceipt({
      buyer: '0xabc',
      source: 'news',
      amount: '0.0003',
      requestId: 'req-config',
      mode: 'arc',
    })).rejects.toMatchObject({
      code: 'ARC_RECEIPT_CONFIG_INVALID',
      txStatus: 'failed',
    })
  })

  it('broadcasts a 0-value ARC receipt transaction and waits for confirmation in arc mode', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    process.env.ARC_RECORDER_PRIVATE_KEY = VALID_PRIVATE_KEY
    process.env.ARC_RECEIPT_TO_ADDRESS = RECEIPT_ADDRESS
    const { recordArcReceipt } = await import('./arc-receipt')
    const { deps, sendTransaction, waitForTransactionReceipt } = createDeps()
    sendTransaction.mockResolvedValue('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 12345n,
    })

    const receipt = await recordArcReceipt(
      {
        buyer: '0xabc',
        source: 'whale-watch',
        amount: '0.0002',
        requestId: 'req-arc',
        researchId: 'research-1',
        mode: 'arc',
        createdAt: '2026-06-27T00:00:00.000Z',
      },
      deps as never,
    )

    expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({ address: RECORDER_ADDRESS }),
      to: RECEIPT_ADDRESS,
      value: 0n,
      data: expect.stringMatching(/^0x[0-9a-f]+$/),
      chain: expect.objectContaining({ id: 5_042_002 }),
    }))
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    })
    expect(receipt).toEqual({
      txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '12345',
      requestId: 'req-arc',
    })
  })

  it('broadcasts a 0-value ARC research settlement transaction with the settlement payload', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    process.env.ARC_RECORDER_PRIVATE_KEY = VALID_PRIVATE_KEY
    process.env.ARC_RECEIPT_TO_ADDRESS = RECEIPT_ADDRESS
    const { hexToString } = await import('viem')
    const { recordArcResearchSettlement } = await import('./arc-receipt')
    const { deps, sendTransaction, waitForTransactionReceipt } = createDeps()
    sendTransaction.mockResolvedValue('0xabababababababababababababababababababababababababababababababab')
    waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      blockNumber: 45678n,
    })

    const receipt = await recordArcResearchSettlement(
      {
        buyer: '0xabc',
        researchId: 'research-1',
        totalAmount: '0.0004',
        items: [
          { requestId: 'req-news', source: 'news', amount: '0.0003' },
          { requestId: 'req-sentiment', source: 'sentiment', amount: '0.0001' },
        ],
        mode: 'arc',
        createdAt: '2026-07-03T00:00:00.000Z',
      },
      deps as never,
    )

    const data = sendTransaction.mock.calls[0]?.[0]?.data
    expect(JSON.parse(hexToString(data))).toMatchObject({
      kind: 'arc-lepton.research-settlement',
      buyer: '0xabc',
      researchId: 'research-1',
      totalAmount: '0.0004',
      itemCount: 2,
    })
    expect(receipt).toEqual({
      txHash: '0xabababababababababababababababababababababababababababababababab',
      txStatus: 'confirmed',
      chainId: 5_042_002,
      blockNumber: '45678',
    })
  })

  it('throws a failed ARC receipt error when the chain receipt is unsuccessful', async () => {
    process.env.ARC_RECEIPT_MODE = 'arc'
    process.env.ARC_RECORDER_PRIVATE_KEY = VALID_PRIVATE_KEY
    const { recordArcReceipt } = await import('./arc-receipt')
    const { deps, sendTransaction, waitForTransactionReceipt } = createDeps()
    sendTransaction.mockResolvedValue('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      blockNumber: 54321n,
    })

    await expect(recordArcReceipt(
      {
        buyer: '0xabc',
        source: 'kline-pattern',
        amount: '0.0005',
        requestId: 'req-failed',
        mode: 'arc',
      },
      deps as never,
    )).rejects.toMatchObject({
      code: 'ARC_RECEIPT_REVERTED',
      txStatus: 'failed',
      txHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      chainId: 5_042_002,
      blockNumber: '54321',
    })
  })
})
