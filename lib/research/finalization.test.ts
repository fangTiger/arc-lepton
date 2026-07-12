import { describe, expect, it } from 'vitest'
import { settlementResultDigest, TERMINAL_STATE_PAID, TERMINAL_STATE_UNPAYABLE_MANUAL } from '@/lib/chain/canonical'
import { MemoryResearchRepo } from '@/lib/db/research-repo-memory'
import { MemoryTxLogRepo } from '@/lib/db/tx-log-repo-memory'
import { MemoryWorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo-memory'
import {
  EMPTY_FINAL_LIABILITY_HASH,
  buildCloseAuthorizationPayload,
  buildFinalLiabilitySnapshot,
  finalizeResearchReport,
} from './finalization'

const researchKey = `0x${'ab'.repeat(32)}`
const escrowAddress = '0xE000000000000000000000000000000000000001'
const requestKey = `0x${'01'.repeat(32)}`
const secondRequestKey = `0x${'02'.repeat(32)}`
const sourceId = `0x${'03'.repeat(32)}`
const settlementKey = `0x${'04'.repeat(32)}`
const itemsHash = `0x${'05'.repeat(32)}`
const manualEvidence = `0x${'06'.repeat(32)}`

describe('research finalization closing barrier', () => {
  it('completes a no-intent escrow research, saves the report, and creates only CLOSE with the fixed empty liability hash', async () => {
    const fixture = await activeEscrowResearch()

    const result = await finalizeResearchReport({
      researchId: fixture.research.id,
      reportMd: '# Final report',
      workerId: 'runner-a',
    }, fixture)

    expect(result).toEqual({ status: 'completed', settlementRequired: false, closeOperationKey: `CLOSE:${fixture.research.id}` })
    await expect(fixture.researchRepo.findById(fixture.research.id)).resolves.toMatchObject({
      status: 'completed',
      finalizationState: 'closing',
      reportMd: '# Final report',
    })
    await expect(fixture.workflowOutboxRepo.findByOperationKey(`SETTLE:${fixture.research.id}`)).resolves.toBeNull()
    await expect(fixture.workflowOutboxRepo.findByOperationKey(`RECONCILE:${fixture.research.id}`)).resolves.toBeNull()
    await expect(fixture.workflowOutboxRepo.findByOperationKey(`CLOSE:${fixture.research.id}`)).resolves.toMatchObject({
      type: 'CLOSE',
      phase: 'queued',
      payloadHash: expect.any(String),
    })
    expect(EMPTY_FINAL_LIABILITY_HASH).toBe('0xa700e53730858c2f4b9b5e2287eb6277837358afa904bd8288dccd07809876e4')
  })

  it('freezes existing escrow intents and creates deterministic SETTLE, RECONCILE, and CLOSE operations', async () => {
    const fixture = await activeEscrowResearch()
    await recordEscrowIntent(fixture.txLogRepo, fixture.research.id, fixture.research.address, {
      requestId: 'intent-1',
      requestKey,
      toolOrdinal: 1,
    })

    const result = await finalizeResearchReport({
      researchId: fixture.research.id,
      reportMd: '# Report with paid tool',
      workerId: 'runner-a',
    }, fixture)

    expect(result).toMatchObject({ status: 'completed', settlementRequired: true })
    await expect(fixture.workflowOutboxRepo.findByOperationKey(`SETTLE:${fixture.research.id}`)).resolves.toMatchObject({
      type: 'SETTLE',
      phase: 'queued',
      escrowAddress,
    })
    await expect(fixture.workflowOutboxRepo.findByOperationKey(`RECONCILE:${fixture.research.id}`)).resolves.toMatchObject({
      type: 'RECONCILE',
      phase: 'queued',
      escrowAddress,
    })
    await expect(fixture.workflowOutboxRepo.findByOperationKey(`CLOSE:${fixture.research.id}`)).resolves.toMatchObject({
      type: 'CLOSE',
      phase: 'queued',
      escrowAddress,
    })
  })

  it('establishes the closing barrier so a concurrent intent creation check loses after finalization', async () => {
    const fixture = await activeEscrowResearch()

    await expect(finalizeResearchReport({
      researchId: fixture.research.id,
      reportMd: '# Done',
    }, fixture)).resolves.toMatchObject({ status: 'completed' })

    await expect(fixture.researchRepo.transitionLifecycle(
      fixture.research.id,
      { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
      { finalizationState: 'closing' },
    )).resolves.toBe(false)
    await expect(fixture.researchRepo.findById(fixture.research.id)).resolves.toMatchObject({
      status: 'completed',
      finalizationState: 'closing',
    })
  })

  it('builds canonical PAID and manual liabilities with spent matching the PAID result digest', async () => {
    const paidIntent = txIntent({ requestId: 'intent-1', requestKey, amountUnits: '100' })
    const manualIntent = txIntent({ requestId: 'intent-2', requestKey: secondRequestKey, amountUnits: '200' })

    const snapshot = buildFinalLiabilitySnapshot({
      intents: [manualIntent, paidIntent],
      paidEvidence: [{ requestId: 'intent-1', settlementKey, itemsHash, total: '100', itemCount: 1 }],
      manualApprovals: [{ requestId: 'intent-2', evidenceDigest: manualEvidence }],
    })

    expect(snapshot.spent).toBe('100')
    expect(snapshot.expectedRequestKeys).toEqual([requestKey, secondRequestKey])
    expect(snapshot.liabilities).toMatchObject([
      {
        requestKey,
        amount: '100',
        terminalState: TERMINAL_STATE_PAID,
        settlementKey,
        terminalEvidenceHash: settlementResultDigest(settlementKey, itemsHash, '100', 1),
      },
      {
        requestKey: secondRequestKey,
        amount: 0,
        terminalState: TERMINAL_STATE_UNPAYABLE_MANUAL,
        settlementKey: `0x${'00'.repeat(32)}`,
        terminalEvidenceHash: manualEvidence,
      },
    ])
    expect(snapshot.finalLiabilityHash).toMatch(/^0x[a-f0-9]{64}$/)
  })

  it('builds the CloseAuthorization payload from the canonical liability hash without signing or broadcasting', async () => {
    const payload = buildCloseAuthorizationPayload({
      research: { escrowAddress, researchKey, chainId: 5_042_002 },
      closeReason: 1,
      finalLiabilityHash: EMPTY_FINAL_LIABILITY_HASH,
      spent: 0,
      nonce: 10,
      issuedAt: 1_999_998_700,
      deadline: 1_999_999_000,
    })

    expect(payload).toEqual({
      escrow: escrowAddress,
      researchKey,
      closeReason: 1,
      finalLiabilityHash: EMPTY_FINAL_LIABILITY_HASH,
      spent: '0',
      nonce: '10',
      issuedAt: '1999998700',
      deadline: '1999999000',
      chainId: 5_042_002,
    })
  })
})

async function activeEscrowResearch() {
  const researchRepo = new MemoryResearchRepo()
  const txLogRepo = new MemoryTxLogRepo()
  const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
  const research = await researchRepo.createFunding({
    id: 'research-1',
    address: '0xB000000000000000000000000000000000000001',
    buyer: '0xB000000000000000000000000000000000000001',
    topic: 'Market structure',
    budgetUsdc: '1',
    budgetUnits: '1000000',
    researchKey,
    expectedEscrowAddress: escrowAddress,
    escrowAddress,
    fundingExpiresAt: new Date('2026-07-11T05:15:00.000Z'),
    expectedExpiresAt: new Date('2026-07-12T05:00:00.000Z'),
    intentSigner: '0x5000000000000000000000000000000000000001',
    quotaDate: '2026-07-11',
    chainId: 5_042_002,
  })
  await researchRepo.transitionLifecycle(
    research.id,
    { status: 'funding', activationPhase: 'none', finalizationState: 'none', quotaReservationState: 'reserved' },
    { activationPhase: 'funded' },
  )
  await researchRepo.transitionLifecycle(
    research.id,
    { status: 'funding', activationPhase: 'funded', finalizationState: 'none', quotaReservationState: 'reserved' },
    { activationPhase: 'activating', quotaReservationState: 'activating' },
  )
  await researchRepo.transitionLifecycle(
    research.id,
    { status: 'funding', activationPhase: 'activating', finalizationState: 'none', quotaReservationState: 'activating' },
    { status: 'running', activationPhase: 'active', finalizationState: 'open', quotaReservationState: 'consumed' },
  )
  return {
    research: await researchRepo.findById(research.id) ?? research,
    researchRepo,
    txLogRepo,
    workflowOutboxRepo,
  }
}

async function recordEscrowIntent(
  txLogRepo: MemoryTxLogRepo,
  researchId: string,
  address: string,
  input: { requestId: string; requestKey: string; toolOrdinal: number },
) {
  await txLogRepo.record({
    address,
    source: 'sentiment',
    amount: '0.0001',
    researchId,
    requestId: input.requestId,
    txStatus: 'pending',
    txHash: null,
    backend: 'escrow',
    version: 1,
    paymentIntentId: input.requestId,
    toolOrdinal: input.toolOrdinal,
    requestKey: input.requestKey,
    sourceId,
    amountUnits: '100',
    registryRevision: '7',
    expectedPayout: '0xF000000000000000000000000000000000000001',
    maxUnitPrice: '100',
    registryReadBlock: '99',
    payloadHash: `0x${'07'.repeat(32)}`,
    escrowAddress,
    researchKey,
  })
}

function txIntent(input: { requestId: string; requestKey: string; amountUnits: string }) {
  return {
    id: input.requestId,
    address: '0xB000000000000000000000000000000000000001',
    source: 'sentiment',
    amount: '0.0001',
    researchId: 'research-1',
    txHash: null,
    txStatus: 'pending' as const,
    chainId: null,
    blockNumber: null,
    settlementId: null,
    requestId: input.requestId,
    backend: 'escrow' as const,
    version: 1,
    paymentIntentId: input.requestId,
    toolOrdinal: 1,
    requestKey: input.requestKey,
    sourceId,
    amountUnits: input.amountUnits,
    registryRevision: '7',
    expectedPayout: '0xF000000000000000000000000000000000000001',
    maxUnitPrice: '100',
    registryReadBlock: '99',
    payloadHash: `0x${'07'.repeat(32)}`,
    escrowAddress,
    researchKey,
    errorMessage: null,
    createdAt: new Date('2026-07-11T05:00:00.000Z'),
  }
}
