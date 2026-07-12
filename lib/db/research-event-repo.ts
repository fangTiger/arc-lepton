export type DurableResearchEventType =
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'budget'
  | 'report_chunk'
  | 'final'
  | 'error'
  | string

export type DurableResearchEvent = {
  id: string
  researchId: string
  cursor: number
  type: DurableResearchEventType
  payload: unknown
  payloadHash: string
  operationKey: string | null
  attempt: number | null
  fencingToken: number | null
  dedupeKey: string | null
  createdAt: Date
}

export type ResearchCheckpoint = {
  id: string
  researchId: string
  cursor: number
  operationKey: string
  attempt: number
  fencingToken: number
  payloadHash: string
  state: unknown
  dedupeKey: string | null
  createdAt: Date
}

export type AppendResearchEventInput = {
  researchId: string
  type: DurableResearchEventType
  payload: unknown
  payloadHash: string
  operationKey?: string | null
  attempt?: number | null
  fencingToken?: number | null
  dedupeKey?: string | null
}

export type AppendResearchEventResult =
  | { status: 'appended'; event: DurableResearchEvent }
  | { status: 'existing'; event: DurableResearchEvent }

export type RecordResearchCheckpointInput = {
  researchId: string
  operationKey: string
  attempt: number
  fencingToken: number
  payloadHash: string
  state: unknown
  dedupeKey?: string | null
}

export type RecordResearchCheckpointResult =
  | { status: 'recorded'; checkpoint: ResearchCheckpoint }
  | { status: 'existing'; checkpoint: ResearchCheckpoint }

export type ResearchEventQuery = {
  afterCursor?: number
  limit?: number
}

export interface ResearchEventRepo {
  appendEvent(input: AppendResearchEventInput): Promise<AppendResearchEventResult>
  listByResearch(researchId: string, query?: ResearchEventQuery): Promise<DurableResearchEvent[]>
  recordCheckpoint(input: RecordResearchCheckpointInput): Promise<RecordResearchCheckpointResult>
  latestCheckpoint(researchId: string): Promise<ResearchCheckpoint | null>
}

export function normalizeEventResearchId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('researchId is required for durable research event')
  return trimmed
}
