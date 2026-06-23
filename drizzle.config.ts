import type { Config } from 'drizzle-kit'

export default {
  schema: './lib/db/schema/users.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
} satisfies Config
