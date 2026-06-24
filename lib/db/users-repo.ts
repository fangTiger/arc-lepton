export type UserRecord = {
  address: string
  createdAt: Date
  lastLoginAt: Date
}

export interface UsersRepo {
  upsertOnLogin(address: string): Promise<void>
  getByAddress(address: string): Promise<UserRecord | null>
  count(): Promise<number>
}
