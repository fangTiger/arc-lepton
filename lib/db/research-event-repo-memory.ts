import { randomUUID } from 'node:crypto'
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

export class MemoryResearchEventRepo implements ResearchEventRepo {
  private events = new Map<string, DurableResearchEvent>()
  private checkpoints = new Map<string, ResearchCheckpoint>()
  private cursors = new Map<string, number>()
  private eventDedupeIndex = new Map<string, string>()
  private checkpointDedupeIndex = new Map<string, string>()

  async appendEvent(input: AppendResearchEventInput): Promise<AppendResearchEventResult> {
    const researchId = normalizeEventResearchId(input.researchId)
    const dedupeKey = input.dedupeKey ?? null
    if (dedupeKey) {
      const existingId = this.eventDedupeIndex.get(this.dedupeIndexKey(researchId, dedupeKey))
      const existing = existingId ? this.events.get(existingId) : undefined
      if (existing) return { status: 'existing', event: this.cloneEvent(existing) }
    }

    const event: DurableResearchEvent = {
      id: randomUUID(),
      researchId,
      cursor: this.nextCursor(researchId),
      type: input.type,
      payload: cloneJson(input.payload),
      payloadHash: input.payloadHash,
      operationKey: input.operationKey ?? null,
      attempt: input.attempt ?? null,
      fencingToken: input.fencingToken ?? null,
      dedupeKey,
      createdAt: new Date(),
    }
    this.events.set(event.id, event)
    if (dedupeKey) this.eventDedupeIndex.set(this.dedupeIndexKey(researchId, dedupeKey), event.id)
    return { status: 'appended', event: this.cloneEvent(event) }
  }

  async listByResearch(researchIdInput: string, query: ResearchEventQuery = {}): Promise<DurableResearchEvent[]> {
    const researchId = normalizeEventResearchId(researchIdInput)
    const afterCursor = query.afterCursor ?? 0
    const limit = query.limit ?? 500
    return [...this.events.values()]
      .filter((event) => event.researchId === researchId && event.cursor > afterCursor)
      .sort((a, b) => a.cursor - b.cursor)
      .slice(0, limit)
      .map((event) => this.cloneEvent(event))
  }

  async recordCheckpoint(input: RecordResearchCheckpointInput): Promise<RecordResearchCheckpointResult> {
    const researchId = normalizeEventResearchId(input.researchId)
    const dedupeKey = input.dedupeKey ?? null
    if (dedupeKey) {
      const existingId = this.checkpointDedupeIndex.get(this.dedupeIndexKey(researchId, dedupeKey))
      const existing = existingId ? this.checkpoints.get(existingId) : undefined
      if (existing) return { status: 'existing', checkpoint: this.cloneCheckpoint(existing) }
    }

    const checkpoint: ResearchCheckpoint = {
      id: randomUUID(),
      researchId,
      cursor: this.nextCursor(researchId),
      operationKey: input.operationKey,
      attempt: input.attempt,
      fencingToken: input.fencingToken,
      payloadHash: input.payloadHash,
      state: cloneJson(input.state),
      dedupeKey,
      createdAt: new Date(),
    }
    this.checkpoints.set(checkpoint.id, checkpoint)
    if (dedupeKey) this.checkpointDedupeIndex.set(this.dedupeIndexKey(researchId, dedupeKey), checkpoint.id)
    return { status: 'recorded', checkpoint: this.cloneCheckpoint(checkpoint) }
  }

  async latestCheckpoint(researchIdInput: string): Promise<ResearchCheckpoint | null> {
    const researchId = normalizeEventResearchId(researchIdInput)
    const checkpoint = [...this.checkpoints.values()]
      .filter((item) => item.researchId === researchId)
      .sort((a, b) => b.cursor - a.cursor)[0]
    return checkpoint ? this.cloneCheckpoint(checkpoint) : null
  }

  private nextCursor(researchId: string) {
    const next = (this.cursors.get(researchId) ?? 0) + 1
    this.cursors.set(researchId, next)
    return next
  }

  private dedupeIndexKey(researchId: string, dedupeKey: string) {
    return `${researchId}::${dedupeKey}`
  }

  private cloneEvent(event: DurableResearchEvent): DurableResearchEvent {
    return {
      ...event,
      payload: cloneJson(event.payload),
      createdAt: new Date(event.createdAt),
    }
  }

  private cloneCheckpoint(checkpoint: ResearchCheckpoint): ResearchCheckpoint {
    return {
      ...checkpoint,
      state: cloneJson(checkpoint.state),
      createdAt: new Date(checkpoint.createdAt),
    }
  }
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}
