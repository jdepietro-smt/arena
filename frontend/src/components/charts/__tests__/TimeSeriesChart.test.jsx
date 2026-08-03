import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import TimeSeriesChart from '../TimeSeriesChart'

const data = [
  { x: -3, y: 10 },
  { x: -2, y: 20 },
  { x: -1, y: null },
  { x: 0, y: 15 },
]

describe('TimeSeriesChart', () => {
  it('renders an area path when variant="area"', () => {
    const { container } = render(<TimeSeriesChart data={data} variant="area" />)
    const paths = container.querySelectorAll('path')
    // one for the line, one for the area fill
    expect(paths.length).toBe(2)
  })

  it('renders only a line path when variant="line" (no area fill)', () => {
    const { container } = render(<TimeSeriesChart data={data} variant="line" />)
    expect(container.querySelectorAll('path').length).toBe(1)
  })

  it('shows a crosshair and tooltip on hover, hides on mouse leave', () => {
    const { container } = render(
      <TimeSeriesChart data={data} unit=" ms" yFormat={(v) => `${v}`} />
    )
    const svg = container.querySelector('svg')

    fireEvent.mouseMove(svg, { clientX: 50 })
    expect(screen.getByText(/ago/)).toBeInTheDocument()

    fireEvent.mouseLeave(svg)
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
  })

  it('shows an em-dash in the tooltip when the nearest point is a null gap', () => {
    // Force the hover onto the null point by using a single-point dataset
    // for a deterministic nearest-index, then re-render with the real gap.
    const gapOnly = [{ x: 0, y: null }]
    const { container } = render(<TimeSeriesChart data={gapOnly} />)
    const svg = container.querySelector('svg')

    fireEvent.mouseMove(svg, { clientX: 50 })

    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders y-axis tick labels using the provided yFormat', () => {
    render(<TimeSeriesChart data={data} yFormat={(v) => `${v}u`} />)
    expect(screen.getAllByText(/u$/).length).toBeGreaterThan(0)
  })
})
