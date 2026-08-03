import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Badge from '../Badge'

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge tone="good">LIVE</Badge>)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
  })

  it.each(['good', 'warning', 'critical', 'info', 'muted'])(
    'applies distinct styling per tone (%s)',
    (tone) => {
      const { container } = render(<Badge tone={tone}>x</Badge>)
      expect(container.firstChild.className).toContain(tone === 'good' ? 'emerald' : '')
    }
  )

  it('falls back to the muted style for an unrecognized tone', () => {
    const { container: unknown } = render(<Badge tone="not-a-real-tone">x</Badge>)
    const { container: muted } = render(<Badge tone="muted">x</Badge>)
    expect(unknown.firstChild.className).toBe(muted.firstChild.className)
  })

  it('merges a custom className onto the base styles', () => {
    const { container } = render(<Badge tone="good" className="ml-2">x</Badge>)
    expect(container.firstChild.className).toContain('ml-2')
    expect(container.firstChild.className).toContain('rounded-full')
  })
})
