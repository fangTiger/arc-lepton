export type TxLogEntry = {
  id: string
  address: string
  source: string
  amount: string
  txHash: string
  createdAt: Date
}

export interface TxLogRepo {
  record(entry: { address: string; source: string; amount: string }): Promise<{ id: string; txHash: string; createdAt: Date }>
  listByAddress(address: string, limit?: number): Promise<TxLogEntry[]>
  totalSpentByAddress(address: string): Promise<string>
}

const DECIMAL_SCALE = 8n
const DECIMAL_BASE = 10n ** DECIMAL_SCALE

export function decimalToUnits(value: string): bigint {
  const [wholePart, fractionPart = ''] = value.split('.')
  const whole = BigInt(wholePart || '0')
  const fraction = BigInt(fractionPart.padEnd(Number(DECIMAL_SCALE), '0').slice(0, Number(DECIMAL_SCALE)) || '0')
  return whole * DECIMAL_BASE + fraction
}

export function unitsToDecimal(value: bigint): string {
  const whole = value / DECIMAL_BASE
  const fraction = (value % DECIMAL_BASE).toString().padStart(Number(DECIMAL_SCALE), '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function normalizeDecimalString(value: string): string {
  return unitsToDecimal(decimalToUnits(value))
}
