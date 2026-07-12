import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryResearchEventRepo } from './research-event-repo-memory'

describe('MemoryResearchEventRepo', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('appends durable events with monotonic cursors and replays them by research', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T04:00:00.000Z'))
    const repo = new MemoryResearchEventRepo()

    const first = await repo.appendEvent(eventInput({
      type: 'thinking',
      payload: { text: 'checking registry' },
      dedupeKey: 'run-1:thinking-1',
    }))
    vi.setSystemTime(new Date('2026-07-11T04:00:01.000Z'))
    const second = await repo.appendEvent(eventInput({
      type: 'tool_result',
      payload: { source: 'whale-flow', payment: { requestId: 'req-1', txStatus: 'pending' } },
      dedupeKey: 'run-1:tool-result-1',
    }))

    expect(first).toMatchObject({
      status: 'appended',
      event: {
        researchId: 'research-1',
        cursor: 1,
        type: 'thinking',
        operationKey: 'RUN:research-1',
        attempt: 1,
        fencingToken: 3,
        payloadHash: hex32('aa'),
        createdAt: new Date('2026-07-11T04:00:00.000Z'),
      },
    })
    expect(second.event.cursor).toBe(2)

    await expect(repo.listByResearch('research-1')).resolves.toEqual([
      first.event,
      second.event,
    ])
    await expect(repo.listByResearch('research-1', { afterCursor: 1 })).resolves.toEqual([
      second.event,
    ])
    await expect(repo.listByResearch('research-2')).resolves.toEqual([])
  })

  it('dedupes retried logical events and records checkpoints without protected payload leakage', async () => {
    const repo = new MemoryResearchEventRepo()

    const first = await repo.appendEvent(eventInput({
      type: 'tool_call',
      payload: { name: 'whale-flow', args: { token: 'PEPE' } },
      dedupeKey: 'run-1:tool-call-1',
    }))
    const retry = await repo.appendEvent(eventInput({
      type: 'tool_call',
      payload: { name: 'whale-flow', args: { token: 'PEPE' } },
      dedupeKey: 'run-1:tool-call-1',
    }))

    expect(retry).toEqual({ status: 'existing', event: first.event })
    await expect(repo.listByResearch('research-1')).resolves.toHaveLength(1)

    const checkpoint = await repo.recordCheckpoint({
      researchId: 'research-1',
      operationKey: 'RUN:research-1',
      attempt: 1,
      fencingToken: 3,
      payloadHash: hex32('cc'),
      state: {
        lastCursor: first.event.cursor,
        phase: 'after-tool-call',
        protectedPayloadDigest: hex32('dd'),
      },
      dedupeKey: 'run-1:checkpoint-1',
    })

    expect(checkpoint).toMatchObject({
      status: 'recorded',
      checkpoint: {
        researchId: 'research-1',
        cursor: 2,
        operationKey: 'RUN:research-1',
        attempt: 1,
        fencingToken: 3,
        payloadHash: hex32('cc'),
        state: {
          lastCursor: 1,
          phase: 'after-tool-call',
          protectedPayloadDigest: hex32('dd'),
        },
      },
    })
    await expect(repo.latestCheckpoint('research-1')).resolves.toEqual(checkpoint.checkpoint)
    expect(JSON.stringify(checkpoint)).not.toContain('rawAuthorization')
  })
})

function eventInput(overrides: Partial<Parameters<MemoryResearchEventRepo['appendEvent']>[0]> = {}) {
  return {
    researchId: 'research-1',
    type: 'thinking',
    payload: { text: 'hello' },
    payloadHash: hex32('aa'),
    operationKey: 'RUN:research-1',
    attempt: 1,
    fencingToken: 3,
    dedupeKey: 'run-1:event',
    ...overrides,
  }
}

function hex32(byte: string) {
  return `0x${byte.repeat(32)}`
}
