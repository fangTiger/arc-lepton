import { privateKeyToAccount } from 'viem/accounts'

export const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
export const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY)

export async function signTestMessage(message: string): Promise<`0x${string}`> {
  return testAccount.signMessage({ message })
}
