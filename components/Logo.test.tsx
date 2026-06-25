import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { Logo } from './Logo'

describe('Logo', () => {
  it('uses the Signal Ledger brand and links to the homepage', () => {
    render(createElement(Logo))

    expect(screen.getByRole('link', { name: 'SIGNAL/LEDGER' })).toHaveAttribute('href', '/')
  })
})
