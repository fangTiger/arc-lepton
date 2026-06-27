import { index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { research } from './research'

export const researchFollowUp = pgTable(
  'research_follow_up',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    researchId: uuid('research_id').notNull().references(() => research.id, { onDelete: 'cascade' }),
    address: text('address').notNull(),
    question: text('question').notNull(),
    answerMd: text('answer_md'),
    status: text('status', { enum: ['pending', 'completed', 'failed'] }).notNull().default('pending'),
    spentUsdc: numeric('spent_usdc', { precision: 18, scale: 8 }).notNull().default('0'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('research_follow_up_address_created_at_idx').on(table.address, table.createdAt.desc()),
    index('research_follow_up_research_id_created_at_idx').on(table.researchId, table.createdAt.desc()),
  ],
)

export type ResearchFollowUpRow = typeof researchFollowUp.$inferSelect
export type NewResearchFollowUp = typeof researchFollowUp.$inferInsert
