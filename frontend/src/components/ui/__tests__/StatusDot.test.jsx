import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StatusDot from '../StatusDot'

describe('StatusDot', () => {
  it('renders the correct color for each tone', () => {
    const expected = {
      good: 'rgb(52, 211, 153)',
      warning: 'rgb(251, 191, 36)',
      critical: 'rgb(248, 113, 113)',
      muted: 'rgb(82, 82, 91)',
    }
    for (const [tone, rgb] of Object.entries(expected)) {
      const { container } = render(<StatusDot tone={tone} />)
      const dot = container.firstChild
      expect(dot.style.background).toBe(rgb)
    }
  })

  it('falls back to muted for an unrecognized tone', () => {
    const { container } = render(<StatusDot tone="not-a-real-tone" />)
    expect(container.firstChild.style.background).toBe('rgb(82, 82, 91)')
  })

  it('only applies the glow shadow when pulsing', () => {
    const { container: still } = render(<StatusDot tone="good" pulse={false} />)
    expect(still.firstChild.style.boxShadow).toBe('none')

    const { container: pulsing } = render(<StatusDot tone="good" pulse />)
    expect(pulsing.firstChild.style.boxShadow).not.toBe('none')
    expect(pulsing.firstChild.className).toContain('animate-pulse')
  })

  it('respects a custom size', () => {
    const { container } = render(<StatusDot tone="good" size={20} />)
    expect(container.firstChild.style.width).toBe('20px')
    expect(container.firstChild.style.height).toBe('20px')
  })
})
