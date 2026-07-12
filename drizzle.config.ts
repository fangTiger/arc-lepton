import type { Config } from 'drizzle-kit'

export default {
  schema: [
    './lib/db/schema/users.ts',
    './lib/db/schema/tx-log.ts',
    './lib/db/schema/research.ts',
    './lib/db/schema/research-follow-up.ts',
    './lib/db/schema/payment-settlement.ts',
    './lib/db/schema/workflow-outbox.ts',
    './lib/db/schema/research-event.ts',
    './lib/db/schema/migration-journal.ts',
    './lib/db/schema/research-quota.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  },
} satisfies Config
