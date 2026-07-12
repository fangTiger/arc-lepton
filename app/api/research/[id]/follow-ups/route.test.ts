import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { signSessionJwt } from '@/lib/auth/jwt'
import type { ResearchFollowUp } from '@/lib/db/research-follow-up-repo'

const mockState = vi.hoisted(() => {
  const followUps: ResearchFollowUp[] = [
    {
      id: 'fu-1',
      researchId: 'research-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      question: 'What is the main invalidation level?',
      answerMd: 'Losing the current support would weaken the thesis.',
      status: 'completed' as const,
      spentUsdc: '0',
      errorMessage: null,
      createdAt: new Date('2026-06-27T08:00:00.000Z'),
      completedAt: new Date('2026-06-27T08:00:10.000Z'),
    },
  ]
  const researches = [
    {
      id: 'research-1',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SHOULD I BUY PEPE?',
      budgetUsdc: '0.01',
      spentUsdc: '0.0012',
      status: 'completed' as const,
      reportMd: '# Report\n\nWait for confirmation.',
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: new Date('2026-06-25T00:00:18.000Z'),
    },
    {
      id: 'research-2',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'BTC PRICE PREDICTION',
      budgetUsdc: '0.02',
      spentUsdc: '0.0005',
      status: 'running' as const,
      reportMd: null,
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: null,
    },
    {
      id: 'research-3',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'SOL ECOSYSTEM HEALTH',
      budgetUsdc: '0.002',
      spentUsdc: '0.002',
      status: 'completed' as const,
      reportMd: '# Report\n\nNo remaining budget.',
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: new Date('2026-06-25T00:00:18.000Z'),
    },
    {
      id: 'research-4',
      address: '0x9999000000000000000000000000000000000001',
      topic: 'PRIVATE RESEARCH',
      budgetUsdc: '0.01',
      spentUsdc: '0.001',
      status: 'completed' as const,
      reportMd: '# Secret',
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: new Date('2026-06-25T00:00:18.000Z'),
    },
    {
      id: 'research-escrow-completed',
      address: '0xabcdef000000000000000000000000000000c1d3',
      topic: 'ESCROW BOUND REPORT',
      budgetUsdc: '0.002',
      spentUsdc: '0.002',
      status: 'completed' as const,
      reportMd: '# Escrow Report\n\nSettlement is already handled asynchronously.',
      errorMessage: null,
      startedAt: new Date('2026-06-25T00:00:00.000Z'),
      completedAt: new Date('2026-06-25T00:00:18.000Z'),
      backend: 'escrow' as const,
      researchKey: `0x${'42'.repeat(32)}`,
      escrowAddress: '0x4444000000000000000000000000000000000001',
      expectedEscrowAddress: '0x4444000000000000000000000000000000000001',
      chainId: 5042002,
      budgetUnits: '2000',
      quotaReservationState: 'consumed' as const,
      activationPhase: 'active' as const,
      finalizationState: 'closing' as const,
      cancelRequestedAt: null,
    },
  ]
  let createdCounter = 1

  return {
    followUps,
    researches,
    answerResearchFollowUp: vi.fn(),
    recordResearchPaymentIntent: vi.fn(),
    settleResearchPayments: vi.fn(),
    workflowOutboxRepo: {
      claimOperation: vi.fn(),
      createOperation: vi.fn(),
      findByOperationKey: vi.fn(),
    },
    txLogRepo: {
      listByResearchId: vi.fn(),
      record: vi.fn(),
      markResearchSettlementPending: vi.fn(),
    },
    reset() {
      createdCounter = 1
      followUps.splice(1)
      this.answerResearchFollowUp.mockReset()
      this.recordResearchPaymentIntent.mockReset()
      this.settleResearchPayments.mockReset()
      this.workflowOutboxRepo.claimOperation.mockReset()
      this.workflowOutboxRepo.createOperation.mockReset()
      this.workflowOutboxRepo.findByOperationKey.mockReset()
      this.txLogRepo.listByResearchId.mockReset()
      this.txLogRepo.record.mockReset()
      this.txLogRepo.markResearchSettlementPending.mockReset()
    },
    researchRepo: {
      async findById(id: string) {
        return researches.find((research) => research.id === id) ?? null
      },
    },
    researchFollowUpRepo: {
      async listByResearchId(address: string, researchId: string, limit = 50) {
        return followUps
          .filter((record) => record.address === address && record.researchId === researchId)
          .slice(0, limit)
          .map((record) => ({ ...record }))
      },
      async create(input: { researchId: string; address: string; question: string }) {
        createdCounter += 1
        const record = {
          id: `fu-${createdCounter}`,
          ...input,
          answerMd: null,
          status: 'pending' as const,
          spentUsdc: '0',
          errorMessage: null,
          createdAt: new Date('2026-06-27T08:05:00.000Z'),
          completedAt: null,
        }
        followUps.push(record)
        return { ...record }
      },
      async complete(id: string, input: { answerMd: string; spentUsdc: string }) {
        const record = followUps.find((entry) => entry.id === id)
        if (!record) return null
        Object.assign(record, {
          answerMd: input.answerMd,
          status: 'completed',
          spentUsdc: input.spentUsdc,
          errorMessage: null,
          completedAt: new Date('2026-06-27T08:05:10.000Z'),
        })
        return { ...record }
      },
      async fail(id: string, errorMessage: string) {
        const record = followUps.find((entry) => entry.id === id)
        if (!record) return null
        Object.assign(record, {
          status: 'failed',
          errorMessage,
          completedAt: new Date('2026-06-27T08:05:10.000Z'),
        })
        return { ...record }
      },
    },
  }
})

vi.mock('@/lib/db', () => ({
  researchRepo: mockState.researchRepo,
  researchFollowUpRepo: mockState.researchFollowUpRepo,
  workflowOutboxRepo: mockState.workflowOutboxRepo,
  txLogRepo: mockState.txLogRepo,
}))

vi.mock('@/lib/agent/research-follow-up', () => ({
  answerResearchFollowUp: mockState.answerResearchFollowUp,
}))

vi.mock('@/lib/x402/payment-recorder', () => ({
  recordResearchPaymentIntent: mockState.recordResearchPaymentIntent,
}))

vi.mock('@/lib/x402/payment-settlement', () => ({
  settleResearchPayments: mockState.settleResearchPayments,
}))

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-32b'
})

beforeEach(() => {
  mockState.reset()
})

async function authedRequest(path: string, init?: RequestInit) {
  const jwt = await signSessionJwt('0xAbCdEf000000000000000000000000000000C1d3')
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      cookie: `arc_session=${jwt}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

describe('GET /api/research/[id]/follow-ups', () => {
  it('requires auth', async () => {
    const { GET } = await import('./route')

    const res = await GET(new Request('http://localhost/api/research/research-1/follow-ups'), { params: { id: 'research-1' } })

    expect(res.status).toBe(401)
  })

  it('lists owned follow-up records', async () => {
    const { GET } = await import('./route')

    const res = await GET(await authedRequest('/api/research/research-1/follow-ups'), { params: { id: 'research-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.followUps).toEqual([
      expect.objectContaining({
        id: 'fu-1',
        question: 'What is the main invalidation level?',
        answerMd: 'Losing the current support would weaken the thesis.',
        status: 'completed',
      }),
    ])
    expect(body.followUps[0]?.createdAt).toBe('2026-06-27T08:00:00.000Z')
  })

  it('forbids access to another users report', async () => {
    const { GET, POST } = await import('./route')

    const getRes = await GET(await authedRequest('/api/research/research-4/follow-ups'), { params: { id: 'research-4' } })
    const postRes = await POST(await authedRequest('/api/research/research-4/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ question: 'Can I see this?' }),
    }), { params: { id: 'research-4' } })

    expect(getRes.status).toBe(403)
    expect(postRes.status).toBe(403)
  })
})

describe('POST /api/research/[id]/follow-ups', () => {
  it('validates the request body', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest('/api/research/research-1/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ question: '   ' }),
    }), { params: { id: 'research-1' } })

    expect(res.status).toBe(400)
  })

  it('creates a successful follow-up answer using the original report and prior Q&A', async () => {
    mockState.answerResearchFollowUp.mockResolvedValue('## Follow-up Answer\nStill wait for stronger confirmation.')
    const { POST } = await import('./route')

    const res = await POST(await authedRequest('/api/research/research-1/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ question: 'Does the setup improve if volume expands?' }),
    }), { params: { id: 'research-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.followUp).toEqual(expect.objectContaining({
      researchId: 'research-1',
      question: 'Does the setup improve if volume expands?',
      answerMd: '## Follow-up Answer\nStill wait for stronger confirmation.',
      status: 'completed',
      spentUsdc: '0',
    }))
    expect(mockState.recordResearchPaymentIntent).not.toHaveBeenCalled()
    expect(mockState.settleResearchPayments).not.toHaveBeenCalled()
    expect(mockState.answerResearchFollowUp).toHaveBeenCalledWith({
      topic: 'SHOULD I BUY PEPE?',
      reportMd: '# Report\n\nWait for confirmation.',
      history: [
        {
          question: 'What is the main invalidation level?',
          answerMd: 'Losing the current support would weaken the thesis.',
        },
      ],
      question: 'Does the setup improve if volume expands?',
    })
  })

  it('answers escrow-bound completed research follow-ups without touching Escrow or original spending', async () => {
    mockState.answerResearchFollowUp.mockResolvedValue('## Follow-up Answer\nUse the settled report only.')
    const originalResearch = mockState.researches.find((research) => research.id === 'research-escrow-completed')
    expect(originalResearch).toMatchObject({
      spentUsdc: '0.002',
      finalizationState: 'closing',
      escrowAddress: '0x4444000000000000000000000000000000000001',
    })
    const { POST } = await import('./route')

    const res = await POST(await authedRequest('/api/research/research-escrow-completed/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ question: 'Can I ask one follow-up after settlement starts?' }),
    }), { params: { id: 'research-escrow-completed' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.followUp).toEqual(expect.objectContaining({
      researchId: 'research-escrow-completed',
      question: 'Can I ask one follow-up after settlement starts?',
      answerMd: '## Follow-up Answer\nUse the settled report only.',
      status: 'completed',
      spentUsdc: '0',
    }))
    expect(mockState.recordResearchPaymentIntent).not.toHaveBeenCalled()
    expect(mockState.settleResearchPayments).not.toHaveBeenCalled()
    expect(mockState.workflowOutboxRepo.claimOperation).not.toHaveBeenCalled()
    expect(mockState.workflowOutboxRepo.createOperation).not.toHaveBeenCalled()
    expect(mockState.workflowOutboxRepo.findByOperationKey).not.toHaveBeenCalled()
    expect(mockState.txLogRepo.listByResearchId).not.toHaveBeenCalled()
    expect(mockState.txLogRepo.record).not.toHaveBeenCalled()
    expect(mockState.txLogRepo.markResearchSettlementPending).not.toHaveBeenCalled()
    expect(originalResearch).toMatchObject({
      spentUsdc: '0.002',
      budgetUsdc: '0.002',
      finalizationState: 'closing',
      quotaReservationState: 'consumed',
      activationPhase: 'active',
      escrowAddress: '0x4444000000000000000000000000000000000001',
      expectedEscrowAddress: '0x4444000000000000000000000000000000000001',
    })
    expect(mockState.answerResearchFollowUp).toHaveBeenCalledWith({
      topic: 'ESCROW BOUND REPORT',
      reportMd: '# Escrow Report\n\nSettlement is already handled asynchronously.',
      history: [],
      question: 'Can I ask one follow-up after settlement starts?',
    })
  })

  it('rejects follow-ups when the original report is not ready', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest('/api/research/research-2/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ question: 'Any update?' }),
    }), { params: { id: 'research-2' } })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'REPORT_NOT_READY' })
  })

  it('rejects follow-ups when the budget is exhausted', async () => {
    const { POST } = await import('./route')

    const res = await POST(await authedRequest('/api/research/research-3/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ question: 'Can we take one more look?' }),
    }), { params: { id: 'research-3' } })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'BUDGET_EXHAUSTED' })
  })

  it('returns FOLLOW_UP_FAILED and persists a failed follow-up when answer generation throws', async () => {
    mockState.answerResearchFollowUp.mockRejectedValue(new Error('deepseek timeout'))
    const { POST } = await import('./route')

    const res = await POST(await authedRequest('/api/research/research-1/follow-ups', {
      method: 'POST',
      body: JSON.stringify({ question: 'Need one more angle on invalidation.' }),
    }), { params: { id: 'research-1' } })
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body).toEqual({
      error: 'FOLLOW_UP_FAILED',
      followUp: expect.objectContaining({
        researchId: 'research-1',
        question: 'Need one more angle on invalidation.',
        answerMd: null,
        status: 'failed',
        errorMessage: 'Follow-up answer generation failed',
      }),
    })
  })
})
