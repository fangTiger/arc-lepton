import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchPageClient } from './ResearchPageClient'

const navigation = vi.hoisted(() => ({
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  searchId: null as string | null,
}))

type MockAgentEvent = {
  type: string
  reportMd?: string
  message?: string
  text?: string
  delta?: string
  receivedAt?: string
  callId?: string
  name?: string
  payment?: unknown
  dataPreview?: string
  totalSpentUsdc?: string
  totalCalls?: number
}

const agentLogHarness = vi.hoisted(() => ({
  onEvent: null as null | ((event: MockAgentEvent) => void),
}))

const walletMocks = vi.hoisted(() => ({
  account: {
    address: '0xAbCdEf000000000000000000000000000000C1d3' as string | undefined,
    isConnected: true,
  },
  chainId: 5_042_002,
  userAddress: '0xAbCdEf000000000000000000000000000000C1d3' as string | null,
  readContract: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContractAsync: vi.fn(),
  signTypedDataAsync: vi.fn(),
  switchChainAsync: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.routerPush, replace: navigation.routerReplace }),
  useSearchParams: () => ({ get: (name: string) => (name === 'id' ? navigation.searchId : null) }),
}))

vi.mock('@/lib/constants', () => ({
  ARC_CHAIN_ID: 5_042_002,
}))

vi.mock('wagmi', () => ({
  useAccount: () => walletMocks.account,
  useChainId: () => walletMocks.chainId,
  usePublicClient: () => ({
    readContract: walletMocks.readContract,
    waitForTransactionReceipt: walletMocks.waitForTransactionReceipt,
  }),
  useSignTypedData: () => ({ signTypedDataAsync: walletMocks.signTypedDataAsync }),
  useSwitchChain: () => ({ switchChainAsync: walletMocks.switchChainAsync }),
  useWriteContract: () => ({ writeContractAsync: walletMocks.writeContractAsync }),
}))

vi.mock('@/hooks/useUser', () => ({
  useUser: () => ({
    address: walletMocks.userAddress,
    isAuthed: Boolean(walletMocks.userAddress),
    isLoading: false,
  }),
}))

vi.mock('@/components/research/AgentLogStream', () => ({
  AgentLogStream: ({
    events,
    onEvent,
  }: {
    events: MockAgentEvent[]
    onEvent: (event: MockAgentEvent) => void
  }) => {
    agentLogHarness.onEvent = onEvent
    return (
      <div data-testid="agent-log-events">
        {events.map((event) => event.reportMd ?? event.message ?? event.text ?? event.delta ?? event.type).join('\n')}
      </div>
    )
  },
}))

vi.mock('@/components/research/TxFeed', () => ({
  TxFeed: ({ events }: { events: Array<unknown> }) => (
    <div data-testid="tx-feed-events">{JSON.stringify(events)}</div>
  ),
}))

vi.mock('@/components/research/BudgetMeter', () => ({
  BudgetMeter: () => null,
}))

vi.mock('@/components/research/TerminalMarkdown', () => ({
  TerminalMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

const expandedPromptPool = [
  'SHOULD I BUY PEPE?',
  'BTC PRICE PREDICTION',
  'SOL ECOSYSTEM HEALTH',
  'MEME COIN MOMENTUM',
  'ETH GAS TREND',
  'DOGE VS SHIB',
  'IS THIS ALT SZN?',
  'STABLECOIN RISK CHECK',
  'WHO LEADS L2 FLOW?',
  'CAN BASE KEEP RUNNING?',
  'WHAT ARE WHALES BUYING?',
  'WHICH NARRATIVE IS HOT?',
]

const shiftedPromptDeck = [...expandedPromptPool.slice(1), expandedPromptPool[0]]
const approveTxHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const fundingTxHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const activationSignature = `${'0x'}${'c'.repeat(130)}`
const storage = new Map<string, string>()
const localStorageMock = {
  clear: vi.fn(() => storage.clear()),
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  removeItem: vi.fn((key: string) => storage.delete(key)),
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value)
  }),
}

function quotaResponse() {
  return {
    wallet: { consumed: 3, reserved: 1, used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
    global: { consumed: 60, reserved: 7, used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
  }
}

function escrowConfig() {
  return {
    settlementBackend: 'escrow',
    fundingUiEnabled: true,
    dualWriteEnabled: true,
    readCompareEnabled: false,
    migrationStage: 'switch',
    contractMigrationAllowed: false,
  }
}

function prepareResponse(overrides: Partial<Record<string, unknown>> = {}) {
  const response = {
    researchId: 'research-escrow-1',
    status: 'funding',
    activationPhase: 'none',
    quotaReservationState: 'reserved',
    buyer: '0xabcdef000000000000000000000000000000c1d3',
    topic: 'SHOULD I BUY PEPE?',
    budgetUsdc: '0.01',
    budgetUnits: '10000',
    chainId: 5_042_002,
    factory: '0x3333333333333333333333333333333333333333',
    implementation: '0x1111111111111111111111111111111111111111',
    usdc: '0x3600000000000000000000000000000000000000',
    intentSigner: '0x5555555555555555555555555555555555555555',
    researchKey: '0x9999999999999999999999999999999999999999999999999999999999999999',
    expectedEscrowAddress: '0x4444444444444444444444444444444444444444',
    expectedExpiresAt: '2030-01-02T00:00:00.000Z',
    fundingDeadline: '2030-01-01T00:15:00.000Z',
    fundingVoucher: {
      buyer: '0xabcdef000000000000000000000000000000c1d3',
      researchKey: '0x9999999999999999999999999999999999999999999999999999999999999999',
      budgetUnits: '10000',
      expectedExpiresAt: '1893542400',
      fundingDeadline: '1893456900',
      intentSigner: '0x5555555555555555555555555555555555555555',
      voucherNonce: '12345',
    },
    fundingSigner: '0x3aED557D932A8EB5B048BaB0a388Da4Ab0A84bC0',
    fundingSignature: `${'0x'}${'d'.repeat(130)}`,
  }
  return { ...response, ...overrides }
}

function getQuickPromptLabels() {
  return screen
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((label) => expandedPromptPool.some((prompt) => label === `[${prompt}]`))
}

describe('ResearchPageClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    navigation.searchId = null
    agentLogHarness.onEvent = null
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    })
    window.localStorage.clear()
    walletMocks.account = {
      address: '0xAbCdEf000000000000000000000000000000C1d3',
      isConnected: true,
    }
    walletMocks.chainId = 5_042_002
    walletMocks.userAddress = '0xAbCdEf000000000000000000000000000000C1d3'
    walletMocks.readContract.mockReset()
    walletMocks.waitForTransactionReceipt.mockReset()
    walletMocks.writeContractAsync.mockReset()
    walletMocks.signTypedDataAsync.mockReset()
    walletMocks.switchChainAsync.mockReset()
    walletMocks.readContract
      .mockResolvedValueOnce(0n)
      .mockResolvedValue(10000n)
    walletMocks.waitForTransactionReceipt.mockResolvedValue({ transactionHash: fundingTxHash, logs: [{ logIndex: 7 }] })
    walletMocks.writeContractAsync
      .mockResolvedValueOnce(approveTxHash)
      .mockResolvedValue(fundingTxHash)
    walletMocks.signTypedDataAsync.mockResolvedValue(activationSignature)
    walletMocks.switchChainAsync.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/config')) {
        return Response.json({
          settlementBackend: 'calldata',
          fundingUiEnabled: false,
          dualWriteEnabled: false,
          readCompareEnabled: false,
          migrationStage: 'backfill',
          contractMigrationAllowed: false,
        })
      }
      return Response.json({})
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders the daily quota panel on the create form', async () => {
    render(createElement(ResearchPageClient))

    expect(await screen.findByText('DAILY QUOTA')).toBeInTheDocument()
    expect(screen.getByText(/WALLET:/)).toHaveTextContent('4/10')
    expect(screen.getByText(/GLOBAL:/)).toHaveTextContent('67/100')
    expect(screen.getByText(/WALLET CONSUMED:/)).toHaveTextContent('3')
    expect(screen.getByText(/WALLET RESERVED:/)).toHaveTextContent('1')
    expect(screen.getByText(/WALLET REMAINING:/)).toHaveTextContent('6')
    expect(screen.getByText(/GLOBAL CONSUMED:/)).toHaveTextContent('60')
    expect(screen.getByText(/GLOBAL RESERVED:/)).toHaveTextContent('7')
    expect(screen.getByText(/ESTIMATED CALLS:/)).toHaveTextContent('ESTIMATED CALLS: 3')
    expect(screen.getByText('Rate limits will be relaxed after mainnet launch.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /\[VIEW HISTORY\]/i })).toHaveAttribute('href', '/dashboard')
  })

  it('disables research creation when the wallet quota is exhausted', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      wallet: { consumed: 10, reserved: 0, used: 10, limit: 10, remaining: 0, resetAt: '2026-06-26T00:00:00.000Z' },
      global: { consumed: 60, reserved: 7, used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
    }))

    render(createElement(ResearchPageClient))

    await waitFor(() => expect(screen.getByRole('button', { name: /\[ QUOTA EXCEEDED \]/i })).toBeDisabled())
    expect(screen.getByText(/WALLET CONSUMED:/)).toHaveTextContent('10')
    expect(screen.getByText(/WALLET RESERVED:/)).toHaveTextContent('0')
  })

  it('redirects to login when research creation returns unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/quota')) {
        return Response.json({
          wallet: { used: 4, limit: 10, remaining: 6, resetAt: '2026-06-26T00:00:00.000Z' },
          global: { used: 67, limit: 100, remaining: 33, resetAt: '2026-06-26T00:00:00.000Z' },
        })
      }
      if (url.includes('/api/research/start')) {
        return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))

    await waitFor(() => expect(navigation.routerReplace).toHaveBeenCalledWith('/login?redirect=%2Fresearch'))
    expect(screen.getByText(/\[ERR\] Authentication expired\. Please sign in again\./i)).toBeInTheDocument()
  })

  it('keeps the calldata mock demo start flow walletless when funding UI is disabled', async () => {
    walletMocks.account = { address: undefined, isConnected: false }
    walletMocks.userAddress = null
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/config')) {
        return Response.json({ settlementBackend: 'calldata', fundingUiEnabled: false })
      }
      if (url.includes('/api/research/start')) return Response.json({ researchId: 'research-mock-1' })
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))

    await waitFor(() => expect(navigation.routerPush).toHaveBeenCalledWith('/research?id=research-mock-1'))
    expect(calls.some((call) => call.url.includes('/api/research/start'))).toBe(true)
    expect(calls.some((call) => call.url.includes('/api/research/prepare'))).toBe(false)
    expect(walletMocks.readContract).not.toHaveBeenCalled()
    expect(walletMocks.writeContractAsync).not.toHaveBeenCalled()
    expect(walletMocks.signTypedDataAsync).not.toHaveBeenCalled()
    expect(screen.queryByText(/escrow funding/i)).not.toBeInTheDocument()
  })

  it('hides escrow funding UI and uses legacy start when the escrow feature flag is disabled', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/config')) {
        return Response.json({ settlementBackend: 'escrow', fundingUiEnabled: false })
      }
      if (url.includes('/api/research/start')) return Response.json({ researchId: 'research-flag-off' })
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i })).toBeInTheDocument()
    expect(screen.queryByText(/escrow funding/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))

    await waitFor(() => expect(navigation.routerPush).toHaveBeenCalledWith('/research?id=research-flag-off'))
    expect(calls.some((call) => call.url.includes('/api/research/start'))).toBe(true)
    expect(calls.some((call) => call.url.includes('/api/research/prepare'))).toBe(false)
    expect(walletMocks.writeContractAsync).not.toHaveBeenCalled()
  })

  it('labels budget controls and shows friendly start failures as an alert', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/config')) return Response.json({ settlementBackend: 'calldata', fundingUiEnabled: false })
      if (url.includes('/api/research/start')) {
        return Response.json({ error: 'DATABASE_URL missing\nstack trace' }, { status: 500 })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByRole('textbox', { name: /topic/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /budget usdc/i })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /budget slider/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Research could not be started. Please try again.')
    expect(alert).not.toHaveTextContent('DATABASE_URL')
    expect(alert).not.toHaveTextContent('START_FAILED')
  })

  it('runs the escrow prepare, approve, createAndFund, activation signature, and start flow', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/api/research/config')) return Response.json(escrowConfig())
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/prepare')) return Response.json(prepareResponse())
      if (url.includes('/api/research/start')) {
        return Response.json({ researchId: 'research-escrow-1', status: 'running', activationPhase: 'active' })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))

    await waitFor(() => {
      const prepareCall = calls.find((call) => call.url.includes('/api/research/prepare'))
      expect(prepareCall?.init?.headers).toEqual(expect.objectContaining({
        'content-type': 'application/json',
        'Idempotency-Key': expect.stringMatching(/^research-/),
      }))
    })
    expect(await screen.findByText(/PREDICTED ESCROW/i)).toBeInTheDocument()
    expect(screen.getByText('0x4444444444444444444444444444444444444444')).toBeInTheDocument()
    expect(screen.getByText('0x3600000000000000000000000000000000000000')).toBeInTheDocument()
    expect(screen.getByText('0x5555555555555555555555555555555555555555')).toBeInTheDocument()
    expect(screen.getByText('reserved')).toBeInTheDocument()
    expect(screen.getByText('NEEDS APPROVE')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /\[APPROVE USDC\]/i }))
    await waitFor(() => expect(walletMocks.writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({
      address: '0x3600000000000000000000000000000000000000',
      functionName: 'approve',
      args: ['0x3333333333333333333333333333333333333333', 10000n],
    })))
    expect(await screen.findByText('READY TO FUND')).toBeInTheDocument()

    fireEvent.click(await screen.findByRole('button', { name: /\[CREATE AND FUND ESCROW\]/i }))
    await waitFor(() => expect(walletMocks.writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({
      address: '0x3333333333333333333333333333333333333333',
      functionName: 'createAndFund',
    })))
    expect(await screen.findByText(/FUNDED RECEIPT OBSERVED/i)).toHaveTextContent(fundingTxHash)
    expect(screen.getByText('FUNDED')).toBeInTheDocument()

    expect(screen.getByText(/DUAL-KEY TRUST BOUNDARY/i)).toHaveTextContent('intent signer')
    fireEvent.click(screen.getByRole('button', { name: /\[SIGN ACTIVATION\]/i }))

    await waitFor(() => expect(walletMocks.signTypedDataAsync).toHaveBeenCalledWith(expect.objectContaining({
      domain: expect.objectContaining({
        name: 'ArcLeptonResearchEscrow',
        verifyingContract: '0x4444444444444444444444444444444444444444',
      }),
      primaryType: 'ActivationAuthorization',
    })))
    await waitFor(() => {
      const startCall = calls.find((call) => call.url.includes('/api/research/start'))
      expect(JSON.parse(String(startCall?.init?.body))).toMatchObject({
        researchId: 'research-escrow-1',
        fundingTxHash,
        fundingLogIndex: 7,
        activationSignature,
        activationAuthorization: {
          escrow: '0x4444444444444444444444444444444444444444',
          researchKey: '0x9999999999999999999999999999999999999999999999999999999999999999',
          buyer: '0xabcdef000000000000000000000000000000c1d3',
          intentSigner: '0x5555555555555555555555555555555555555555',
          initialBudget: '10000',
          expectedExpiresAt: '1893542400',
        },
      })
    })
    expect(navigation.routerPush).toHaveBeenCalledWith('/research?id=research-escrow-1')
  })

  it('stops before escrow funding when the chain changes and lets the user switch back', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/config')) return Response.json(escrowConfig())
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/prepare')) return Response.json(prepareResponse())
      return Response.json({})
    }))
    const { rerender } = render(createElement(ResearchPageClient))

    fireEvent.click(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))
    await screen.findByRole('button', { name: /\[APPROVE USDC\]/i })

    walletMocks.chainId = 1
    rerender(createElement(ResearchPageClient))
    fireEvent.click(screen.getByRole('button', { name: /\[SWITCH TO ARC TESTNET\]/i }))

    await waitFor(() => expect(walletMocks.switchChainAsync).toHaveBeenCalledWith({ chainId: 5_042_002 }))
    expect(walletMocks.writeContractAsync).not.toHaveBeenCalled()
    expect(screen.getByText(/\[ERR\]/)).toHaveTextContent('Wallet, session, chain, or voucher changed')
  })

  it('skips approve when allowance is sufficient and ignores duplicate create clicks', async () => {
    walletMocks.readContract.mockReset()
    walletMocks.readContract.mockResolvedValue(10000n)
    let resolveCreate!: (hash: string) => void
    walletMocks.writeContractAsync.mockReset()
    walletMocks.writeContractAsync.mockReturnValue(new Promise((resolve) => {
      resolveCreate = resolve
    }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/config')) return Response.json(escrowConfig())
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/prepare')) return Response.json(prepareResponse())
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))

    expect(await screen.findByText('READY TO FUND')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\[APPROVE USDC\]/i })).not.toBeInTheDocument()

    const createButton = screen.getByRole('button', { name: /\[CREATE AND FUND ESCROW\]/i })
    fireEvent.click(createButton)
    fireEvent.click(createButton)

    await waitFor(() => expect(walletMocks.writeContractAsync).toHaveBeenCalledTimes(1))
    expect(walletMocks.writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'createAndFund',
    }))

    resolveCreate(fundingTxHash)
    expect(await screen.findByText(/FUNDED RECEIPT OBSERVED/i)).toHaveTextContent(fundingTxHash)
  })

  it('keeps the funded escrow recoverable after buyer rejects the activation signature', async () => {
    walletMocks.signTypedDataAsync
      .mockRejectedValueOnce(new Error('User rejected the request'))
      .mockResolvedValueOnce(activationSignature)
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/api/research/config')) return Response.json(escrowConfig())
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      if (url.includes('/api/research/prepare')) return Response.json(prepareResponse())
      if (url.includes('/api/research/start')) {
        return Response.json({ researchId: 'research-escrow-1', status: 'funding', activationPhase: 'activating' }, { status: 202 })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(await screen.findByRole('button', { name: /\[ ▸ START RESEARCH \]/i }))
    fireEvent.click(await screen.findByRole('button', { name: /\[APPROVE USDC\]/i }))
    fireEvent.click(await screen.findByRole('button', { name: /\[CREATE AND FUND ESCROW\]/i }))
    fireEvent.click(await screen.findByRole('button', { name: /\[SIGN ACTIVATION\]/i }))

    expect(await screen.findByText(/\[ERR\]/)).toHaveTextContent('Activation signature rejected')
    expect(calls.some((call) => call.url.includes('/api/research/start'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /\[SIGN ACTIVATION\]/i }))
    await waitFor(() => expect(calls.some((call) => call.url.includes('/api/research/start'))).toBe(true))
    expect((await screen.findAllByText(/ACTIVATING ON CHAIN/i)).length).toBeGreaterThan(0)
  })

  it('restores a prepared escrow funding state after page reload without creating a second prepare', async () => {
    window.localStorage.setItem('arc:research-funding-state', JSON.stringify({
      prepare: prepareResponse(),
      topic: 'SHOULD I BUY PEPE?',
      budget: '0.0100',
      idempotencyKey: 'research-existing-key',
      stage: 'needs_create',
      fundingTxHash,
      fundingLogIndex: 7,
    }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/config')) return Response.json(escrowConfig())
      if (url.includes('/api/quota')) return Response.json(quotaResponse())
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByText(/PREDICTED ESCROW/i)).toBeInTheDocument()
    expect(screen.getByText('0x4444444444444444444444444444444444444444')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\[SIGN ACTIVATION\]/i })).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalledWith('/api/research/prepare', expect.anything())
  })

  it('renders six quick prompts from the expanded randomized pool and rotates through the same deck until the user edits the topic', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await act(async () => {
      render(createElement(ResearchPageClient))
    })

    const topic = screen.getByLabelText('TOPIC')
    expect(getQuickPromptLabels()).toEqual(shiftedPromptDeck.slice(0, 6).map((prompt) => `[${prompt}]`))
    expect(topic).toHaveValue(shiftedPromptDeck[0])

    act(() => {
      vi.advanceTimersByTime(4500)
    })
    expect(topic).toHaveValue(shiftedPromptDeck[1])

    fireEvent.change(topic, { target: { value: 'CUSTOM MARKET QUESTION' } })

    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(topic).toHaveValue('CUSTOM MARKET QUESTION')
  })

  it('keeps the randomized quick prompt order stable within one mount and reshuffles on remount', async () => {
    const firstMountCalls = Array(expandedPromptPool.length - 1).fill(0.999)
    const secondMountCalls = Array(expandedPromptPool.length - 1).fill(0)
    const randomSpy = vi
      .spyOn(Math, 'random')
      .mockImplementation(() => firstMountCalls.shift() ?? secondMountCalls.shift() ?? 0)

    let unmount!: () => void
    await act(async () => {
      ;({ unmount } = render(createElement(ResearchPageClient)))
    })
    const firstMountPrompts = getQuickPromptLabels()

    fireEvent.change(screen.getByDisplayValue('0.0100'), { target: { value: '0.0200' } })
    expect(getQuickPromptLabels()).toEqual(firstMountPrompts)

    unmount()
    await act(async () => {
      render(createElement(ResearchPageClient))
    })

    expect(getQuickPromptLabels()).toEqual(expandedPromptPool.slice(1, 7).map((prompt) => `[${prompt}]`))
    expect(getQuickPromptLabels()).not.toEqual(firstMountPrompts)
  })

  it('keeps a clicked quick prompt selected after the rotation timer advances', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await act(async () => {
      render(createElement(ResearchPageClient))
    })

    const selectedPrompt = shiftedPromptDeck[2]
    fireEvent.click(screen.getByRole('button', { name: `[${selectedPrompt}]` }))

    const topic = screen.getByLabelText('TOPIC')
    expect(topic).toHaveValue(selectedPrompt)

    act(() => {
      vi.advanceTimersByTime(9000)
    })
    expect(topic).toHaveValue(selectedPrompt)
  })

  it('restores the completed report when returning to an existing research session', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByTestId('agent-log-events')).toHaveTextContent('# Restored report')
    expect(screen.getByRole('button', { name: /\[VIEW FULL REPORT →\]/i })).toBeInTheDocument()
  })

  it('merges tx_log settlement status into pending live payment events from the initial detail load', async () => {
    navigation.searchId = 'research-1'
    let resolveDetail!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1')) {
        return new Promise<Response>((resolve) => {
          resolveDetail = resolve
        })
      }
      return Promise.resolve(Response.json({}))
    }))

    render(createElement(ResearchPageClient))

    act(() => {
      agentLogHarness.onEvent?.({
        type: 'tool_result',
        callId: 'call-news',
        name: 'news',
        payment: {
          amount: '0.0003',
          txHash: null,
          txStatus: 'pending',
          chainId: null,
          blockNumber: null,
          requestId: 'req-news',
        },
        dataPreview: '{}',
      } as never)
    })

    await act(async () => {
      resolveDetail(Response.json({
        research: {
          id: 'research-1',
          address: '0xabcdef000000000000000000000000000000c1d3',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: '0.0003',
          status: 'completed',
          reportMd: '# Restored report',
          errorMessage: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:18.000Z',
        },
        txLog: [
          {
            id: 'tx-news',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'news',
            amount: '0.0003',
            txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
            txStatus: 'confirmed',
            chainId: 5_042_002,
            blockNumber: '12345',
            settlementId: 'settlement-1',
            requestId: 'req-news',
            errorMessage: null,
            createdAt: '2026-06-25T00:00:05.000Z',
          },
        ],
      }))
    })

    await waitFor(() => {
      expect(screen.getByTestId('tx-feed-events')).toHaveTextContent('"txStatus":"confirmed"')
      expect(screen.getByTestId('tx-feed-events')).toHaveTextContent('"txHash":"0x1111111111111111111111111111111111111111111111111111111111111111"')
    })
  })

  it('materializes tx_log rows into the TX feed when restoring a completed research session', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0006',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [
            {
              id: 'tx-confirmed',
              address: '0xabcdef000000000000000000000000000000c1d3',
              source: 'news',
              amount: '0.0003',
              txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
              txStatus: 'confirmed',
              chainId: 5_042_002,
              blockNumber: '12345',
              settlementId: 'settlement-1',
              requestId: 'req-confirmed',
              errorMessage: null,
              createdAt: '2026-06-25T00:00:05.000Z',
            },
            {
              id: 'tx-failed',
              address: '0xabcdef000000000000000000000000000000c1d3',
              source: 'whale-watch',
              amount: '0.0002',
              txHash: null,
              txStatus: 'failed',
              chainId: null,
              blockNumber: null,
              settlementId: 'settlement-1',
              requestId: 'req-failed',
              errorMessage: 'RPC timeout',
              createdAt: '2026-06-25T00:00:06.000Z',
            },
            {
              id: 'tx-pending',
              address: '0xabcdef000000000000000000000000000000c1d3',
              source: 'twitter-signals',
              amount: '0.0001',
              txHash: null,
              txStatus: 'pending',
              chainId: null,
              blockNumber: null,
              settlementId: null,
              requestId: 'req-pending',
              errorMessage: null,
              createdAt: '2026-06-25T00:00:07.000Z',
            },
          ],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByTestId('agent-log-events')).toHaveTextContent('# Restored report')
    await waitFor(() => {
      expect(screen.getByTestId('tx-feed-events')).toHaveTextContent('"txStatus":"confirmed"')
      expect(screen.getByTestId('tx-feed-events')).toHaveTextContent('"txStatus":"failed"')
      expect(screen.getByTestId('tx-feed-events')).toHaveTextContent('"txStatus":"pending"')
      expect(screen.getByTestId('tx-feed-events')).toHaveTextContent('"name":"news"')
      expect(screen.getByTestId('tx-feed-events')).toHaveTextContent('"name":"whale-watch"')
    })
  })

  it('polls research detail after terminal events until pending payment statuses settle', async () => {
    vi.useFakeTimers()
    navigation.searchId = 'research-1'
    let detailCalls = 0
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/research/research-1') {
        detailCalls += 1
        return Promise.resolve(Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0003',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: detailCalls >= 2 ? [
            {
              id: 'tx-news',
              address: '0xabcdef000000000000000000000000000000c1d3',
              source: 'news',
              amount: '0.0003',
              txHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
              txStatus: 'confirmed',
              chainId: 5_042_002,
              blockNumber: '67890',
              settlementId: 'settlement-1',
              requestId: 'req-news',
              errorMessage: null,
              createdAt: '2026-06-25T00:00:05.000Z',
            },
          ] : [],
        }))
      }
      return Promise.resolve(Response.json({}))
    }))

    render(createElement(ResearchPageClient))

    act(() => {
      agentLogHarness.onEvent?.({
        type: 'tool_result',
        callId: 'call-news',
        name: 'news',
        payment: {
          amount: '0.0003',
          txHash: null,
          txStatus: 'pending',
          chainId: null,
          blockNumber: null,
          requestId: 'req-news',
        },
        dataPreview: '{}',
      } as never)
      agentLogHarness.onEvent?.({
        type: 'final',
        reportMd: '# Report',
        totalSpentUsdc: '0.0003',
        totalCalls: 1,
      })
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(detailCalls).toBe(1)

    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(detailCalls).toBe(2)
  })

  it('marks the UI cancelled locally and ignores late agent events after cancel succeeds', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/cancel') && init?.method === 'POST') {
        return Response.json({ researchId: 'research-1', status: 'cancelled' })
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0004',
            status: 'running',
            reportMd: null,
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: null,
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    const cancelButton = screen.getByRole('button', { name: /\[CANCEL\]/i })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/research/research-1/cancel', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    })))
    await waitFor(() => expect(screen.getByTestId('agent-log-events')).toHaveTextContent('Research cancelled'))
    expect(screen.getByRole('button', { name: /\[CANCEL\]/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /\[ASK FOLLOW-UP →\]/i })).not.toBeInTheDocument()

    act(() => {
      agentLogHarness.onEvent?.({
        type: 'thinking',
        text: 'Late answer should be ignored',
        receivedAt: '12:00:00',
      })
    })

    expect(screen.getByTestId('agent-log-events')).not.toHaveTextContent('Late answer should be ignored')
  })

  it('stops visible streaming immediately while the cancel request is still pending', async () => {
    navigation.searchId = 'research-1'
    let resolveCancel!: (response: Response) => void
    const pendingCancel = new Promise<Response>((resolve) => {
      resolveCancel = resolve
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/cancel') && init?.method === 'POST') {
        return pendingCancel
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0004',
            status: 'running',
            reportMd: null,
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: null,
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    fireEvent.click(screen.getByRole('button', { name: /\[CANCEL\]/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/research/research-1/cancel', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    })))
    expect(screen.getByTestId('agent-log-events')).toHaveTextContent('Research cancelled')

    act(() => {
      agentLogHarness.onEvent?.({
        type: 'thinking',
        text: 'Late stream text while cancel request is pending',
        receivedAt: '12:00:01',
      })
    })

    expect(screen.getByTestId('agent-log-events')).not.toHaveTextContent('Late stream text while cancel request is pending')

    resolveCancel(Response.json({ researchId: 'research-1', status: 'cancelled' }))
  })

  it('shows a live follow-up composer below the grid after the session completes', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByRole('button', { name: /\[ASK FOLLOW-UP →\]/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ask a follow-up about this report/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i })).toBeInTheDocument()
  })

  it('loads existing live follow-up history after the session completes', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups')) {
        return Response.json({
          followUps: [
            {
              id: 'fu-1',
              researchId: 'research-1',
              address: '0xabcdef000000000000000000000000000000c1d3',
              question: 'What would invalidate DOGE leadership?',
              answerMd: '## Follow-up Answer\nDOGE loses leadership if volume fades.',
              status: 'completed',
              spentUsdc: '0',
              errorMessage: null,
              createdAt: '2026-06-27T08:04:00.000Z',
              completedAt: '2026-06-27T08:04:08.000Z',
            },
          ],
        })
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    expect(await screen.findByText('What would invalidate DOGE leadership?')).toBeInTheDocument()
    expect(screen.getByText(/doge loses leadership if volume fades\./i)).toBeInTheDocument()
  })

  it('submits a live follow-up, shows a pending state, and appends the returned answer', async () => {
    navigation.searchId = 'research-1'
    let resolveFollowUp!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups') && init?.method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolveFollowUp = resolve
        })
      }
      if (url.includes('/api/research/research-1')) {
        return Promise.resolve(Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        }))
      }
      return Promise.resolve(Response.json({}))
    }))

    render(createElement(ResearchPageClient))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Does DOGE still lead after the sentiment shift?' } })
    fireEvent.click(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i }))

    expect(await screen.findByText(/generating follow-up answer/i)).toBeInTheDocument()
    expect(screen.getByText('PENDING')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/research/research-1/follow-ups', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))

    resolveFollowUp(Response.json({
      followUp: {
        id: 'fu-2',
        researchId: 'research-1',
        address: '0xabcdef000000000000000000000000000000c1d3',
        question: 'Does DOGE still lead after the sentiment shift?',
        answerMd: '## Follow-up Answer\nDOGE still leads, but the gap is narrowing.',
        status: 'completed',
        spentUsdc: '0',
        errorMessage: null,
        createdAt: '2026-06-27T08:05:00.000Z',
        completedAt: '2026-06-27T08:05:08.000Z',
      },
    }))

    expect(await screen.findByText(/doge still leads, but the gap is narrowing\./i)).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('shows a returned live follow-up while the initial history request is still loading', async () => {
    navigation.searchId = 'research-1'
    let resolveHistory!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups') && init?.method === 'POST') {
        return Promise.resolve(Response.json({
          followUp: {
            id: 'fu-new',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Does DOGE still lead while history is slow?',
            answerMd: '## Follow-up Answer\nDOGE still leads while history is loading.',
            status: 'completed',
            spentUsdc: '0',
            errorMessage: null,
            createdAt: '2026-06-27T08:05:00.000Z',
            completedAt: '2026-06-27T08:05:08.000Z',
          },
        }))
      }
      if (url.includes('/api/research/research-1/follow-ups')) {
        return new Promise<Response>((resolve) => {
          resolveHistory = resolve
        })
      }
      if (url.includes('/api/research/research-1')) {
        return Promise.resolve(Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        }))
      }
      return Promise.resolve(Response.json({}))
    }))

    render(createElement(ResearchPageClient))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Does DOGE still lead while history is slow?' } })
    fireEvent.click(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i }))

    expect(await screen.findByText(/doge still leads while history is loading\./i)).toBeInTheDocument()

    await act(async () => {
      resolveHistory(Response.json({
        followUps: [
          {
            id: 'fu-old',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Earlier DOGE question',
            answerMd: 'Earlier answer.',
            status: 'completed',
            spentUsdc: '0',
            errorMessage: null,
            createdAt: '2026-06-27T08:00:00.000Z',
            completedAt: '2026-06-27T08:00:08.000Z',
          },
        ],
      }))
    })

    const earlierQuestion = await screen.findByText('Earlier DOGE question')
    const newQuestion = screen.getByText('Does DOGE still lead while history is slow?')
    expect(Boolean(earlierQuestion.compareDocumentPosition(newQuestion) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('appends a failed live follow-up card and shows an English error when generation fails', async () => {
    navigation.searchId = 'research-1'
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/research/research-1/follow-ups') && init?.method === 'POST') {
        return Response.json({
          error: 'FOLLOW_UP_FAILED',
          followUp: {
            id: 'fu-9',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Need one more DOGE invalidation check.',
            answerMd: null,
            status: 'failed',
            spentUsdc: '0',
            errorMessage: 'Follow-up answer generation failed',
            createdAt: '2026-06-27T08:06:00.000Z',
            completedAt: '2026-06-27T08:06:05.000Z',
          },
        }, { status: 502 })
      }
      if (url.includes('/api/research/research-1')) {
        return Response.json({
          research: {
            id: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            topic: 'SHOULD I BUY PEPE?',
            budgetUsdc: '0.01',
            spentUsdc: '0.0012',
            status: 'completed',
            reportMd: '# Restored report',
            errorMessage: null,
            startedAt: '2026-06-25T00:00:00.000Z',
            completedAt: '2026-06-25T00:00:18.000Z',
          },
          txLog: [],
        })
      }
      return Response.json({})
    }))

    render(createElement(ResearchPageClient))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Need one more DOGE invalidation check.' } })
    fireEvent.click(screen.getByRole('button', { name: /\[SUBMIT FOLLOW-UP\]/i }))

    expect(await screen.findByText(/the follow-up answer could not be generated\. please try again\./i)).toBeInTheDocument()
    expect(screen.getAllByText('Need one more DOGE invalidation check.').length).toBeGreaterThan(0)
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })
})
