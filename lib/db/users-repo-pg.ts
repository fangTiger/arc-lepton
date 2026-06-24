import { count, eq } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema/users'
import { users } from './schema/users'
import type { UsersRepo, UserRecord } from './users-repo'

type DbClient = VercelPgDatabase<typeof schema>

export class PgUsersRepo implements UsersRepo {
  constructor(private readonly database: DbClient) {}

  async upsertOnLogin(address: string): Promise<void> {
    await this.database
      .insert(users)
      .values({ address })
      .onConflictDoUpdate({ target: users.address, set: { lastLoginAt: new Date() } })
  }

  async getByAddress(address: string): Promise<UserRecord | null> {
    const [user] = await this.database.select().from(users).where(eq(users.address, address)).limit(1)
    return user ?? null
  }

  async count(): Promise<number> {
    const [row] = await this.database.select({ value: count() }).from(users)
    return Number(row?.value ?? 0)
  }
}
