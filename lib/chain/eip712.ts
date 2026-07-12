import {
  domainSeparator,
  hashStruct,
  hashTypedData,
  isAddress,
  keccak256,
  stringToBytes,
} from 'viem'

export class Eip712EncodingError extends Error {
  readonly code: string
  readonly path: string

  constructor(code: string, path: string, message: string) {
    super(message)
    this.name = 'Eip712EncodingError'
    this.code = code
    this.path = path
  }
}

export type Hex = `0x${string}`

export interface Eip712VectorInput {
  domains: Record<string, Eip712DomainVector>
  types: Record<string, Eip712TypeVector>
  authorizations: Record<string, Eip712AuthorizationVector>
}

export interface Eip712DomainVector {
  name: string
  version: string
  chainId: bigint | number | string
  verifyingContract: string
  separator?: string
}

export interface Eip712TypeVector {
  domain: string
  typeString: string
  fields: Array<{ name: string; type: string }>
  typeHash?: string
}

export interface Eip712AuthorizationVector {
  message: Record<string, bigint | number | string>
  structHash?: string
  digest?: string
}

export const CHECKED_EIP712_VECTOR_KEYS = [
  'factoryDomainSeparator',
  'escrowDomainSeparator',
  'FundingVoucher.typeHash',
  'FundingVoucher.structHash',
  'FundingVoucher.digest',
  'ActivationAuthorization.typeHash',
  'ActivationAuthorization.structHash',
  'ActivationAuthorization.digest',
  'SettlementAuthorization.typeHash',
  'SettlementAuthorization.structHash',
  'SettlementAuthorization.digest',
  'CloseAuthorization.typeHash',
  'CloseAuthorization.structHash',
  'CloseAuthorization.digest',
] as const

const uintTypes = new Set(['uint8', 'uint32', 'uint64', 'uint256'])

export function deriveEip712VectorHashes(vectors: Eip712VectorInput) {
  const factoryDomain = normalizeDomain(vectors.domains.factory, 'domains.factory')
  const escrowDomain = normalizeDomain(vectors.domains.escrow, 'domains.escrow')

  return {
    factoryDomainSeparator: domainSeparator({ domain: factoryDomain }) as Hex,
    escrowDomainSeparator: domainSeparator({ domain: escrowDomain }) as Hex,
    FundingVoucher: deriveAuthorizationHash(vectors, 'FundingVoucher'),
    ActivationAuthorization: deriveAuthorizationHash(vectors, 'ActivationAuthorization'),
    SettlementAuthorization: deriveAuthorizationHash(vectors, 'SettlementAuthorization'),
    CloseAuthorization: deriveAuthorizationHash(vectors, 'CloseAuthorization'),
  }
}

function deriveAuthorizationHash(vectors: Eip712VectorInput, primaryType: string) {
  const type = vectors.types[primaryType]
  const authorization = vectors.authorizations[primaryType]
  if (!type) {
    throw new Eip712EncodingError('MISSING_TYPE', `types.${primaryType}`, '缺少 EIP-712 类型定义')
  }
  if (!authorization) {
    throw new Eip712EncodingError('MISSING_AUTHORIZATION', `authorizations.${primaryType}`, '缺少 EIP-712 授权向量')
  }

  const domain = normalizeDomain(vectors.domains[type.domain], `domains.${type.domain}`)
  const types = { [primaryType]: type.fields }
  const message = normalizeMessage(type, authorization.message, `authorizations.${primaryType}.message`)

  return {
    typeHash: keccak256(stringToBytes(type.typeString)) as Hex,
    structHash: hashStruct({ types, primaryType, data: message }) as Hex,
    digest: hashTypedData({ domain, types, primaryType, message }) as Hex,
  }
}

function normalizeDomain(domain: Eip712DomainVector | undefined, path: string) {
  if (!domain) {
    throw new Eip712EncodingError('MISSING_DOMAIN', path, '缺少 EIP-712 domain')
  }
  if (!domain.name || !domain.version) {
    throw new Eip712EncodingError('INVALID_DOMAIN', path, 'domain name/version 不得为空')
  }
  if (!isAddress(domain.verifyingContract) || domain.verifyingContract === zeroAddress) {
    throw new Eip712EncodingError('INVALID_DOMAIN', `${path}.verifyingContract`, 'domain verifyingContract 必须是非零地址')
  }

  return {
    name: domain.name,
    version: domain.version,
    chainId: toUint(domain.chainId, `${path}.chainId`),
    verifyingContract: domain.verifyingContract as Hex,
  }
}

function normalizeMessage(
  type: Eip712TypeVector,
  message: Eip712AuthorizationVector['message'],
  path: string,
) {
  return Object.fromEntries(
    type.fields.map((field) => {
      if (!(field.name in message)) {
        throw new Eip712EncodingError('MISSING_FIELD', `${path}.${field.name}`, '授权 message 缺少字段')
      }
      const value = message[field.name]
      if (field.type === 'address') {
        if (typeof value !== 'string' || !isAddress(value)) {
          throw new Eip712EncodingError('INVALID_ADDRESS', `${path}.${field.name}`, '地址字段格式无效')
        }
        return [field.name, value as Hex]
      }
      if (field.type === 'bytes32') {
        if (typeof value !== 'string' || !isHex32(value)) {
          throw new Eip712EncodingError('INVALID_HEX32', `${path}.${field.name}`, 'bytes32 字段格式无效')
        }
        return [field.name, value.toLowerCase() as Hex]
      }
      if (uintTypes.has(field.type)) {
        return [field.name, toUint(value, `${path}.${field.name}`)]
      }
      throw new Eip712EncodingError('UNSUPPORTED_TYPE', `${path}.${field.name}`, `不支持的 EIP-712 字段类型 ${field.type}`)
    }),
  )
}

function toUint(value: bigint | number | string, path: string) {
  let parsed: bigint
  if (typeof value === 'bigint') {
    parsed = value
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Eip712EncodingError('INVALID_UINT', path, 'number 输入必须是安全整数')
    }
    parsed = BigInt(value)
  } else if (/^[0-9]+$/.test(value)) {
    parsed = BigInt(value)
  } else {
    throw new Eip712EncodingError('INVALID_UINT', path, '整数必须是非负十进制')
  }
  if (parsed < 0n) {
    throw new Eip712EncodingError('INVALID_UINT', path, '整数不得为负')
  }
  return parsed
}

function isHex32(value: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(value)
}

const zeroAddress = '0x0000000000000000000000000000000000000000'
