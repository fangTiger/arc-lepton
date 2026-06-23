export function buildSiweMessage(opts: {
  domain: string
  address: string
  uri: string
  chainId: number
  nonce: string
  issuedAt?: string
}): string {
  const issuedAt = opts.issuedAt ?? new Date().toISOString()
  return [
    `${opts.domain} wants you to sign in with your Ethereum account:`,
    opts.address,
    '',
    'Sign in to Arc Lepton.',
    '',
    `URI: ${opts.uri}`,
    `Version: 1`,
    `Chain ID: ${opts.chainId}`,
    `Nonce: ${opts.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n')
}
