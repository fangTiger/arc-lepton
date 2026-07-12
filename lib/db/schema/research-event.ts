import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { DurableResearchEventType } from '../research-event-repo'

export const researchEvent = pgTable(
  'research_event',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    researchId: text('research_id').notNull(),
    cursor: integer('cursor').notNull(),
    type: text('type').$type<DurableResearchEventType>().notNull(),
    payload: jsonb('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    operationKey: text('operation_key'),
    attempt: integer('attempt'),
    fencingToken: integer('fencing_token'),
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('research_event_research_cursor_uidx').on(table.researchId, table.cursor),
    uniqueIndex('research_event_research_dedupe_uidx').on(table.researchId, table.dedupeKey),
    index('research_event_research_idx').on(table.researchId),
  ],
)

export const researchCheckpoint = pgTable(
  'research_checkpoint',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    researchId: text('research_id').notNull(),
    cursor: integer('cursor').notNull(),
    operationKey: text('operation_key').notNull(),
    attempt: integer('attempt').notNull(),
    fencingToken: integer('fencing_token').notNull(),
    payloadHash: text('payload_hash').notNull(),
    state: jsonb('state').notNull(),
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('research_checkpoint_research_cursor_uidx').on(table.researchId, table.cursor),
    uniqueIndex('research_checkpoint_research_dedupe_uidx').on(table.researchId, table.dedupeKey),
    index('research_checkpoint_research_idx').on(table.researchId),
  ],
)

export type ResearchEventRow = typeof researchEvent.$inferSelect
export type NewResearchEventRow = typeof researchEvent.$inferInsert
export type ResearchCheckpointRow = typeof researchCheckpoint.$inferSelect
export type NewResearchCheckpointRow = typeof researchCheckpoint.$inferInsert
