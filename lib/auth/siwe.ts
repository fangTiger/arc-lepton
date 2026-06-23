import { verifyMessage, type Address } from 'viem'
import type { KvClient } from '@/lib/kv'
import { SIWE_MAX_AGE_MS } from '@/lib/constants'
import { consumeNonce } from './nonce-store'

type Input = { message: string; signature: `0x${string}`; address: string }
export type SiweResult = { ok: true; address: Address } | { ok: false; reason: string }

interface ParsedSiwe {
  domain: string
  address: string
  uri: string
  version: string
  chainId: number
  nonce: string
  issuedAt: string
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
}

function getAppHost(): string {
  return new URL(getAppUrl()).host
}

function getArcChainId(): number {
  return Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? '0')
}

function parseSiwe(message: string): ParsedSiwe | null {
  const lines = message.split('\n')
  if (lines.length < 8) return null
  const domain = lines[0].split(' wants you to sign in')[0]
  const address = lines[1]
  const get = (key: string) => lines.find((line) => line.startsWith(`${key}: `))?.slice(key.length + 2) ?? ''
  return {
    domain,
    address,
    uri: get('URI'),
    version: get('Version'),
    chainId: parseInt(get('Chain ID'), 10),
    nonce: get('Nonce'),
    issuedAt: get('Issued At'),
  }
}

export async function verifySiweLogin(kv: KvClient, input: Input): Promise<SiweResult> {
  const parsed = parseSiwe(input.message)
  if (!parsed) return { ok: false, reason: 'parse_error' }

  if (parsed.address.toLowerCase() !== input.address.toLowerCase()) {
    return { ok: false, reason: 'address_mismatch' }
  }

  if (parsed.domain !== getAppHost()) return { ok: false, reason: 'domain_mismatch' }
  if (parsed.uri !== getAppUrl()) return { ok: false, reason: 'uri_mismatch' }
  if (parsed.chainId !== getArcChainId()) return { ok: false, reason: 'chain_mismatch' }
  if (parsed.version !== '1') return { ok: false, reason: 'version_mismatch' }

  const issuedTs = Date.parse(parsed.issuedAt)
  if (Number.isNaN(issuedTs) || Math.abs(Date.now() - issuedTs) > SIWE_MAX_AGE_MS) {
    return { ok: false, reason: 'expired' }
  }

  if (!(await consumeNonce(kv, parsed.nonce))) {
    return { ok: false, reason: 'nonce_invalid' }
  }

  try {
    const valid = await verifyMessage({
      address: input.address as Address,
      message: input.message,
      signature: input.signature,
    })
    if (!valid) return { ok: false, reason: 'signature_invalid' }
  } catch {
    return { ok: false, reason: 'signature_invalid' }
  }

  return { ok: true, address: input.address.toLowerCase() as Address }
}
