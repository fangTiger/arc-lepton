import type { TxLogEntry } from '@/lib/db/tx-log-repo'
import type { WorkflowOperation } from '@/lib/db/workflow-outbox-repo'

export function escrowSettlementOperationKey(entry: Pick<TxLogEntry, 'backend' | 'researchId'>) {
  if (entry.backend !== 'escrow' || !entry.researchId) return null
  return `SETTLE:${entry.researchId}`
}

export function reconciledPaymentFacts(entry: Pick<TxLogEntry, 'backend' | 'txStatus' | 'txHash' | 'chainId' | 'blockNumber'>) {
  if (entry.backend === 'escrow' && entry.txStatus !== 'confirmed') {
    return {
      txHash: null,
      chainId: null,
      blockNumber: null,
    }
  }
  return {
    txHash: entry.txHash,
    chainId: entry.chainId,
    blockNumber: entry.blockNumber,
  }
}

export function serializeTxLogEntry(entry: TxLogEntry, operation: WorkflowOperation | null = null) {
  const isEscrow = entry.backend === 'escrow'
  const paymentFacts = reconciledPaymentFacts(entry)
  const operationPhase = isEscrow ? operation?.phase ?? null : null
  const operationTxHash = isEscrow ? operation?.txHash ?? null : null
  const operationBlockNumber = isEscrow ? operation?.blockNumber ?? null : null

  return {
    ...entry,
    ...paymentFacts,
    createdAt: entry.createdAt.toISOString(),
    operationPhase,
    operationTxHash,
    operationBlockNumber,
    escrow: isEscrow
      ? {
          operationKey: operation?.operationKey ?? escrowSettlementOperationKey(entry),
          operationPhase,
          operationTxHash,
          operationBlockNumber,
          operationLastError: operation?.lastError ?? null,
          confirmed: entry.txStatus === 'confirmed',
          settlementId: entry.settlementId,
          researchKey: entry.researchKey,
          escrowAddress: entry.escrowAddress,
          requestKey: entry.requestKey,
          sourceId: entry.sourceId,
          amountUnits: entry.amountUnits,
          registryRevision: entry.registryRevision,
          expectedPayout: entry.expectedPayout,
          maxUnitPrice: entry.maxUnitPrice,
          registryReadBlock: entry.registryReadBlock,
          payloadHash: entry.payloadHash,
        }
      : null,
  }
}
