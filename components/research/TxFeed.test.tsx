import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { TxFeed } from './TxFeed'

describe('TxFeed', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ARC_EXPLORER_URL = 'https://arc.example'
  })

  it('keeps receipts inside an internal scroll region with viewport-bound height', () => {
    render(createElement(TxFeed, { events: [] }))

    const panel = screen.getByText('TX FEED').closest('section')
    const scroller = screen.getByRole('region', { name: 'TX FEED' })

    expect(panel).toHaveClass('flex', 'flex-col', 'h-[calc(100vh-214px)]', 'min-h-[500px]')
    expect(scroller).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
    expect(scroller).toHaveAttribute('tabIndex', '0')
    expect(within(scroller).getByText('WAITING FOR TOOL PAYMENTS_')).toBeInTheDocument()
  })

  it('shows confirmed/mock/failed payment states and only links confirmed receipts', () => {
    render(createElement(TxFeed, {
      events: [
        {
          type: 'tool_result',
          callId: 'call-confirmed',
          name: 'news',
          payment: {
            amount: '0.0003',
            txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
            txStatus: 'confirmed',
            chainId: 5_042_002,
            blockNumber: '12345',
            requestId: 'req-1',
          },
          dataPreview: '{}',
        },
        {
          type: 'tool_result',
          callId: 'call-mock',
          name: 'sentiment',
          payment: {
            amount: '0.0001',
            txHash: '0x2222222222222222222222222222222222222222222222222222222222222222',
            txStatus: 'mock',
            chainId: null,
            blockNumber: null,
            requestId: 'req-2',
          },
          dataPreview: '{}',
        },
        {
          type: 'tool_result',
          callId: 'call-failed',
          name: 'whale-watch',
          payment: {
            amount: '0.0002',
            txHash: null,
            txStatus: 'failed',
            chainId: null,
            blockNumber: null,
            requestId: 'req-3',
          },
          dataPreview: '{}',
        },
      ],
    }))

    const links = screen.getAllByRole('link')

    expect(screen.getByText('confirmed')).toBeInTheDocument()
    expect(screen.getByText('mock receipt')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('not broadcast')).toBeInTheDocument()
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://arc.example/tx/0x1111111111111111111111111111111111111111111111111111111111111111')
  })

  it('shows pending settlement without rendering an explorer link', () => {
    render(createElement(TxFeed, {
      events: [
        {
          type: 'tool_result',
          callId: 'call-pending',
          name: 'sentiment',
          payment: {
            amount: '0.0001',
            txHash: null,
            txStatus: 'pending',
            chainId: null,
            blockNumber: null,
            requestId: 'req-pending',
          },
          dataPreview: '{}',
        },
      ],
    }))

    expect(screen.getByText('pending settlement')).toBeInTheDocument()
    expect(screen.getByText('not broadcast')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByText('confirmed')).not.toBeInTheDocument()
  })

  it('renders shared confirmed settlement hashes as separate logical payment rows', () => {
    const sharedHash = '0x3333333333333333333333333333333333333333333333333333333333333333'

    render(createElement(TxFeed, {
      events: [
        {
          type: 'tool_result',
          callId: 'call-news',
          name: 'news',
          payment: {
            amount: '0.0003',
            txHash: sharedHash,
            txStatus: 'confirmed',
            chainId: 5_042_002,
            blockNumber: '12345',
            requestId: 'req-news',
          },
          dataPreview: '{}',
        },
        {
          type: 'tool_result',
          callId: 'call-sentiment',
          name: 'sentiment',
          payment: {
            amount: '0.0001',
            txHash: sharedHash,
            txStatus: 'confirmed',
            chainId: 5_042_002,
            blockNumber: '12345',
            requestId: 'req-sentiment',
          },
          dataPreview: '{}',
        },
      ],
    }))

    const links = screen.getAllByRole('link')

    expect(screen.getByText('news')).toBeInTheDocument()
    expect(screen.getByText('sentiment')).toBeInTheDocument()
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', `https://arc.example/tx/${sharedHash}`)
    expect(links[1]).toHaveAttribute('href', `https://arc.example/tx/${sharedHash}`)
  })
})
