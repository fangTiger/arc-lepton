import { describe, expect, it } from 'vitest'

import {
  CanonicalEncodingError,
  deriveCanonicalHashes,
  finalLiabilityHashForRequests,
  finalLiabilityHashWithSpent,
  itemsHash,
  researchKey,
  sourceId,
} from './canonical'
import vectors from '../../contracts/test/vectors/canonical-vectors.json'

describe('canonical research escrow vectors', () => {
  it('固定共享 fixture 中的 design v1 向量', () => {
    expect(vectors.inputs.chainId).toBe(5_042_002)
    expect(vectors.inputs.buyer).toBe('0x1111111111111111111111111111111111111111')
    expect(vectors.expected.researchKey).toBe(
      '0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464',
    )
    expect(vectors.expected.requestKey).toBe(
      '0xbb469196cc6b5028360740da10f0e57e763db8971c37fe1a04515283233e32ab',
    )
    expect(vectors.expected.settlementKey).toBe(
      '0xd75c2aaf27e02addef0bc1da37cbcbfbed79ae0e15ae5297e10194404da01ca7',
    )
    expect(vectors.expected.sourceId).toBe(
      '0xd767053e418a41081f134228cb808336dcb83d2c711e2889289c35f24d75e4d1',
    )
    expect(vectors.expected.itemsHash).toBe(
      '0x97180eb3603765a7d6b345f882b2e54df6caa90acf6f2a372b7b2197fbd707ea',
    )
    expect(vectors.expected.settlementResultDigest).toBe(
      '0xb1518f344eeee729e760f0c0d2be569b83fa550833b2309d8e6b7e2cb037b6c4',
    )
    expect(vectors.expected.emptyFinalLiabilityHash).toBe(
      '0xa700e53730858c2f4b9b5e2287eb6277837358afa904bd8288dccd07809876e4',
    )
    expect(vectors.expected.singlePaidFinalLiabilityHash).toBe(
      '0x338ee25354eba1e0ea3d435dce293825bc9f8143a25d97c1ecfeb5eb29ad3f2e',
    )
  })

  it('TypeScript canonical encoder 必须匹配共享向量', async () => {
    const hashes = deriveCanonicalHashes({
      chainId: BigInt(vectors.inputs.chainId),
      buyer: vectors.inputs.buyer,
      canonicalResearchId: vectors.inputs.canonicalResearchId,
      canonicalPaymentIntentId: vectors.inputs.canonicalPaymentIntentId,
      canonicalSettlementId: vectors.inputs.canonicalSettlementId,
      source: vectors.inputs.source,
      items: [
        {
          requestKey: vectors.expected.requestKey,
          sourceId: vectors.expected.sourceId,
          registryRevision: BigInt(vectors.inputs.item.registryRevision),
          expectedPayout: vectors.inputs.item.payout,
          maxUnitPrice: BigInt(vectors.inputs.item.maxUnitPrice),
          amount: BigInt(vectors.inputs.item.amount),
        },
      ],
      liabilities: vectors.inputs.liabilities.singlePaid.map((item) => ({
        requestKey: item.requestKey,
        amount: BigInt(item.amount),
        terminalState: item.terminalState,
        settlementKey: item.settlementKey,
        terminalEvidenceHash: item.terminalEvidenceHash,
      })),
    })

    expect(hashes.researchKey).toBe(vectors.expected.researchKey)
    expect(hashes.requestKey).toBe(vectors.expected.requestKey)
    expect(hashes.settlementKey).toBe(vectors.expected.settlementKey)
    expect(hashes.sourceId).toBe(vectors.expected.sourceId)
    expect(hashes.itemsHash).toBe(vectors.expected.itemsHash)
    expect(hashes.settlementResultDigest).toBe(vectors.expected.settlementResultDigest)
    expect(hashes.emptyFinalLiabilityHash).toBe(vectors.expected.emptyFinalLiabilityHash)
    expect(hashes.singlePaidFinalLiabilityHash).toBe(vectors.expected.singlePaidFinalLiabilityHash)
  })

  it('拒绝非 canonical UUID 和 source', () => {
    expectCanonicalError(() =>
      researchKey(vectors.inputs.chainId, vectors.inputs.buyer, '00000000-0000-4000-8000-00000000000A'),
    )
    expectCanonicalError(() =>
      researchKey(vectors.inputs.chainId, vectors.inputs.buyer, '00000000000040008000000000000001'),
    )
    expectCanonicalError(() => sourceId('Whale-Flow'))
    expectCanonicalError(() => sourceId(''))
  })

  it('拒绝零 key、未排序和重复 settlement items', () => {
    const first = settlementItem(vectors.expected.requestKey)
    const second = settlementItem(
      '0xcb469196cc6b5028360740da10f0e57e763db8971c37fe1a04515283233e32ab',
    )

    expectCanonicalError(() => itemsHash([]))
    expectCanonicalError(() => itemsHash([{ ...first, requestKey: zeroKey }]))
    expectCanonicalError(() => itemsHash([{ ...first, sourceId: zeroKey }]))
    expectCanonicalError(() => itemsHash([second, first]))
    expectCanonicalError(() => itemsHash([first, first]))
  })

  it('拒绝无效 liability、spent 不匹配和遗漏 requestKey', () => {
    const singlePaid = vectors.inputs.liabilities.singlePaid.map((item) => ({
      requestKey: item.requestKey,
      amount: BigInt(item.amount),
      terminalState: item.terminalState,
      settlementKey: item.settlementKey,
      terminalEvidenceHash: item.terminalEvidenceHash,
    }))

    expect(finalLiabilityHashWithSpent(singlePaid, 100n)).toBe(
      vectors.expected.singlePaidFinalLiabilityHash,
    )
    expectCanonicalError(() => finalLiabilityHashWithSpent(singlePaid, 101n))
    expectCanonicalError(() => finalLiabilityHashWithSpent([{ ...singlePaid[0], terminalState: 99 }], 100n))
    expectCanonicalError(() => finalLiabilityHashWithSpent([{ ...singlePaid[0], settlementKey: zeroKey }], 100n))
    expectCanonicalError(() => finalLiabilityHashWithSpent([{ ...singlePaid[0], terminalState: 2 }], 0n))
    expectCanonicalError(() =>
      finalLiabilityHashForRequests(
        singlePaid,
        ['0xcb469196cc6b5028360740da10f0e57e763db8971c37fe1a04515283233e32ab'],
        100n,
      ),
    )
  })
})

const zeroKey = '0x0000000000000000000000000000000000000000000000000000000000000000'

function settlementItem(requestKey: string) {
  return {
    requestKey,
    sourceId: vectors.expected.sourceId,
    registryRevision: BigInt(vectors.inputs.item.registryRevision),
    expectedPayout: vectors.inputs.item.payout,
    maxUnitPrice: BigInt(vectors.inputs.item.maxUnitPrice),
    amount: BigInt(vectors.inputs.item.amount),
  }
}

function expectCanonicalError(action: () => unknown) {
  expect(action).toThrow(CanonicalEncodingError)
}
