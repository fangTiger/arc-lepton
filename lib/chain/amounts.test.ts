import { describe, expect, it } from 'vitest'

import vectors from '../../contracts/test/vectors/amount-conversions.json'

describe('escrow amount conversion vectors', () => {
  it('固定 scale-8、六位 ERC-20 units 与 18 位 native 换算向量', () => {
    expect(vectors.units.scale8PerUnit6).toBe('100')
    expect(vectors.units.nativePerUnit6).toBe('1000000000000')
    expect(vectors.valid).toContainEqual({
      label: 'minimum non-zero unit',
      decimal: '0.000001',
      scale8: '100',
      units6: '1',
      native18: '1000000000000',
    })
    expect(vectors.valid).toContainEqual({
      label: 'six decimal precision',
      decimal: '1.234567',
      scale8: '123456700',
      units6: '1234567',
      native18: '1234567000000000000',
    })
  })

  it('TypeScript escrow amount converter 必须精确换算且拒绝截断/混比', async () => {
    const amountModulePath = './amounts'
    const amounts = await import(amountModulePath)

    expect(amounts.parseScale8DecimalToUnits6('0.000001')).toBe(1n)
    expect(amounts.parseScale8DecimalToUnits6('1.234567')).toBe(1_234_567n)
    expect(amounts.scale8ToUnits6(100n)).toBe(1n)
    expect(amounts.units6ToScale8(1_234_567n)).toBe(123_456_700n)
    expect(amounts.units6ToNative18(1_234_567n)).toBe(1_234_567_000_000_000_000n)
    expect(amounts.native18ToUnits6(1_234_567_000_000_000_000n)).toBe(1_234_567n)
    expect(amounts.native18AmountEqualsUnits6(1_000_000n, 1_000_000_000_000_000_000n)).toBe(true)
    expect(amounts.native18AmountEqualsUnits6(1_000_000n, 1_000_000n)).toBe(false)

    expectAmountError(() => amounts.parseScale8DecimalToUnits6('0'))
    expectAmountError(() => amounts.parseScale8DecimalToUnits6('0.00000001'))
    expectAmountError(() => amounts.parseScale8DecimalToUnits6('1.23456789'))
    expectAmountError(() => amounts.parseScale8DecimalToUnits6('1e-6'))
    expectAmountError(() => amounts.parseScale8DecimalToUnits6('-1'))
    expectAmountError(() => amounts.parseScale8DecimalToUnits6(0.000001))
    expectAmountError(() => amounts.scale8ToUnits6(101n))
    expectAmountError(() => amounts.native18ToUnits6(1_000_000_000_001n))
  })
})

function expectAmountError(action: () => unknown) {
  expect(action).toThrow()
}
