import { describe, expect, it } from 'vitest'

import vectors from '../../contracts/test/vectors/eip712-vectors.json'

describe('research escrow EIP-712 vectors', () => {
  it('固定共享 fixture 中的 domain、type 与 digest 向量', () => {
    expect(vectors.standard).toBe('EIP-712')
    expect(vectors.domains.factory).toMatchObject({
      name: 'ArcLeptonResearchEscrowFactory',
      version: '1',
      chainId: 5_042_002,
      verifyingContract: '0x3333333333333333333333333333333333333333',
      separator: '0x73d91d8af8e8d146fb80a16d4f039d0ba03639ff2b96600b75f97ecb85b6b0fb',
    })
    expect(vectors.domains.escrow).toMatchObject({
      name: 'ArcLeptonResearchEscrow',
      version: '1',
      chainId: 5_042_002,
      verifyingContract: '0x4444444444444444444444444444444444444444',
      separator: '0xe157a0fffa62885c5b1c6322e8c521463ee31c1e71a1cd83006996c1fbfab967',
    })

    expect(vectors.types.FundingVoucher.typeHash).toBe(
      '0xb0805892b56f982f2a482c934c8b335b8f03c0c25dbbf41bd3bfcc37e9f31c49',
    )
    expect(vectors.types.ActivationAuthorization.typeHash).toBe(
      '0xee84862b56bdee65ce26a9db95f7c674354dbcb9ce8e695b627cd3ead1610acb',
    )
    expect(vectors.types.SettlementAuthorization.typeHash).toBe(
      '0xd6023f0cdead08b972e7aecf19e86c43dcfcd7f6e8f04aacd90acc90fe42e160',
    )
    expect(vectors.types.CloseAuthorization.typeHash).toBe(
      '0xf796cc95366fc26947d8b2475192187551efa93209a231ae85af49aa9b5d0bf5',
    )

    expect(vectors.authorizations.FundingVoucher.digest).toBe(
      '0x8faa9182addb6d5d08af23306436f3306498c84252c9ed09d88f3c6fd8eff95b',
    )
    expect(vectors.authorizations.ActivationAuthorization.digest).toBe(
      '0xbc1cbf4093c2e740f17393d450269fed5983c790354666867f34bd8a4949e6d7',
    )
    expect(vectors.authorizations.SettlementAuthorization.digest).toBe(
      '0xb3b9a8aa53892c97a11bea76829a29d72741f75bc6e0046ae69c0fcdeb3712b2',
    )
    expect(vectors.authorizations.CloseAuthorization.digest).toBe(
      '0x00b2124a61089fcd6b75eadd2b33a5c8876165709f25ccba22a38a213f5139ba',
    )
  })

  it('TypeScript EIP-712 encoder 必须匹配共享向量', async () => {
    const eip712ModulePath = './eip712'
    const eip712 = await import(eip712ModulePath)
    const result = eip712.deriveEip712VectorHashes(vectors)

    expect(result.factoryDomainSeparator).toBe(vectors.domains.factory.separator)
    expect(result.escrowDomainSeparator).toBe(vectors.domains.escrow.separator)
    expect(result.FundingVoucher.typeHash).toBe(vectors.types.FundingVoucher.typeHash)
    expect(result.FundingVoucher.structHash).toBe(vectors.authorizations.FundingVoucher.structHash)
    expect(result.FundingVoucher.digest).toBe(vectors.authorizations.FundingVoucher.digest)
    expect(result.ActivationAuthorization.typeHash).toBe(vectors.types.ActivationAuthorization.typeHash)
    expect(result.ActivationAuthorization.structHash).toBe(
      vectors.authorizations.ActivationAuthorization.structHash,
    )
    expect(result.ActivationAuthorization.digest).toBe(vectors.authorizations.ActivationAuthorization.digest)
    expect(result.SettlementAuthorization.typeHash).toBe(
      vectors.types.SettlementAuthorization.typeHash,
    )
    expect(result.SettlementAuthorization.structHash).toBe(
      vectors.authorizations.SettlementAuthorization.structHash,
    )
    expect(result.SettlementAuthorization.digest).toBe(
      vectors.authorizations.SettlementAuthorization.digest,
    )
    expect(result.CloseAuthorization.typeHash).toBe(vectors.types.CloseAuthorization.typeHash)
    expect(result.CloseAuthorization.structHash).toBe(vectors.authorizations.CloseAuthorization.structHash)
    expect(result.CloseAuthorization.digest).toBe(vectors.authorizations.CloseAuthorization.digest)
  })
})
