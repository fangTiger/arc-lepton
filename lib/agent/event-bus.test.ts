import { afterEach, describe, expect, it } from 'vitest'

const eventBusGlobal = globalThis as typeof globalThis & {
  __arcLeptonResearchEventBus?: unknown
}

afterEach(() => {
  delete eventBusGlobal.__arcLeptonResearchEventBus
})

describe('publishResearchEvent', () => {
  it('ignores terminal duplicates after the first terminal event', async () => {
    const { getResearchEvents, publishResearchEvent } = await import('./event-bus')

    expect(publishResearchEvent('research-1', { type: 'error', message: 'Research cancelled' })).toBe(true)
    expect(publishResearchEvent('research-1', { type: 'error', message: 'Research cancelled' })).toBe(false)
    expect(
      publishResearchEvent('research-1', {
        type: 'final',
        reportMd: '# Late final',
        totalSpentUsdc: '0',
        totalCalls: 0,
      }),
    ).toBe(false)
    expect(publishResearchEvent('research-1', { type: 'thinking', text: 'Late progress' })).toBe(false)
    expect(getResearchEvents('research-1')).toEqual({
      done: false,
      events: [{ type: 'error', message: 'Research cancelled' }],
    })
  })

  it('ignores all late events once the stream is marked done', async () => {
    const { getResearchEvents, markResearchDone, publishResearchEvent } = await import('./event-bus')

    expect(publishResearchEvent('research-2', { type: 'thinking', text: 'Started' })).toBe(true)
    markResearchDone('research-2')

    expect(
      publishResearchEvent('research-2', {
        type: 'budget',
        spentUsdc: '0.0001',
        remainingUsdc: '0.0099',
      }),
    ).toBe(false)
    expect(publishResearchEvent('research-2', { type: 'error', message: 'Late failure' })).toBe(false)
    expect(getResearchEvents('research-2')).toEqual({
      done: true,
      events: [{ type: 'thinking', text: 'Started' }],
    })
  })

  it('allows only one active runner claim per research stream', async () => {
    const { claimResearchRunner, markResearchDone, publishResearchEvent } = await import('./event-bus')

    expect(claimResearchRunner('research-3')).toBe(true)
    expect(claimResearchRunner('research-3')).toBe(false)

    markResearchDone('research-3')
    expect(claimResearchRunner('research-3')).toBe(false)

    expect(publishResearchEvent('research-4', { type: 'error', message: 'Research cancelled' })).toBe(true)
    expect(claimResearchRunner('research-4')).toBe(false)
  })
})
