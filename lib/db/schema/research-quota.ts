import { index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const researchQuotaUsage = pgTable(
  'research_quota_usage',
  {
    id: text('id').primaryKey(),
    bucketType: text('bucket_type', { enum: ['wallet', 'global'] }).notNull(),
    bucketKey: text('bucket_key').notNull(),
    day: text('day').notNull(),
    consumed: integer('consumed').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    used: integer('used').notNull().default(0),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('research_quota_usage_bucket_idx').on(table.bucketType, table.bucketKey, table.day),
  ],
)

export type ResearchQuotaUsageRow = typeof researchQuotaUsage.$inferSelect
