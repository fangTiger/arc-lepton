import type { UserRecord, UsersRepo } from './users-repo'

export class MemoryUsersRepo implements UsersRepo {
  private users = new Map<string, UserRecord>()

  async upsertOnLogin(address: string): Promise<void> {
    const now = new Date()
    const existing = this.users.get(address)

    if (existing) {
      this.users.set(address, { ...existing, lastLoginAt: now })
      return
    }

    this.users.set(address, {
      address,
      createdAt: now,
      lastLoginAt: now,
    })
  }

  async getByAddress(address: string): Promise<UserRecord | null> {
    return this.users.get(address) ?? null
  }

  async count(): Promise<number> {
    return this.users.size
  }
}
