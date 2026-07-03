import type { Config } from 'drizzle-kit'

export default {
  schema: [
    './lib/db/schema/users.ts',
    './lib/db/schema/tx-log.ts',
    './lib/db/schema/research.ts',
    './lib/db/schema/research-follow-up.ts',
    './lib/db/schema/payment-settlement.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  },
} satisfies Config
