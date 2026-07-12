import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const migrationJournal = pgTable('arc_migration_journal', {
  id: text('id').primaryKey(),
  phase: text('phase').notNull(),
  checksum: text('checksum').notNull(),
  description: text('description').notNull(),
  status: text('status', { enum: ['running', 'applied', 'failed'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type MigrationJournalRow = typeof migrationJournal.$inferSelect
