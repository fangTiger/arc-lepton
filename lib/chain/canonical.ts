import { encodeAbiParameters, isAddress, keccak256, toBytes } from 'viem'

export class CanonicalEncodingError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'CanonicalEncodingError'
  }
}

export type Hex32 = `0x${string}`

export interface CanonicalSettlementItem {
  requestKey: string
  sourceId: string
  registryRevision: bigint | number | string
  expectedPayout: string
  maxUnitPrice: bigint | number | string
  amount: bigint | number | string
}

export interface CanonicalLiabilityItem {
  requestKey: string
  amount: bigint | number | string
  terminalState: bigint | number | string
  settlementKey: string
  terminalEvidenceHash: string
}

export interface DeriveCanonicalHashesInput {
  chainId: bigint | number | string
  buyer: string
  canonicalResearchId: string
  canonicalPaymentIntentId: string
  canonicalSettlementId: string
  source: string
  items: CanonicalSettlementItem[]
  liabilities: CanonicalLiabilityItem[]
}

export const TERMINAL_STATE_PAID = 1
export const TERMINAL_STATE_VOID_BEFORE_SIDE_EFFECT = 2
export const TERMINAL_STATE_UNPAYABLE_MANUAL = 3

export const RESEARCH_DOMAIN = textHash('arc-lepton.research-key.v1')
export const REQUEST_DOMAIN = textHash('arc-lepton.request-key.v1')
export const SETTLEMENT_DOMAIN = textHash('arc-lepton.settlement-key.v1')
export const SOURCE_DOMAIN = textHash('arc-lepton.source-id.v1')
export const ITEMS_DOMAIN = textHash('arc-lepton.items-hash.v1')
export const SETTLEMENT_RESULT_DOMAIN = textHash('arc-lepton.settlement-result.v1')
export const FINAL_LIABILITY_DOMAIN = textHash('arc-lepton.final-liability.v1')

const ZERO_KEY = '0x0000000000000000000000000000000000000000000000000000000000000000'
const UINT64_MAX = (1n << 64n) - 1n
const UINT256_MAX = (1n << 256n) - 1n

const settlementItemAbi = [
  { name: 'requestKey', type: 'bytes32' },
  { name: 'sourceId', type: 'bytes32' },
  { name: 'registryRevision', type: 'uint64' },
  { name: 'expectedPayout', type: 'address' },
  { name: 'maxUnitPrice', type: 'uint256' },
  { name: 'amount', type: 'uint256' },
] as const

const liabilityItemAbi = [
  { name: 'requestKey', type: 'bytes32' },
  { name: 'amount', type: 'uint256' },
  { name: 'terminalState', type: 'uint8' },
  { name: 'settlementKey', type: 'bytes32' },
  { name: 'terminalEvidenceHash', type: 'bytes32' },
] as const

export function researchKey(
  chainId: bigint | number | string,
  buyer: string,
  canonicalResearchId: string,
): Hex32 {
  requireCanonicalUuid(canonicalResearchId, 'canonicalResearchId')
  requireAddress(buyer, 'buyer')

  return hashAbi(
    [
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'bytes32' },
    ],
    [RESEARCH_DOMAIN, toUint(chainId, 'chainId', UINT256_MAX), buyer, textHash(canonicalResearchId)],
  )
}

export function requestKey(researchKeyValue: string, canonicalPaymentIntentId: string): Hex32 {
  const checkedResearchKey = requireNonZeroHex32(researchKeyValue, 'researchKey')
  requireCanonicalUuid(canonicalPaymentIntentId, 'canonicalPaymentIntentId')

  return hashAbi(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [REQUEST_DOMAIN, checkedResearchKey, textHash(canonicalPaymentIntentId)],
  )
}

export function settlementKey(researchKeyValue: string, canonicalSettlementId: string): Hex32 {
  const checkedResearchKey = requireNonZeroHex32(researchKeyValue, 'researchKey')
  requireCanonicalUuid(canonicalSettlementId, 'canonicalSettlementId')

  return hashAbi(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
    [SETTLEMENT_DOMAIN, checkedResearchKey, textHash(canonicalSettlementId)],
  )
}

export function sourceId(canonicalSourceName: string): Hex32 {
  requireCanonicalSource(canonicalSourceName, 'source')

  return hashAbi([{ type: 'bytes32' }, { type: 'bytes32' }], [
    SOURCE_DOMAIN,
    textHash(canonicalSourceName),
  ])
}

export function itemsHash(items: readonly CanonicalSettlementItem[]): Hex32 {
  const normalizedItems = normalizeItems(items)

  return hashAbi(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'tuple[]', components: settlementItemAbi }],
    [ITEMS_DOMAIN, 1n, normalizedItems],
  )
}

export function settlementResultDigest(
  settlementKeyValue: string,
  itemsHashValue: string,
  total: bigint | number | string,
  itemCount: bigint | number | string,
): Hex32 {
  return hashAbi(
    [
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'uint32' },
    ],
    [
      SETTLEMENT_RESULT_DOMAIN,
      requireNonZeroHex32(settlementKeyValue, 'settlementKey'),
      requireNonZeroHex32(itemsHashValue, 'itemsHash'),
      toUint(total, 'total', UINT256_MAX),
      toUint(itemCount, 'itemCount', (1n << 32n) - 1n),
    ],
  )
}

export function finalLiabilityHash(liabilities: readonly CanonicalLiabilityItem[]): Hex32 {
  const normalizedLiabilities = normalizeLiabilities(liabilities)

  return hashAbi(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'tuple[]', components: liabilityItemAbi }],
    [FINAL_LIABILITY_DOMAIN, 1n, normalizedLiabilities],
  )
}

export function finalLiabilityHashWithSpent(
  liabilities: readonly CanonicalLiabilityItem[],
  spent: bigint | number | string,
): Hex32 {
  const normalizedLiabilities = normalizeLiabilities(liabilities)
  const paidTotal = paidTotalOf(normalizedLiabilities)
  const expectedSpent = toUint(spent, 'spent', UINT256_MAX)
  if (paidTotal !== expectedSpent) {
    throw new CanonicalEncodingError('SPENT_MISMATCH', 'spent', 'PAID amount 之和必须等于 spent')
  }

  return hashAbi(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'tuple[]', components: liabilityItemAbi }],
    [FINAL_LIABILITY_DOMAIN, 1n, normalizedLiabilities],
  )
}

export function finalLiabilityHashForRequests(
  liabilities: readonly CanonicalLiabilityItem[],
  expectedRequestKeys: readonly string[],
  spent: bigint | number | string,
): Hex32 {
  const normalizedLiabilities = normalizeLiabilities(liabilities)
  const normalizedExpected = normalizeExpectedRequestKeys(expectedRequestKeys)
  if (normalizedLiabilities.length !== normalizedExpected.length) {
    throw new CanonicalEncodingError('MISSING_LIABILITY', 'liabilities', 'liability 集合必须覆盖全部 expected requestKey')
  }

  for (let index = 0; index < normalizedLiabilities.length; index += 1) {
    if (normalizedLiabilities[index].requestKey !== normalizedExpected[index]) {
      throw new CanonicalEncodingError('MISSING_LIABILITY', `liabilities[${index}].requestKey`, 'liability requestKey 与 expected 集合不一致')
    }
  }

  return finalLiabilityHashWithSpent(liabilities, spent)
}

export function deriveCanonicalHashes(input: DeriveCanonicalHashesInput) {
  const derivedResearchKey = researchKey(input.chainId, input.buyer, input.canonicalResearchId)
  const derivedRequestKey = requestKey(derivedResearchKey, input.canonicalPaymentIntentId)
  const derivedSettlementKey = settlementKey(derivedResearchKey, input.canonicalSettlementId)
  const derivedSourceId = sourceId(input.source)
  const derivedItemsHash = itemsHash(input.items)
  const normalizedItems = normalizeItems(input.items)
  const total = normalizedItems.reduce((sum, item) => sum + item.amount, 0n)
  const derivedSettlementResultDigest = settlementResultDigest(
    derivedSettlementKey,
    derivedItemsHash,
    total,
    BigInt(normalizedItems.length),
  )

  return {
    researchKey: derivedResearchKey,
    requestKey: derivedRequestKey,
    settlementKey: derivedSettlementKey,
    sourceId: derivedSourceId,
    itemsHash: derivedItemsHash,
    settlementResultDigest: derivedSettlementResultDigest,
    emptyFinalLiabilityHash: finalLiabilityHash([]),
    singlePaidFinalLiabilityHash: finalLiabilityHash(input.liabilities),
  }
}

function normalizeItems(items: readonly CanonicalSettlementItem[]) {
  if (items.length === 0) {
    throw new CanonicalEncodingError('EMPTY_ITEMS', 'items', 'settlement items 不得为空')
  }

  let previousRequestKey: string | undefined
  return items.map((item, index) => {
    const requestKeyValue = requireNonZeroHex32(item.requestKey, `items[${index}].requestKey`)
    const sourceIdValue = requireNonZeroHex32(item.sourceId, `items[${index}].sourceId`)
    if (previousRequestKey && compareHex32(requestKeyValue, previousRequestKey) <= 0) {
      throw new CanonicalEncodingError('UNSORTED_KEYS', `items[${index}].requestKey`, 'items 必须按 requestKey 无符号升序排列且不得重复')
    }
    previousRequestKey = requestKeyValue

    requireAddress(item.expectedPayout, `items[${index}].expectedPayout`)

    return {
      requestKey: requestKeyValue,
      sourceId: sourceIdValue,
      registryRevision: toUint(item.registryRevision, `items[${index}].registryRevision`, UINT64_MAX),
      expectedPayout: item.expectedPayout,
      maxUnitPrice: toUint(item.maxUnitPrice, `items[${index}].maxUnitPrice`, UINT256_MAX),
      amount: toUint(item.amount, `items[${index}].amount`, UINT256_MAX),
    }
  })
}

function normalizeLiabilities(liabilities: readonly CanonicalLiabilityItem[]) {
  let previousRequestKey: string | undefined
  return liabilities.map((liability, index) => {
    const requestKeyValue = requireNonZeroHex32(liability.requestKey, `liabilities[${index}].requestKey`)
    if (previousRequestKey && compareHex32(requestKeyValue, previousRequestKey) <= 0) {
      throw new CanonicalEncodingError('UNSORTED_KEYS', `liabilities[${index}].requestKey`, 'liabilities 必须按 requestKey 无符号升序排列且不得重复')
    }
    previousRequestKey = requestKeyValue

    const terminalState = Number(toUint(liability.terminalState, `liabilities[${index}].terminalState`, 255n))
    const settlementKeyValue = requireHex32(liability.settlementKey, `liabilities[${index}].settlementKey`)
    const evidenceHash = requireNonZeroHex32(
      liability.terminalEvidenceHash,
      `liabilities[${index}].terminalEvidenceHash`,
    )

    if (terminalState === TERMINAL_STATE_PAID) {
      if (settlementKeyValue === ZERO_KEY) {
        throw new CanonicalEncodingError('INVALID_LIABILITY_EVIDENCE', `liabilities[${index}].settlementKey`, 'PAID liability 必须绑定非零 settlementKey')
      }
    } else if (
      terminalState === TERMINAL_STATE_VOID_BEFORE_SIDE_EFFECT ||
      terminalState === TERMINAL_STATE_UNPAYABLE_MANUAL
    ) {
      if (settlementKeyValue !== ZERO_KEY) {
        throw new CanonicalEncodingError('INVALID_LIABILITY_EVIDENCE', `liabilities[${index}].settlementKey`, '非 PAID liability 不得绑定 settlementKey')
      }
    } else {
      throw new CanonicalEncodingError('INVALID_TERMINAL_STATE', `liabilities[${index}].terminalState`, '未知 liability terminalState')
    }

    return {
      requestKey: requestKeyValue,
      amount: toUint(liability.amount, `liabilities[${index}].amount`, UINT256_MAX),
      terminalState,
      settlementKey: settlementKeyValue,
      terminalEvidenceHash: evidenceHash,
    }
  })
}

function normalizeExpectedRequestKeys(expectedRequestKeys: readonly string[]) {
  let previousRequestKey: string | undefined
  return expectedRequestKeys.map((requestKeyValue, index) => {
    const normalized = requireNonZeroHex32(requestKeyValue, `expectedRequestKeys[${index}]`)
    if (previousRequestKey && compareHex32(normalized, previousRequestKey) <= 0) {
      throw new CanonicalEncodingError('UNSORTED_KEYS', `expectedRequestKeys[${index}]`, 'expected requestKey 必须按无符号升序排列且不得重复')
    }
    previousRequestKey = normalized
    return normalized
  })
}

function paidTotalOf(liabilities: ReturnType<typeof normalizeLiabilities>) {
  return liabilities.reduce(
    (sum, liability) => (liability.terminalState === TERMINAL_STATE_PAID ? sum + liability.amount : sum),
    0n,
  )
}

function hashAbi(parameters: Parameters<typeof encodeAbiParameters>[0], values: Parameters<typeof encodeAbiParameters>[1]) {
  return keccak256(encodeAbiParameters(parameters, values)) as Hex32
}

function textHash(value: string) {
  return keccak256(toBytes(value)) as Hex32
}

function requireCanonicalUuid(value: string, path: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) {
    throw new CanonicalEncodingError('NON_CANONICAL_ID', path, 'ID 必须是 lowercase hyphenated canonical UUID')
  }
}

function requireCanonicalSource(value: string, path: string) {
  if (!/^[a-z0-9-]+$/.test(value)) {
    throw new CanonicalEncodingError('NON_CANONICAL_SOURCE', path, 'source 必须匹配 [a-z0-9-]+')
  }
}

function requireAddress(value: string, path: string) {
  if (!isAddress(value)) {
    throw new CanonicalEncodingError('INVALID_ADDRESS', path, '地址格式无效')
  }
}

function requireNonZeroHex32(value: string, path: string) {
  const checked = requireHex32(value, path)
  if (checked === ZERO_KEY) {
    throw new CanonicalEncodingError('ZERO_KEY', path, 'key 不得为零')
  }
  return checked
}

function requireHex32(value: string, path: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new CanonicalEncodingError('INVALID_HEX32', path, '值必须是 bytes32 hex')
  }
  return value.toLowerCase() as Hex32
}

function compareHex32(left: string, right: string) {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1
}

function toUint(value: bigint | number | string, path: string, max: bigint) {
  let parsed: bigint
  if (typeof value === 'bigint') {
    parsed = value
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalEncodingError('INVALID_UINT', path, 'number 输入必须是安全整数')
    }
    parsed = BigInt(value)
  } else if (/^[0-9]+$/.test(value)) {
    parsed = BigInt(value)
  } else {
    throw new CanonicalEncodingError('INVALID_UINT', path, '整数必须是非负十进制')
  }

  if (parsed < 0n || parsed > max) {
    throw new CanonicalEncodingError('INVALID_UINT', path, '整数超出 ABI 类型范围')
  }
  return parsed
}
