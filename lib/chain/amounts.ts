export class AmountConversionError extends Error {
  readonly code: string
  readonly path: string

  constructor(code: string, path: string, message: string) {
    super(message)
    this.name = 'AmountConversionError'
    this.code = code
    this.path = path
  }
}

export const SCALE8_PER_UNIT6 = 100n
export const NATIVE_PER_UNIT6 = 1_000_000_000_000n
export const UINT256_MAX = (1n << 256n) - 1n

export function parseScale8DecimalToUnits6(value: unknown) {
  if (typeof value !== 'string') {
    throw new AmountConversionError('NON_CANONICAL_DECIMAL', 'value', 'Escrow 金额必须使用 decimal string，禁止 number/float')
  }
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(value)) {
    throw new AmountConversionError('NON_CANONICAL_DECIMAL', 'value', 'decimal 必须是非负 canonical scale-8 十进制字符串')
  }

  const [wholePart, fractionPart = ''] = value.split('.')
  const scale8 = BigInt(wholePart) * 100_000_000n + BigInt(fractionPart.padEnd(8, '0') || '0')
  return scale8ToUnits6(scale8)
}

export function scale8ToUnits6(value: unknown) {
  const amountScale8 = toUint256(value, 'amountScale8')
  requireNonZero(amountScale8, 'amountScale8')
  if (amountScale8 % SCALE8_PER_UNIT6 !== 0n) {
    throw new AmountConversionError('SCALE8_TRUNCATION', 'amountScale8', 'scale-8 金额必须能被 100 整除，禁止截断或四舍五入')
  }
  return amountScale8 / SCALE8_PER_UNIT6
}

export function units6ToScale8(value: unknown) {
  const amountUnits6 = toUint256(value, 'amountUnits6')
  requireNonZero(amountUnits6, 'amountUnits6')
  return checkedMul(amountUnits6, SCALE8_PER_UNIT6, 'amountUnits6')
}

export function units6ToNative18(value: unknown) {
  const amountUnits6 = toUint256(value, 'amountUnits6')
  requireNonZero(amountUnits6, 'amountUnits6')
  return checkedMul(amountUnits6, NATIVE_PER_UNIT6, 'amountUnits6')
}

export function native18ToUnits6(value: unknown) {
  const amountNative18 = toUint256(value, 'amountNative18')
  requireNonZero(amountNative18, 'amountNative18')
  if (amountNative18 % NATIVE_PER_UNIT6 !== 0n) {
    throw new AmountConversionError('NATIVE18_TRUNCATION', 'amountNative18', 'native18 金额必须能被 10^12 整除，禁止截断或混比')
  }
  return amountNative18 / NATIVE_PER_UNIT6
}

export function native18AmountEqualsUnits6(units6Value: unknown, native18Value: unknown) {
  const amountUnits6 = toUint256(units6Value, 'amountUnits6')
  const amountNative18 = toUint256(native18Value, 'amountNative18')
  if (amountUnits6 === 0n || amountNative18 === 0n) {
    return false
  }
  if (amountUnits6 > UINT256_MAX / NATIVE_PER_UNIT6) {
    return false
  }
  return amountUnits6 * NATIVE_PER_UNIT6 === amountNative18
}

function checkedMul(left: bigint, right: bigint, path: string) {
  if (left > UINT256_MAX / right) {
    throw new AmountConversionError('UINT256_OVERFLOW', path, '金额换算会溢出 uint256')
  }
  return left * right
}

function requireNonZero(value: bigint, path: string) {
  if (value === 0n) {
    throw new AmountConversionError('ZERO_AMOUNT', path, 'Escrow 金额必须大于零')
  }
}

function toUint256(value: unknown, path: string) {
  let parsed: bigint
  if (typeof value === 'bigint') {
    parsed = value
  } else if (typeof value === 'string' && /^[0-9]+$/.test(value)) {
    parsed = BigInt(value)
  } else {
    throw new AmountConversionError('INVALID_UINT', path, '金额必须是 bigint 或非负十进制整数字符串')
  }
  if (parsed < 0n || parsed > UINT256_MAX) {
    throw new AmountConversionError('INVALID_UINT', path, '金额超出 uint256 范围')
  }
  return parsed
}
