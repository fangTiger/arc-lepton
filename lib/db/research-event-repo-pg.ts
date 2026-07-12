import { asc, desc, eq, and, gt, max } from 'drizzle-orm'
import type { VercelPgDatabase } from 'drizzle-orm/vercel-postgres'
import * as schema from './schema'
import { researchCheckpoint, researchEvent } from './schema/research-event'
import type {
  AppendResearchEventInput,
  AppendResearchEventResult,
  DurableResearchEvent,
  RecordResearchCheckpointInput,
  RecordResearchCheckpointResult,
  ResearchCheckpoint,
  ResearchEventQuery,
  ResearchEventRepo,
} from './research-event-repo'
import { normalizeEventResearchId } from './research-event-repo'

type DbClient = VercelPgDatabase<typeof schema>

function toEvent(row: typeof researchEvent.$inferSelect): DurableResearchEvent {
  return row
}

function toCheckpoint(row: typeof researchCheckpoint.$inferSelect): ResearchCheckpoint {
  return row
}

export class PgResearchEventRepo implements ResearchEventRepo {
  constructor(private readonly database: DbClient) {}

  async appendEvent(input: AppendResearchEventInput): Promise<AppendResearchEventResult> {
    const researchId = normalizeEventResearchId(input.researchId)
    const existing = input.dedupeKey ? await this.findEventByDedupeKey(researchId, input.dedupeKey) : null
    if (existing) return { status: 'existing', event: existing }

    const [row] = await this.database
      .insert(researchEvent)
      .values({
        researchId,
        cursor: await this.nextCursor(researchId),
        type: input.type,
        payload: input.payload,
        payloadHash: input.payloadHash,
        operationKey: input.operationKey ?? null,
        attempt: input.attempt ?? null,
        fencingToken: input.fencingToken ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning()
    if (row) return { status: 'appended', event: toEvent(row) }

    const raced = input.dedupeKey ? await this.findEventByDedupeKey(researchId, input.dedupeKey) : null
    if (!raced) throw new Error(`Failed to append durable event for ${researchId}`)
    return { status: 'existing', event: raced }
  }

  async listByResearch(researchIdInput: string, query: ResearchEventQuery = {}): Promise<DurableResearchEvent[]> {
    const researchId = normalizeEventResearchId(researchIdInput)
    const rows = await this.database
      .select()
      .from(researchEvent)
      .where(and(eq(researchEvent.researchId, researchId), gt(researchEvent.cursor, query.afterCursor ?? 0)))
      .orderBy(asc(researchEvent.cursor))
      .limit(query.limit ?? 500)
    return rows.map(toEvent)
  }

  async recordCheckpoint(input: RecordResearchCheckpointInput): Promise<RecordResearchCheckpointResult> {
    const researchId = normalizeEventResearchId(input.researchId)
    const existing = input.dedupeKey ? await this.findCheckpointByDedupeKey(researchId, input.dedupeKey) : null
    if (existing) return { status: 'existing', checkpoint: existing }

    const [row] = await this.database
      .insert(researchCheckpoint)
      .values({
        researchId,
        cursor: await this.nextCursor(researchId),
        operationKey: input.operationKey,
        attempt: input.attempt,
        fencingToken: input.fencingToken,
        payloadHash: input.payloadHash,
        state: input.state,
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning()
    if (row) return { status: 'recorded', checkpoint: toCheckpoint(row) }

    const raced = input.dedupeKey ? await this.findCheckpointByDedupeKey(researchId, input.dedupeKey) : null
    if (!raced) throw new Error(`Failed to record checkpoint for ${researchId}`)
    return { status: 'existing', checkpoint: raced }
  }

  async latestCheckpoint(researchIdInput: string): Promise<ResearchCheckpoint | null> {
    const researchId = normalizeEventResearchId(researchIdInput)
    const [row] = await this.database
      .select()
      .from(researchCheckpoint)
      .where(eq(researchCheckpoint.researchId, researchId))
      .orderBy(desc(researchCheckpoint.cursor))
      .limit(1)
    return row ? toCheckpoint(row) : null
  }

  private async nextCursor(researchId: string) {
    const [eventRow] = await this.database
      .select({ value: max(researchEvent.cursor) })
      .from(researchEvent)
      .where(eq(researchEvent.researchId, researchId))
    const [checkpointRow] = await this.database
      .select({ value: max(researchCheckpoint.cursor) })
      .from(researchCheckpoint)
      .where(eq(researchCheckpoint.researchId, researchId))
    return Math.max(Number(eventRow?.value ?? 0), Number(checkpointRow?.value ?? 0)) + 1
  }

  private async findEventByDedupeKey(researchId: string, dedupeKey: string) {
    const [row] = await this.database
      .select()
      .from(researchEvent)
      .where(and(eq(researchEvent.researchId, researchId), eq(researchEvent.dedupeKey, dedupeKey)))
      .limit(1)
    return row ? toEvent(row) : null
  }

  private async findCheckpointByDedupeKey(researchId: string, dedupeKey: string) {
    const [row] = await this.database
      .select()
      .from(researchCheckpoint)
      .where(and(eq(researchCheckpoint.researchId, researchId), eq(researchCheckpoint.dedupeKey, dedupeKey)))
      .limit(1)
    return row ? toCheckpoint(row) : null
  }
}
