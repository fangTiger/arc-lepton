import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from './types'
import { AgentLogStream } from './AgentLogStream'

vi.mock('./TerminalMarkdown', () => ({
  TerminalMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

class MockEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances: MockEventSource[] = []

  readonly url: string
  readonly withCredentials: boolean
  readyState = MockEventSource.CONNECTING
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly close = vi.fn(() => {
    this.readyState = MockEventSource.CLOSED
  })
  readonly addEventListener = vi.fn()

  constructor(url: string, init?: { withCredentials?: boolean }) {
    this.url = url
    this.withCredentials = init?.withCredentials ?? false
    MockEventSource.instances.push(this)
  }

  static reset() {
    MockEventSource.instances.length = 0
  }
}

describe('AgentLogStream', () => {
  beforeEach(() => {
    MockEventSource.reset()
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each<[string, AgentEvent]>([
    ['final', { type: 'final', reportMd: '# Done', totalSpentUsdc: '0.0001', totalCalls: 1 }],
    ['error', { type: 'error', message: 'Research cancelled' }],
  ])('does not open EventSource when events already contain a %s terminal event', (_label, event) => {
    render(
      <AgentLogStream
        researchId="research-terminal"
        events={[{ ...event, receivedAt: '00:00:00' }]}
        onEvent={() => {}}
      />,
    )

    expect(MockEventSource.instances).toHaveLength(0)
    expect(screen.getByText('CLOSED')).toBeInTheDocument()
  })

  it('closes the existing EventSource when the stream becomes terminal via props without reconnecting', async () => {
    const onEvent = vi.fn()
    const { rerender } = render(
      <AgentLogStream
        researchId="research-live"
        events={[]}
        onEvent={onEvent}
      />,
    )

    expect(MockEventSource.instances).toHaveLength(1)
    const source = MockEventSource.instances[0]

    rerender(
      <AgentLogStream
        researchId="research-live"
        events={[{ type: 'final', reportMd: '# Done', totalSpentUsdc: '0.0001', totalCalls: 1, receivedAt: '00:00:01' }]}
        onEvent={onEvent}
      />,
    )

    await waitFor(() => {
      expect(source.close).toHaveBeenCalledTimes(1)
    })
    expect(MockEventSource.instances).toHaveLength(1)
    expect(screen.getByText('CLOSED')).toBeInTheDocument()
  })

  it('shows reconnecting instead of a red error for transient EventSource reconnects', async () => {
    render(
      <AgentLogStream
        researchId="research-live"
        events={[]}
        onEvent={() => {}}
      />,
    )

    const source = MockEventSource.instances[0]
    act(() => {
      source.onerror?.()
    })

    expect(screen.getByText('RECONNECTING')).toBeInTheDocument()
    expect(screen.queryByText('ERROR')).not.toBeInTheDocument()
  })
})
