import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const research = pgTable(
  'research',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    address: text('address').notNull(),
    topic: text('topic').notNull(),
    budgetUsdc: numeric('budget_usdc', { precision: 18, scale: 8 }).notNull(),
    spentUsdc: numeric('spent_usdc', { precision: 18, scale: 8 }).notNull().default('0'),
    status: text('status', { enum: ['running', 'completed', 'failed', 'cancelled'] }).notNull().default('running'),
    reportMd: text('report_md'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [index('research_address_started_at_idx').on(table.address, table.startedAt.desc())],
)

export type ResearchRow = typeof research.$inferSelect
export type NewResearch = typeof research.$inferInsert
