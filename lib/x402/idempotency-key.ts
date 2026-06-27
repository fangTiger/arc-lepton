export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/

export function isValidIdempotencyKey(value: string) {
  return IDEMPOTENCY_KEY_PATTERN.test(value)
}
