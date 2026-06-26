import { CompactSign, jwtVerify } from 'jose'

const RESEARCH_RUN_TOKEN_TTL_SEC = 60 * 60

export type ResearchRunTokenPayload = {
  id: string
  address: string
  topic: string
  budgetUsdc: string
  iat: number
  exp: number
}

type ResearchRunTokenInput = {
  id: string
  address: string
  topic: string
  budgetUsdc: string
}

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET missing or too short')
  return Uint8Array.from(new TextEncoder().encode(secret))
}

function stringPayload(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export async function signResearchRunToken(input: ResearchRunTokenInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const payload = Uint8Array.from(new TextEncoder().encode(
    JSON.stringify({
      ...input,
      address: input.address.toLowerCase(),
      iat: now,
      exp: now + RESEARCH_RUN_TOKEN_TTL_SEC,
    }),
  ))

  return new CompactSign(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .sign(getSecret())
}

export async function verifyResearchRunToken(token: string): Promise<ResearchRunTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (
      !stringPayload(payload.id) ||
      !stringPayload(payload.address) ||
      !stringPayload(payload.topic) ||
      !stringPayload(payload.budgetUsdc) ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null
    }

    return {
      id: payload.id,
      address: payload.address.toLowerCase(),
      topic: payload.topic,
      budgetUsdc: payload.budgetUsdc,
      iat: payload.iat,
      exp: payload.exp,
    }
  } catch {
    return null
  }
}
