import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ResearchDetailClient } from './ResearchDetailClient'

const routerPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}))

vi.mock('@/components/research/TerminalMarkdown', () => ({
  TerminalMarkdown: ({ content }: { content: string }) => <div>{content}</div>,
}))

describe('ResearchDetailClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
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
    })))
  })

  it('offers a way back to the current session and to research history', async () => {
    render(createElement(ResearchDetailClient, { id: 'research-1' }))

    fireEvent.click(await screen.findByRole('button', { name: /\[← BACK TO SESSION\]/i }))
    expect(routerPush).toHaveBeenCalledWith('/research?id=research-1')

    fireEvent.click(screen.getByRole('button', { name: /\[VIEW HISTORY\]/i }))
    expect(routerPush).toHaveBeenCalledWith('/dashboard')
  })
})
