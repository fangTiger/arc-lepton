import { concatHex, encodeAbiParameters, getAddress, isAddress, keccak256 } from 'viem'

export class EscrowAddressPredictionError extends Error {
  constructor(
    readonly code: string,
    readonly path: string,
    message: string,
  ) {
    super(message)
    this.name = 'EscrowAddressPredictionError'
  }
}

export type Hex32 = `0x${string}`

const EIP_1167_CREATION_PREFIX = '0x3d602d80600a3d3981f3'
const EIP_1167_RUNTIME_PREFIX = '363d3d373d3d3d363d73'
const EIP_1167_RUNTIME_SUFFIX = '5af43d82803e903d91602b57fd5bf3'

export function escrowSaltFor(buyer: string, researchKey: string): Hex32 {
  const checkedBuyer = requireAddress(buyer, 'buyer')
  const checkedResearchKey = requireHex32(researchKey, 'researchKey')

  return keccak256(encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes32' }],
    [checkedBuyer, checkedResearchKey],
  )) as Hex32
}

export function minimalProxyCreationCode(implementation: string): `0x${string}` {
  const checkedImplementation = requireAddress(implementation, 'implementation')
  return `${EIP_1167_CREATION_PREFIX}${EIP_1167_RUNTIME_PREFIX}${checkedImplementation.slice(2)}${EIP_1167_RUNTIME_SUFFIX}`
}

export function predictResearchEscrowAddress(input: {
  factory: string
  implementation: string
  buyer: string
  researchKey: string
}) {
  const factory = requireAddress(input.factory, 'factory')
  const salt = escrowSaltFor(input.buyer, input.researchKey)
  const bytecodeHash = keccak256(minimalProxyCreationCode(input.implementation))
  const digest = keccak256(concatHex(['0xff', factory, salt, bytecodeHash]))

  return getAddress(`0x${digest.slice(-40)}`)
}

function requireAddress(value: string, path: string): `0x${string}` {
  if (!isAddress(value) || /^0x0{40}$/i.test(value)) {
    throw new EscrowAddressPredictionError('INVALID_ADDRESS', path, `${path} 必须是非零 EVM 地址`)
  }
  return getAddress(value)
}

function requireHex32(value: string, path: string): Hex32 {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new EscrowAddressPredictionError('INVALID_HEX32', path, `${path} 必须是非零 bytes32`)
  }
  return value.toLowerCase() as Hex32
}
