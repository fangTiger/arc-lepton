import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchDetailClient } from './ResearchDetailClient'

const routerPush = vi.fn()
const routerReplace = vi.fn()
const fetchMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: routerReplace }),
}))

vi.mock('@/components/research/TerminalMarkdown', () => ({
  TerminalMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe('ResearchDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_ARC_EXPLORER_URL = 'https://arc.example'
    window.history.replaceState({}, '', '/research/research-1')
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/follow-ups') && init?.method === 'POST') {
        return Response.json({
          followUp: {
            id: 'fu-2',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Does the setup improve with stronger volume?',
            answerMd: '## Follow-up Answer\nThe setup still needs confirmation even if volume improves.',
            status: 'completed',
            spentUsdc: '0',
            errorMessage: null,
            createdAt: '2026-06-27T08:05:00.000Z',
            completedAt: '2026-06-27T08:05:08.000Z',
          },
        })
      }
      if (url.endsWith('/follow-ups')) {
        return Response.json({
          followUps: [],
        })
      }
      return Response.json({
        research: {
          id: 'research-1',
          address: '0xabcdef000000000000000000000000000000c1d3',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: '0.0012',
          status: 'completed',
          reportMd: '# Report',
          errorMessage: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:18.000Z',
        },
        txLog: [
          {
            id: 'tx-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'news',
            amount: '0.0003',
            txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
            txStatus: 'confirmed',
            chainId: 5_042_002,
            blockNumber: '12345',
            requestId: 'req-1',
            errorMessage: null,
            createdAt: '2026-06-25T00:00:00.000Z',
          },
          {
            id: 'tx-2',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'sentiment',
            amount: '0.0001',
            txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
            txStatus: 'mock',
            chainId: null,
            blockNumber: null,
            requestId: 'req-2',
            errorMessage: null,
            createdAt: '2026-06-25T00:00:02.000Z',
          },
          {
            id: 'tx-3',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'whale-watch',
            amount: '0.0002',
            txHash: null,
            txStatus: 'failed',
            chainId: null,
            blockNumber: null,
            requestId: 'req-3',
            errorMessage: 'RPC timeout',
            createdAt: '2026-06-25T00:00:03.000Z',
          },
          {
            id: 'tx-4',
            address: '0xabcdef000000000000000000000000000000c1d3',
            source: 'twitter-signals',
            amount: '0.0001',
            txHash: null,
            txStatus: 'pending',
            chainId: null,
            blockNumber: null,
            requestId: 'req-4',
            errorMessage: null,
            createdAt: '2026-06-25T00:00:04.000Z',
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  it('offers a way back to the current session and to research history', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    fireEvent.click(await screen.findByRole('button', { name: /\[← BACK TO SESSION\]/i }))
    expect(routerPush).toHaveBeenCalledWith('/research?id=research-1')

    fireEvent.click(screen.getByRole('button', { name: /\[VIEW HISTORY\]/i }))
    expect(routerPush).toHaveBeenCalledWith('/dashboard')
  })

  it('shows confirmed/mock/failed receipt states truthfully and only links confirmed receipts', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const links = await screen.findAllByRole('link')

    expect(screen.getByText('confirmed')).toBeInTheDocument()
    expect(screen.getByText('mock receipt')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('pending')).toBeInTheDocument()
    expect(screen.getAllByText('not broadcast')).toHaveLength(2)
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://arc.example/tx/0x1111111111111111111111111111111111111111111111111111111111111111')
  })

  it('counts only mock and confirmed receipts in the header calls summary', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/\$0\.0012 USDC \(2 calls\)/i)).toBeInTheDocument()
  })

  it('shows a follow-up entry point with an empty state', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/follow-up q&a/i)).toBeInTheDocument()
    expect(screen.getByText(/no follow-up questions yet/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/ask a follow-up about this report/i)).toBeInTheDocument()
  })

  it('scrolls to the follow-up section and focuses the input when the page loads with the follow-up hash', async () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
    const scrollSpy = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollSpy,
    })
    const focusSpy = vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(() => {})
    window.history.replaceState({}, '', '/research/research-1#follow-up')

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    await screen.findByText(/follow-up q&a/i)
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled())
    expect(focusSpy).toHaveBeenCalled()

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView,
    })
    focusSpy.mockRestore()
  })

  it('submits a follow-up question and appends the returned answer', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Does the setup improve with stronger volume?' } })
    fireEvent.click(screen.getByRole('button', { name: /submit follow-up/i }))

    expect(await screen.findByText(/the setup still needs confirmation even if volume improves\./i)).toBeInTheDocument()
    await waitFor(() => expect(input).toHaveValue(''))
    expect(fetchMock).toHaveBeenCalledWith('/api/research/research-1/follow-ups', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
    }))
  })

  it('appends a failed follow-up card and shows an English error when generation fails with 502', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/follow-ups') && init?.method === 'POST') {
        return Response.json({
          error: 'FOLLOW_UP_FAILED',
          followUp: {
            id: 'fu-9',
            researchId: 'research-1',
            address: '0xabcdef000000000000000000000000000000c1d3',
            question: 'Need one more angle on invalidation.',
            answerMd: null,
            status: 'failed',
            spentUsdc: '0',
            errorMessage: 'Follow-up answer generation failed',
            createdAt: '2026-06-27T08:06:00.000Z',
            completedAt: '2026-06-27T08:06:05.000Z',
          },
        }, { status: 502 })
      }
      if (url.endsWith('/follow-ups')) {
        return Response.json({ followUps: [] })
      }
      return Response.json({
        research: {
          id: 'research-1',
          address: '0xabcdef000000000000000000000000000000c1d3',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: '0.0012',
          status: 'completed',
          reportMd: '# Report',
          errorMessage: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:18.000Z',
        },
        txLog: [],
      })
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Need one more angle on invalidation.' } })
    fireEvent.click(screen.getByRole('button', { name: /submit follow-up/i }))

    expect(await screen.findByText(/the follow-up answer could not be generated\. please try again\./i)).toBeInTheDocument()
    expect(screen.getAllByText('Need one more angle on invalidation.').length).toBeGreaterThan(0)
    expect(screen.getByText(/follow-up answer failed\. please try again\./i)).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
  })

  it('shows an English error state when follow-up creation fails', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/follow-ups') && init?.method === 'POST') {
        return Response.json({ error: 'BUDGET_EXHAUSTED' }, { status: 409 })
      }
      if (url.endsWith('/follow-ups')) {
        return Response.json({ followUps: [] })
      }
      return Response.json({
        research: {
          id: 'research-1',
          address: '0xabcdef000000000000000000000000000000c1d3',
          topic: 'SHOULD I BUY PEPE?',
          budgetUsdc: '0.01',
          spentUsdc: '0.0012',
          status: 'completed',
          reportMd: '# Report',
          errorMessage: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          completedAt: '2026-06-25T00:00:18.000Z',
        },
        txLog: [],
      })
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    const input = await screen.findByPlaceholderText(/ask a follow-up about this report/i)
    fireEvent.change(input, { target: { value: 'Can you give me one more check?' } })
    fireEvent.click(screen.getByRole('button', { name: /submit follow-up/i }))

    expect(await screen.findByText(/no remaining budget is available for follow-up questions/i)).toBeInTheDocument()
  })

  it('shows a friendly authentication error without leaking internal load codes', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/api/research/research-1')) {
        return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 })
      }
      throw new Error(`unexpected request: ${url}`)
    })

    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    expect(await screen.findByText(/authentication expired\. please sign in again\./i)).toBeInTheDocument()
    expect(routerReplace).toHaveBeenCalledWith('/login?redirect=%2Fresearch%2Fresearch-1')
    expect(screen.queryByText(/load_failed_401/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/loading report_/i)).not.toBeInTheDocument()
  })
})
