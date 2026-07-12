import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  POSTGRES_URL: process.env.POSTGRES_URL,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PHASE: process.env.NEXT_PHASE,
  ARC_RESEARCH_SETTLEMENT_BACKEND: process.env.ARC_RESEARCH_SETTLEMENT_BACKEND,
  ARC_RECEIPT_MODE: process.env.ARC_RECEIPT_MODE,
}

const memoryRepoGlobal = globalThis as typeof globalThis & {
  __arcLeptonUsersRepo?: unknown
  __arcLeptonTxLogRepo?: unknown
  __arcLeptonPaymentSettlementRepo?: unknown
  __arcLeptonResearchRepo?: unknown
  __arcLeptonResearchFollowUpRepo?: unknown
  __arcLeptonWorkflowOutboxRepo?: unknown
  __arcLeptonResearchEventRepo?: unknown
  __arcLeptonResearchQuotaRepo?: unknown
  __arcLeptonResearchQuotaStore?: unknown
  __arcLeptonUsersRepoWarned?: boolean
  __arcLeptonTxLogRepoWarned?: boolean
  __arcLeptonPaymentSettlementRepoWarned?: boolean
  __arcLeptonResearchRepoWarned?: boolean
  __arcLeptonResearchFollowUpRepoWarned?: boolean
  __arcLeptonWorkflowOutboxRepoWarned?: boolean
  __arcLeptonResearchEventRepoWarned?: boolean
  __arcLeptonResearchQuotaRepoWarned?: boolean
}
const mutableEnv = process.env as Record<string, string | undefined>

function restoreEnv(name: keyof typeof originalEnv) {
  const value = originalEnv[name]
  if (value === undefined) {
    delete mutableEnv[name]
    return
  }

  mutableEnv[name] = value
}

function clearMemoryRepoGlobals() {
  delete memoryRepoGlobal.__arcLeptonUsersRepo
  delete memoryRepoGlobal.__arcLeptonTxLogRepo
  delete memoryRepoGlobal.__arcLeptonPaymentSettlementRepo
  delete memoryRepoGlobal.__arcLeptonResearchRepo
  delete memoryRepoGlobal.__arcLeptonResearchFollowUpRepo
  delete memoryRepoGlobal.__arcLeptonWorkflowOutboxRepo
  delete memoryRepoGlobal.__arcLeptonResearchEventRepo
  delete memoryRepoGlobal.__arcLeptonResearchQuotaRepo
  delete memoryRepoGlobal.__arcLeptonResearchQuotaStore
  delete memoryRepoGlobal.__arcLeptonUsersRepoWarned
  delete memoryRepoGlobal.__arcLeptonTxLogRepoWarned
  delete memoryRepoGlobal.__arcLeptonPaymentSettlementRepoWarned
  delete memoryRepoGlobal.__arcLeptonResearchRepoWarned
  delete memoryRepoGlobal.__arcLeptonResearchFollowUpRepoWarned
  delete memoryRepoGlobal.__arcLeptonWorkflowOutboxRepoWarned
  delete memoryRepoGlobal.__arcLeptonResearchEventRepoWarned
  delete memoryRepoGlobal.__arcLeptonResearchQuotaRepoWarned
}

describe('db dev fallback repos', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    delete mutableEnv.DATABASE_URL
    delete mutableEnv.POSTGRES_URL
    delete mutableEnv.NEXT_PHASE
    delete mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND
    delete mutableEnv.ARC_RECEIPT_MODE
    mutableEnv.NODE_ENV = 'test'
    clearMemoryRepoGlobals()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    restoreEnv('DATABASE_URL')
    restoreEnv('POSTGRES_URL')
    restoreEnv('NODE_ENV')
    restoreEnv('NEXT_PHASE')
    restoreEnv('ARC_RESEARCH_SETTLEMENT_BACKEND')
    restoreEnv('ARC_RECEIPT_MODE')
    clearMemoryRepoGlobals()
  })

  it('shares the in-memory tx_log fallback across module reloads', async () => {
    const first = await import('./index')
    await first.txLogRepo.record({
      address: '0xabc',
      source: 'sentiment',
      amount: '0.0001',
    })

    vi.resetModules()
    const second = await import('./index')

    expect(await second.txLogRepo.totalSpentByAddress('0xabc')).toBe('0.0001')
  })

  it('does not load postgres packages when dev fallback repos are active', async () => {
    vi.doMock('drizzle-orm/vercel-postgres', () => {
      throw new Error('postgres driver should not load without DB env')
    })
    vi.doMock('@vercel/postgres', () => {
      throw new Error('vercel postgres should not load without DB env')
    })

    const mod = await import('./index')

    expect(await mod.researchRepo.countAll()).toBe(0)
    expect(await mod.txLogRepo.count()).toBe(0)
  })

  it('shares the in-memory research follow-up fallback across module reloads', async () => {
    const first = await import('./index')
    await first.researchFollowUpRepo.create({
      researchId: 'research-1',
      address: '0xabc',
      question: 'What would invalidate the setup?',
    })

    vi.resetModules()
    const second = await import('./index')
    const items = await second.researchFollowUpRepo.listByResearchId('0xabc', 'research-1', 10)

    expect(items).toHaveLength(1)
    expect(items[0]?.question).toBe('What would invalidate the setup?')
  })

  it('shares the in-memory payment settlement fallback across module reloads', async () => {
    const first = await import('./index')
    const claim = await first.paymentSettlementRepo.claimResearchSettlement({
      address: '0xabc',
      researchId: 'research-1',
      requestIds: ['req-1'],
      totalAmount: '0.0003',
    })
    await first.paymentSettlementRepo.failSettlement(claim.settlement.id, {
      errorMessage: 'RPC timeout',
    })

    vi.resetModules()
    const second = await import('./index')
    const retryable = await second.paymentSettlementRepo.listRetryableSettlements()

    expect(retryable).toHaveLength(1)
    expect(retryable[0]).toMatchObject({
      id: claim.settlement.id,
      status: 'failed',
      errorMessage: 'RPC timeout',
    })
  })

  it('shares the in-memory workflow outbox fallback across module reloads', async () => {
    const first = await import('./index')
    const claim = await first.workflowOutboxRepo.claimOperation({
      operationKey: 'RUN:research-1',
      type: 'RUN',
      researchId: 'research-1',
      phase: 'queued',
      payloadHash: '0xpayload',
      protectedPayloadDigest: '0xdigest',
      leaseOwner: 'worker-a',
      leaseDurationMs: 60_000,
    })

    vi.resetModules()
    const second = await import('./index')
    const existing = await second.workflowOutboxRepo.findByOperationKey('RUN:research-1')

    expect(claim.status).toBe('claimed')
    expect(existing).toMatchObject({
      operationKey: 'RUN:research-1',
      type: 'RUN',
      researchId: 'research-1',
    })
  })

  it('shares the in-memory durable research event fallback across module reloads', async () => {
    const first = await import('./index')
    await first.researchEventRepo.appendEvent({
      researchId: 'research-1',
      type: 'thinking',
      payload: { text: 'hello' },
      payloadHash: '0xevent',
      dedupeKey: 'event-1',
    })

    vi.resetModules()
    const second = await import('./index')
    const events = await second.researchEventRepo.listByResearch('research-1')

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      researchId: 'research-1',
      type: 'thinking',
      payloadHash: '0xevent',
    })
  })

  it('shares in-memory quota reservations between research and quota fallback repos', async () => {
    const first = await import('./index')
    const reserved = await first.researchRepo.createFundingWithQuotaReservation({
      address: '0xAbC',
      topic: 'quota sharing',
      budgetUsdc: '0.01',
      fundingExpiresAt: new Date('2026-07-11T00:15:00.000Z'),
    }, {
      day: '2026-07-11',
      resetAt: new Date('2026-07-12T00:00:00.000Z'),
      walletLimit: 10,
      globalLimit: 100,
    })
    expect(reserved.ok).toBe(true)

    await expect(first.researchQuotaRepo.status({
      address: '0xabc',
      day: '2026-07-11',
      resetAt: '2026-07-12T00:00:00.000Z',
    })).resolves.toEqual({
      wallet: { consumed: 0, reserved: 1, used: 1, resetAt: '2026-07-12T00:00:00.000Z' },
      global: { consumed: 0, reserved: 1, used: 1, resetAt: '2026-07-12T00:00:00.000Z' },
    })

    vi.resetModules()
    const second = await import('./index')

    await expect(second.researchQuotaRepo.status({
      address: '0xabc',
      day: '2026-07-11',
      resetAt: '2026-07-12T00:00:00.000Z',
    })).resolves.toEqual({
      wallet: { consumed: 0, reserved: 1, used: 1, resetAt: '2026-07-12T00:00:00.000Z' },
      global: { consumed: 0, reserved: 1, used: 1, resetAt: '2026-07-12T00:00:00.000Z' },
    })
  })

  it('fails closed for escrow backend without durable DB outside tests', async () => {
    mutableEnv.NODE_ENV = 'production'
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    delete mutableEnv.DATABASE_URL
    delete mutableEnv.POSTGRES_URL
    vi.resetModules()

    const mod = await import('./index')

    expect(() => mod.assertDurableDbAvailableForEscrow('prepare')).toThrow(
      expect.objectContaining({ code: 'DURABLE_DB_REQUIRED' }),
    )
  })

  it('requires durable DB for existing escrow worker state even during calldata rollback', async () => {
    mutableEnv.NODE_ENV = 'production'
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    delete mutableEnv.DATABASE_URL
    delete mutableEnv.POSTGRES_URL
    vi.resetModules()

    const mod = await import('./index')

    expect(() => mod.assertDurableDbAvailable('research workflow worker')).toThrow(
      expect.objectContaining({ code: 'DURABLE_DB_REQUIRED' }),
    )
    expect(() => mod.assertDurableDbAvailableForEscrow('legacy calldata')).not.toThrow()
  })

  it('allows calldata backend and test escrow paths to use memory fallback', async () => {
    mutableEnv.NODE_ENV = 'production'
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'calldata'
    vi.resetModules()
    const calldata = await import('./index')
    expect(() => calldata.assertDurableDbAvailableForEscrow('legacy calldata')).not.toThrow()

    mutableEnv.NODE_ENV = 'test'
    mutableEnv.ARC_RESEARCH_SETTLEMENT_BACKEND = 'escrow'
    vi.resetModules()
    const testEscrow = await import('./index')
    expect(() => testEscrow.assertDurableDbAvailableForEscrow('unit test')).not.toThrow()
  })
})
