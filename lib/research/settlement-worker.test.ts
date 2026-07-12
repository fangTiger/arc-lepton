import { describe, expect, it, vi } from 'vitest'
import { itemsHash, settlementKey } from '@/lib/chain/canonical'
import { MemoryTxLogRepo } from '@/lib/db/tx-log-repo-memory'
import { MemoryWorkflowOutboxRepo } from '@/lib/db/workflow-outbox-repo-memory'
import type { Research } from '@/lib/db/research-repo'
import type { WorkflowOperation, WorkflowOperationType } from '@/lib/db/workflow-outbox-repo'
import {
  canonicalSettlementIdFromOperationKey,
  processSettlementOperation,
  type SettlementRecoveryProbe,
} from './settlement-worker'

const researchKey = `0x${'ab'.repeat(32)}`
const escrowAddress = '0xE000000000000000000000000000000000000001'
const txHash = `0x${'12'.repeat(32)}`

describe('processSettlementOperation', () => {
  it('broadcasts from a pre-broadcast SETTLE only after chain recovery proves the batch is unprocessed', async () => {
    const fixture = await settlementFixture()
    const submitSettlement = vi.fn(async () => ({
      status: 'confirmed' as const,
      settlementId: fixture.settlementId,
      settlementKey: fixture.settlementKey,
      itemsHash: `0x${'cd'.repeat(32)}`,
      total: '100',
      itemCount: 1,
      txHash,
      blockNumber: '123456',
    }))
    const recoverSettlement: SettlementRecoveryProbe = vi.fn(async () => ({ status: 'not_processed' as const }))

    const result = await processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement,
      recoverSettlement,
      deploymentBlock: 100n,
    })

    expect(result).toEqual({ status: 'submitted' })
    expect(recoverSettlement).toHaveBeenCalledWith(expect.objectContaining({
      operationKey: 'SETTLE:research-1',
      settlementId: fixture.settlementId,
      settlementKey: fixture.settlementKey,
      txHash: null,
      deploymentBlock: 100n,
    }))
    expect(submitSettlement).toHaveBeenCalledTimes(1)
    await expect(fixture.workflowOutboxRepo.findByOperationKey('SETTLE:research-1')).resolves.toMatchObject({
      phase: 'succeeded',
      txHash,
      blockNumber: '123456',
    })
    await expect(fixture.workflowOutboxRepo.findByOperationKey('CLOSE:research-1')).resolves.toMatchObject({
      type: 'CLOSE',
      phase: 'queued',
      researchId: 'research-1',
    })
  })

  it('recovers when broadcast succeeded but the worker crashed before saving txHash', async () => {
    const fixture = await settlementFixture()
    const submitSettlement = vi.fn()
    const recoverSettlement: SettlementRecoveryProbe = vi.fn(async () => processedEvidence(fixture))

    const result = await processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement,
      recoverSettlement,
    })

    expect(result).toEqual({ status: 'recovered' })
    expect(submitSettlement).not.toHaveBeenCalled()
    await expect(fixture.txLogRepo.findByRequestId(fixture.research.address, 'request-1')).resolves.toMatchObject({
      txStatus: 'confirmed',
      txHash,
      chainId: 5_042_002,
      blockNumber: '123456',
      settlementId: fixture.settlementId,
    })
  })

  it('recovers a saved txHash whose receipt had not been confirmed locally', async () => {
    const fixture = await settlementFixture()
    await fixture.workflowOutboxRepo.recordBroadcast(fixture.operation.id, fixture.operation.fencingToken, {
      phase: 'broadcasting',
      txHash,
      chainId: 5_042_002,
      blockNumber: null,
    })
    const operation = await fixture.workflowOutboxRepo.findByOperationKey('SETTLE:research-1') as WorkflowOperation
    const submitSettlement = vi.fn()
    const recoverSettlement: SettlementRecoveryProbe = vi.fn(async () => processedEvidence(fixture))

    const result = await processSettlementOperation(operation, {
      ...fixture.deps,
      submitSettlement,
      recoverSettlement,
    })

    expect(result).toEqual({ status: 'recovered' })
    expect(recoverSettlement).toHaveBeenCalledWith(expect.objectContaining({ txHash }))
    expect(submitSettlement).not.toHaveBeenCalled()
    await expect(fixture.workflowOutboxRepo.findByOperationKey('SETTLE:research-1')).resolves.toMatchObject({
      phase: 'succeeded',
      txHash,
      blockNumber: '123456',
    })
  })

  it('repairs pending tx_log rows when receipt succeeded but DB confirmation crashed', async () => {
    const fixture = await settlementFixture()
    await fixture.workflowOutboxRepo.recordBroadcast(fixture.operation.id, fixture.operation.fencingToken, {
      phase: 'broadcasting',
      txHash,
      chainId: 5_042_002,
      blockNumber: '123456',
    })
    const operation = await fixture.workflowOutboxRepo.findByOperationKey('SETTLE:research-1') as WorkflowOperation

    const result = await processSettlementOperation(operation, {
      ...fixture.deps,
      submitSettlement: vi.fn(),
      recoverSettlement: async () => processedEvidence(fixture),
    })

    expect(result).toEqual({ status: 'recovered' })
    await expect(fixture.txLogRepo.findByRequestId(fixture.research.address, 'request-1')).resolves.toMatchObject({
      txStatus: 'confirmed',
      txHash,
      settlementId: fixture.settlementId,
    })
  })

  it('finishes RECONCILE by enqueueing CLOSE when settlement evidence exists but crash happened before close', async () => {
    const fixture = await settlementFixture({ type: 'RECONCILE', operationKey: 'RECONCILE:research-1' })

    const result = await processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement: vi.fn(),
      recoverSettlement: async () => processedEvidence(fixture),
    })

    expect(result).toEqual({ status: 'recovered' })
    await expect(fixture.workflowOutboxRepo.findByOperationKey('RECONCILE:research-1')).resolves.toMatchObject({
      phase: 'succeeded',
    })
    await expect(fixture.workflowOutboxRepo.findByOperationKey('CLOSE:research-1')).resolves.toMatchObject({
      type: 'CLOSE',
      phase: 'queued',
    })
  })

  it('does not replay or mark confirmed when RPC recovery is unknown', async () => {
    const fixture = await settlementFixture()
    const submitSettlement = vi.fn()

    await expect(processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement,
      recoverSettlement: async () => ({ status: 'unknown' }),
    })).rejects.toThrow('SETTLEMENT_RECOVERY_UNKNOWN')

    expect(submitSettlement).not.toHaveBeenCalled()
    await expect(fixture.txLogRepo.findByRequestId(fixture.research.address, 'request-1')).resolves.toMatchObject({
      txStatus: 'pending',
      settlementId: null,
    })
  })

  it('does not repair non-escrow pending rows while recovering processed evidence', async () => {
    const fixture = await settlementFixture()
    await fixture.txLogRepo.record({
      address: fixture.research.address,
      source: 'legacy',
      amount: '0.0001',
      researchId: fixture.research.id,
      requestId: 'legacy-request',
      txStatus: 'pending',
      backend: 'arc',
    })

    await processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement: vi.fn(),
      recoverSettlement: async () => processedEvidence(fixture),
    })

    await expect(fixture.txLogRepo.findByRequestId(fixture.research.address, 'legacy-request')).resolves.toMatchObject({
      txStatus: 'pending',
      settlementId: null,
    })
  })

  it('refuses to repair when local escrow pending intents no longer match processed chain summary', async () => {
    const fixture = await settlementFixture()
    await fixture.txLogRepo.record({
      address: fixture.research.address,
      source: 'market',
      amount: '0.0002',
      researchId: fixture.research.id,
      requestId: `0x${'09'.repeat(32)}`,
      txStatus: 'pending',
      backend: 'escrow',
      version: 1,
      paymentIntentId: 'intent-2',
      toolOrdinal: 2,
      requestKey: `0x${'09'.repeat(32)}`,
      sourceId: `0x${'0a'.repeat(32)}`,
      amountUnits: '200',
      registryRevision: '7',
      expectedPayout: '0xF000000000000000000000000000000000000001',
      maxUnitPrice: '100',
      registryReadBlock: '100',
      payloadHash: `0x${'0b'.repeat(32)}`,
      escrowAddress: fixture.research.escrowAddress,
      researchKey: fixture.research.researchKey,
    })

    await expect(processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement: vi.fn(),
      recoverSettlement: async () => processedEvidence(fixture),
    })).rejects.toThrow('SETTLEMENT_RECOVERY_ITEMS_MISMATCH')

    await expect(fixture.txLogRepo.findByRequestId(fixture.research.address, 'request-1')).resolves.toMatchObject({
      txStatus: 'pending',
      settlementId: null,
    })
  })

  it('fails closed when Registry snapshot drift changes the processed items summary', async () => {
    const fixture = await settlementFixture()
    const submitSettlement = vi.fn()
    const driftedItemsHash = itemsHash([{
      ...settlementItem(),
      registryRevision: '8',
      expectedPayout: '0xf000000000000000000000000000000000000002',
    }])

    await expect(processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement,
      recoverSettlement: async () => ({
        ...processedEvidence(fixture),
        itemsHash: driftedItemsHash,
      }),
    })).rejects.toThrow('SETTLEMENT_RECOVERY_ITEMS_MISMATCH')

    expect(submitSettlement).not.toHaveBeenCalled()
    await expect(fixture.txLogRepo.findByRequestId(fixture.research.address, 'request-1')).resolves.toMatchObject({
      txStatus: 'pending',
      settlementId: null,
    })
    await expect(fixture.workflowOutboxRepo.findByOperationKey('SETTLE:research-1')).resolves.not.toMatchObject({
      phase: 'succeeded',
    })
    await expect(fixture.workflowOutboxRepo.findByOperationKey('CLOSE:research-1')).resolves.toBeNull()
  })

  it('raises a severe manual-recovery signal instead of settling after escrow expiry was missed', async () => {
    const fixture = await settlementFixture({
      research: {
        expectedExpiresAt: new Date('2026-07-11T05:00:00.000Z'),
      },
    })
    const submitSettlement = vi.fn()
    const recoverSettlement = vi.fn(async () => processedEvidence(fixture))

    await expect(processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement,
      recoverSettlement,
      now: new Date('2026-07-11T05:00:01.000Z'),
    })).rejects.toThrow('ESCROW_EXPIRED_BEFORE_FINALIZATION')

    expect(recoverSettlement).not.toHaveBeenCalled()
    expect(submitSettlement).not.toHaveBeenCalled()
    await expect(fixture.txLogRepo.findByRequestId(fixture.research.address, 'request-1')).resolves.toMatchObject({
      txStatus: 'pending',
      settlementId: null,
    })
  })

  it('keeps CLOSE queued when SETTLE completion loses the lease after recovery', async () => {
    const fixture = await settlementFixture()
    const complete = vi.spyOn(fixture.workflowOutboxRepo, 'complete').mockResolvedValueOnce(false)

    await expect(processSettlementOperation(fixture.operation, {
      ...fixture.deps,
      submitSettlement: vi.fn(),
      recoverSettlement: async () => processedEvidence(fixture),
    })).rejects.toThrow('SETTLEMENT_COMPLETE_LOST_LEASE:SETTLE:research-1')

    expect(complete).toHaveBeenCalledTimes(1)
    await expect(fixture.workflowOutboxRepo.findByOperationKey('CLOSE:research-1')).resolves.toMatchObject({
      type: 'CLOSE',
      phase: 'queued',
    })
  })
})

async function settlementFixture(input: {
  type?: WorkflowOperationType
  operationKey?: string
  research?: Partial<Research>
} = {}) {
  const type = input.type ?? 'SETTLE'
  const operationKey = input.operationKey ?? 'SETTLE:research-1'
  const research = researchRecord(input.research)
  const txLogRepo = new MemoryTxLogRepo()
  const workflowOutboxRepo = new MemoryWorkflowOutboxRepo()
  const researchRepo = {
    findById: vi.fn(async () => research),
  }

  await txLogRepo.record({
    address: research.address,
    source: 'sentiment',
    amount: '0.0001',
    researchId: research.id,
    requestId: 'request-1',
    txStatus: 'pending',
    txHash: null,
    backend: 'escrow',
    version: 1,
    paymentIntentId: 'intent-1',
    toolOrdinal: 1,
    requestKey: `0x${'01'.repeat(32)}`,
    sourceId: `0x${'02'.repeat(32)}`,
    amountUnits: '100',
    registryRevision: '7',
    expectedPayout: '0xF000000000000000000000000000000000000001',
    maxUnitPrice: '100',
    registryReadBlock: '99',
    payloadHash: `0x${'03'.repeat(32)}`,
    escrowAddress: research.escrowAddress,
    researchKey: research.researchKey,
  })

  const claim = await workflowOutboxRepo.claimOperation({
    operationKey,
    type,
    researchId: research.id,
    escrowAddress: research.escrowAddress,
    phase: 'queued',
    payloadHash: `0x${'04'.repeat(32)}`,
    protectedPayloadDigest: `0x${'05'.repeat(32)}`,
    leaseOwner: 'settlement-worker',
    leaseDurationMs: 30_000,
  })

  if (claim.status !== 'claimed') throw new Error('expected claimed operation')

  return {
    research,
    txLogRepo,
    workflowOutboxRepo,
    operation: claim.operation,
    settlementId: canonicalSettlementIdFromOperationKey(operationKey),
    settlementKey: settlementKey(researchKey, canonicalSettlementIdFromOperationKey(operationKey)),
    itemsHash: itemsHash([settlementItem()]),
    total: '100',
    itemCount: 1,
    deps: {
      researchRepo,
      txLogRepo,
      workflowOutboxRepo,
      officialUsdc: '0x3600000000000000000000000000000000000000',
    },
  }
}

function processedEvidence(fixture: Awaited<ReturnType<typeof settlementFixture>>) {
  return {
    status: 'processed' as const,
    txHash,
    chainId: 5_042_002,
    blockNumber: '123456',
    blockHash: `0x${'34'.repeat(32)}`,
    logIndex: 9,
    settlementKey: fixture.settlementKey,
    itemsHash: fixture.itemsHash,
    total: fixture.total,
    itemCount: fixture.itemCount,
  }
}

function settlementItem() {
  return {
    requestKey: `0x${'01'.repeat(32)}`,
    sourceId: `0x${'02'.repeat(32)}`,
    registryRevision: '7',
    expectedPayout: '0xF000000000000000000000000000000000000001',
    maxUnitPrice: '100',
    amount: '100',
  }
}

function researchRecord(overrides: Partial<Research> = {}): Research {
  return {
    id: 'research-1',
    address: '0xB000000000000000000000000000000000000001',
    prepareRequestId: null,
    buyer: '0xB000000000000000000000000000000000000001',
    topic: 'Market structure',
    budgetUsdc: '1',
    budgetUnits: '1000000',
    spentUsdc: '0',
    status: 'completed',
    activationPhase: 'active',
    finalizationState: 'closing',
    quotaReservationState: 'consumed',
    researchKey,
    expectedEscrowAddress: escrowAddress,
    escrowAddress,
    reportMd: 'done',
    errorMessage: null,
    createdAt: new Date('2026-07-11T05:00:00.000Z'),
    preparedAt: null,
    fundingExpiresAt: null,
    expectedExpiresAt: new Date('2030-01-02T05:00:00.000Z'),
    fundingDeadline: null,
    intentSigner: '0x5000000000000000000000000000000000000001',
    voucherNonce: null,
    quotaDate: '2026-07-11',
    cancelRequestedAt: null,
    chainId: 5_042_002,
    startedAt: new Date('2026-07-11T05:00:00.000Z'),
    completedAt: new Date('2026-07-11T05:10:00.000Z'),
    ...overrides,
  }
}
