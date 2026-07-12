import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchDetailClient } from './ResearchDetailClient'

const routerPush = vi.fn()
const routerReplace = vi.fn()
const fetchMock = vi.fn()
const walletMocks = vi.hoisted(() => ({
  account: '0xabcdef000000000000000000000000000000c1d3',
  chainId: 5_042_002,
  sessionAddress: '0xabcdef000000000000000000000000000000c1d3',
  switchChainAsync: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: walletMocks.account }),
  useChainId: () => walletMocks.chainId,
  usePublicClient: () => ({ waitForTransactionReceipt: walletMocks.waitForTransactionReceipt }),
  useSwitchChain: () => ({ switchChainAsync: walletMocks.switchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: walletMocks.writeContractAsync }),
}))

vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({ address: walletMocks.sessionAddress, isAuthed: !!walletMocks.sessionAddress, isLoading: false }),
}))

vi.mock('@/components/research/TerminalMarkdown', () => ({
  TerminalMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe('ResearchDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    walletMocks.account = '0xabcdef000000000000000000000000000000c1d3'
    walletMocks.chainId = 5_042_002
    walletMocks.sessionAddress = '0xabcdef000000000000000000000000000000c1d3'
    walletMocks.switchChainAsync.mockResolvedValue(undefined)
    walletMocks.waitForTransactionReceipt.mockResolvedValue({ transactionHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' })
    walletMocks.writeContractAsync.mockResolvedValue('0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
    process.env.NEXT_PUBLIC_ARC_EXPLORER_URL = 'https://arc.example'
    process.env.NEXT_PUBLIC_ARC_CHAIN_ID = '5042002'
    window.history.replaceState({}, '', '/research/research-1')
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/follow-ups') && init?.method === 'POST') {
        return Response.json({
          followUp: {
            id: 'fu-2',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Does the setup improve with stronger volume?',
            answerMd: '## Follow-up Answer\nThe setup still needs confirmation even if volume improves.',
            status: 'completed',
            spentUsdc: '0',
            errorMessage: null,
            createdAt: '2026-06-27T08:05:00.000Z',
            completedAt: '2026-06-27T08:05:08.000Z',
          },
        })
      }
      if (url.endsWith('/follow-ups')) {
        return Response.json({
          followUps: [],
        })
      }
      return Response.json({
        research: {
          id: 'research-1',
          address: '0xabcdef000000000000000000000000000000c1d3',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: '0.0012',
          status: 'completed',
          reportMd: '# Report',
          errorMessage: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:18.000Z',
        },
        txLog: [
          {
            id: 'tx-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'news',
            amount: '0.0003',
            txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
            txStatus: 'confirmed',
            chainId: 5_042_002,
            blockNumber: '12345',
            requestId: 'req-1',
            errorMessage: null,
            createdAt: '2026-06-25T00:00:00.000Z',
          },
          {
            id: 'tx-2',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'sentiment',
            amount: '0.0001',
            txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
            txStatus: 'mock',
            chainId: null,
            blockNumber: null,
            requestId: 'req-2',
            errorMessage: null,
            createdAt: '2026-06-25T00:00:02.000Z',
          },
          {
            id: 'tx-3',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'whale-watch',
            amount: '0.0002',
            txHash: null,
            txStatus: 'failed',
            chainId: null,
            blockNumber: null,
            requestId: 'req-3',
            errorMessage: 'RPC timeout',
            createdAt: '2026-06-25T00:00:03.000Z',
          },
          {
            id: 'tx-4',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'twitter-signals',
            amount: '0.0001',
            txHash: null,
            txStatus: 'pending',
            chainId: null,
            blockNumber: null,
            requestId: 'req-4',
            errorMessage: null,
            createdAt: '2026-06-25T00:00:04.000Z',
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  function escrowDetailResponse(overrides: Record<string, unknown> = {}) {
    return {
      research: {
        id: 'research-1',
        address: '0xabcdef000000000000000000000000000000c1d3',
        topic: 'SHOULD I BUY PEPE?',
        budgetUsdc: '1.00',
        budgetUnits: '1000000',
        spentUsdc: '0',
        status: 'funding',
        activationPhase: 'funded',
        finalizationState: 'none',
        quotaReservationState: 'reserved',
        prepareRequestId: 'idem-1',
        buyer: '0xabcdef000000000000000000000000000000c1d3',
        researchKey: `0x${'aa'.repeat(32)}`,
        expectedEscrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        reportMd: null,
        errorMessage: null,
        createdAt: '2026-07-11T00:00:00.000Z',
        preparedAt: '2026-07-11T00:00:00.000Z',
        fundingExpiresAt: '2026-07-11T00:15:00.000Z',
        expectedExpiresAt: '2026-07-12T00:00:00.000Z',
        fundingDeadline: '2026-07-11T00:15:00.000Z',
        intentSigner: '0x5555555555555555555555555555555555555555',
        voucherNonce: '7',
        quotaDate: '2026-07-11',
        cancelRequestedAt: null,
        chainId: 5_042_002,
        startedAt: null,
        completedAt: null,
        ...overrides,
      },
      escrowConfig: {
        chainId: 5_042_002,
        factory: '0x3333333333333333333333333333333333333333',
        usdc: '0x3600000000000000000000000000000000000000',
        explorerBase: 'https://arc.example',
      },
      txLog: [
        {
          id: 'tx-escrow',
          address: '0xabcdef000000000000000000000000000000c1d3',
          source: 'news',
          amount: '0.0003',
          txHash: null,
          txStatus: 'pending',
          chainId: null,
          blockNumber: null,
          settlementId: 'settlement-1',
          requestId: 'req-escrow',
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
          escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          researchKey: `0x${'aa'.repeat(32)}`,
          operationPhase: 'broadcasting',
          operationTxHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
          operationBlockNumber: '999',
          escrow: {
            operationKey: 'SETTLE:research-1',
            operationPhase: 'broadcasting',
            operationTxHash: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
            operationBlockNumber: '999',
            operationLastError: null,
            confirmed: false,
            settlementId: 'settlement-1',
            researchKey: `0x${'aa'.repeat(32)}`,
            escrowAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
            requestKey: `0x${'01'.repeat(32)}`,
            sourceId: `0x${'02'.repeat(32)}`,
            amountUnits: '300',
            registryRevision: '7',
            expectedPayout: '0xf000000000000000000000000000000000000001',
            maxUnitPrice: '300',
            registryReadBlock: '123',
            payloadHash: `0x${'03'.repeat(32)}`,
          },
          errorMessage: null,
          createdAt: '2026-07-11T00:03:00.000Z',
        },
      ],
    }
  }

  it('offers a way back to the current session and to research history', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    fireEvent.click(await screen.findByRole('button', { name: /\[← BACK TO SESSION\]/i }))
    expect(routerPush).toHaveBeenCalledWith('/research?id=research-1')

    fireEvent.click(screen.getByRole('button', { name: /\[VIEW HISTORY\]/i }))
    expect(routerPush).toHaveBeenCalledWith('/dashboard')
  })

  it('shows confirmed/mock/failed receipt states truthfully and only links confirmed receipts', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const links = await screen.findAllByRole('link')

    expect(screen.getByText('confirmed')).toBeInTheDocument()
    expect(screen.getByText('mock receipt')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('pending settlement')).toBeInTheDocument()
    expect(screen.getAllByText('not broadcast')).toHaveLength(2)
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://arc.example/tx/0x1111111111111111111111111111111111111111111111111111111111111111')
  })

  it('counts only mock and confirmed receipts in the header calls summary', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/\$0\.0012 USDC \(2 calls\)/i)).toBeInTheDocument()
  })

  it('separates escrow status, finalization, budget, addresses, and operation evidence', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/follow-ups')) return Response.json({ followUps: [] })
      return Response.json(escrowDetailResponse())
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/escrow evidence/i)).toBeInTheDocument()
    expect(screen.getByText('RESEARCH STATUS')).toBeInTheDocument()
    expect(screen.getByText('funding')).toBeInTheDocument()
    expect(screen.getByText('ACTIVATION PHASE')).toBeInTheDocument()
    expect(screen.getByText('funded')).toBeInTheDocument()
    expect(screen.getByText('FINALIZATION STATE')).toBeInTheDocument()
    expect(screen.getAllByText('none').length).toBeGreaterThan(0)
    expect(screen.getByText('ESCROW STATE')).toBeInTheDocument()
    expect(screen.getByText('Funded')).toBeInTheDocument()
    expect(screen.getByText('$1.00 USDC')).toBeInTheDocument()
    expect(screen.getByText('1000000 units')).toBeInTheDocument()
    expect(screen.getByText('OFFICIAL USDC')).toBeInTheDocument()
    expect(screen.getByText('FACTORY')).toBeInTheDocument()
    expect(screen.getByText('EXPECTED ESCROW')).toBeInTheDocument()
    expect(screen.getByText('ACTUAL ESCROW')).toBeInTheDocument()
    expect(screen.getByText('broadcasting')).toBeInTheDocument()
    expect(screen.getByText('block 999')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\[cancel funded escrow\]/i })).toBeInTheDocument()
  })

  it('broadcasts cancelUnactivated from the buyer wallet for a Funded escrow', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/follow-ups')) return Response.json({ followUps: [] })
      return Response.json(escrowDetailResponse())
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const cancelButton = await screen.findByRole('button', { name: /\[cancel funded escrow\]/i })
    fireEvent.click(cancelButton)
    fireEvent.click(cancelButton)

    await waitFor(() => {
      expect(walletMocks.writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({
        address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        functionName: 'cancelUnactivated',
      }))
    })
    expect(walletMocks.writeContractAsync).toHaveBeenCalledTimes(1)
    expect(walletMocks.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    })
    expect(await screen.findByText(/\[cancel tx confirmed\]/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /0xcccc\.\.\.cccc/i })).toHaveAttribute(
      'href',
      'https://arc.example/tx/0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    )
  })

  it('does not offer buyer cancelUnactivated once the escrow is Active', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/follow-ups')) return Response.json({ followUps: [] })
      return Response.json(escrowDetailResponse({
        status: 'running',
        activationPhase: 'active',
        finalizationState: 'open',
      }))
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/escrow evidence/i)).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\[cancel funded escrow\]/i })).not.toBeInTheDocument()
  })

  it('shows a follow-up entry point with an empty state', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/follow-up q&a/i)).toBeInTheDocument()
    expect(screen.getByText(/no follow-up questions yet/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ask a follow-up about this report/i)).toBeInTheDocument()
  })

  it('scrolls to the follow-up section and focuses the input when the page loads with the follow-up hash', async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollSpy = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    })
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(() => {})
    window.history.replaceState({}, '', '/research/research-1#follow-up')

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    await screen.findByText(/follow-up q&a/i)
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled())
    expect(focusSpy).toHaveBeenCalled()

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    })
    focusSpy.mockRestore()
  })

  it('submits a follow-up question and appends the returned answer', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Does the setup improve with stronger volume?' } })
    fireEvent.click(screen.getByRole('button', { name: /submit follow-up/i }))

    expect(await screen.findByText(/the setup still needs confirmation even if volume improves\./i)).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveValue(''))
    expect(fetchMock).toHaveBeenCalledWith('/api/research/research-1/follow-ups', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })

  it('appends a failed follow-up card and shows an English error when generation fails with 502', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/follow-ups') && init?.method === 'POST') {
        return Response.json({
          error: 'FOLLOW_UP_FAILED',
          followUp: {
            id: 'fu-9',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Need one more angle on invalidation.',
            answerMd: null,
            status: 'failed',
            spentUsdc: '0',
            errorMessage: 'Follow-up answer generation failed',
            createdAt: '2026-06-27T08:06:00.000Z',
            completedAt: '2026-06-27T08:06:05.000Z',
          },
        }, { status: 502 })
      }
      if (url.endsWith('/follow-ups')) {
        return Response.json({ followUps: [] })
      }
      return Response.json({
        research: {
          id: 'research-1',
          address: '0xabcdef000000000000000000000000000000c1d3',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: '0.0012',
          status: 'completed',
          reportMd: '# Report',
          errorMessage: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:18.000Z',
        },
        txLog: [],
      })
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Need one more angle on invalidation.' } })
    fireEvent.click(screen.getByRole('button', { name: /submit follow-up/i }))

    expect(await screen.findByText(/the follow-up answer could not be generated\. please try again\./i)).toBeInTheDocument()
    expect(screen.getAllByText('Need one more angle on invalidation.').length).toBeGreaterThan(0)
    expect(screen.getByText(/follow-up answer failed\. please try again\./i)).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('shows an English error state when follow-up creation fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/follow-ups') && init?.method === 'POST') {
        return Response.json({ error: 'BUDGET_EXHAUSTED' }, { status: 409 })
      }
      if (url.endsWith('/follow-ups')) {
        return Response.json({ followUps: [] })
      }
      return Response.json({
        research: {
          id: 'research-1',
          address: '0xabcdef000000000000000000000000000000c1d3',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: '0.0012',
          status: 'completed',
          reportMd: '# Report',
          errorMessage: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:18.000Z',
        },
        txLog: [],
      })
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Can you give me one more check?' } })
    fireEvent.click(screen.getByRole('button', { name: /submit follow-up/i }))

    expect(await screen.findByText(/no remaining budget is available for follow-up questions/i)).toBeInTheDocument()
  })

  it('shows a friendly authentication error without leaking internal load codes', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/research/research-1')) {
        return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }
      throw new Error(`unexpected request: ${url}`)
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/authentication expired\. please sign in again\./i)).toBeInTheDocument()
    expect(routerReplace).toHaveBeenCalledWith('/login?redirect=%2Fresearch%2Fresearch-1')
    expect(screen.queryByText(/load_failed_401/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/loading report_/i)).not.toBeInTheDocument()
  })
})
