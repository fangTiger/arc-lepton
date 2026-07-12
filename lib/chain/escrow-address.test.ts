import { describe, expect, it } from 'vitest'
import { getContractAddress, keccak256 } from 'viem'
import {
  escrowSaltFor,
  minimalProxyCreationCode,
  predictResearchEscrowAddress,
} from './escrow-address'

describe('ResearchEscrow CREATE2 address prediction', () => {
  const factory = '0x3333333333333333333333333333333333333333'
  const implementation = '0x1111111111111111111111111111111111111111'
  const buyer = '0x2222222222222222222222222222222222222222'
  const researchKey = '0xfe2db078baed94897122e9aa2fbe0f26040774ca8fe547a9c5fe96b1bca03464'

  it('matches viem CREATE2 calculation for the OpenZeppelin clone init code', () => {
    const bytecode = minimalProxyCreationCode(implementation)
    const expected = getContractAddress({
      bytecode,
      from: factory,
      opcode: 'CREATE2',
      salt: escrowSaltFor(buyer, researchKey),
    })

    expect(predictResearchEscrowAddress({ factory, implementation, buyer, researchKey })).toBe(expected)
    expect(keccak256(bytecode)).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it('isolates the same researchKey by buyer and rejects unsafe inputs', () => {
    const first = predictResearchEscrowAddress({ factory, implementation, buyer, researchKey })
    const second = predictResearchEscrowAddress({
      factory,
      implementation,
      buyer: '0x4444444444444444444444444444444444444444',
      researchKey,
    })

    expect(first).not.toBe(second)
    expect(() => escrowSaltFor('0x0000000000000000000000000000000000000000', researchKey)).toThrow(
      expect.objectContaining({ code: 'INVALID_ADDRESS' }),
    )
    expect(() => escrowSaltFor(buyer, '0x0000000000000000000000000000000000000000000000000000000000000000')).toThrow(
      expect.objectContaining({ code: 'INVALID_HEX32' }),
    )
  })
})
