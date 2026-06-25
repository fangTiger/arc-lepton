import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from './TopBar'

vi.mock('@/lib/constants', () => ({
  ARC_CHAIN_ID: 5042002,
}))

describe('TopBar', () => {
  it('uses the Signal Ledger brand link as the first navigation target', () => {
    render(createElement(TopBar))

    expect(screen.getByRole('link', { name: 'SIGNAL/LEDGER' })).toHaveAttribute('href', '/')
  })
})
