export const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '0')
export const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? ''
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
export const APP_HOST = new URL(APP_URL).host

export const COOKIE_NAME = 'arc_session'
export const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7 // 7 days

export const NONCE_TTL_SEC = 60 * 5 // 5 min
export const SIWE_MAX_AGE_MS = 5 * 60 * 1000 // 5 min issuedAt window

export const RATE_LIMIT_NONCE = { max: 120, windowSec: 60 }
export const RATE_LIMIT_VERIFY = { max: 30, windowSec: 60 }
