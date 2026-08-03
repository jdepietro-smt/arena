import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Sparkline from '../Sparkline'

describe('Sparkline', () => {
  it('renders nothing for empty data', () => {
    const { container } = render(<Sparkline data={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for null data', () => {
    const { container } = render(<Sparkline data={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an svg path for the data', () => {
    const { container } = render(<Sparkline data={[1000, 2000, 1500, 3000]} />)
    expect(container.querySelector('path')).toBeInTheDocument()
  })

  it('shows a formatted tooltip on hover and hides it on mouse leave', () => {
    const { container } = render(
      <Sparkline data={[1000, 2000, 3000]} formatValue={(v) => `${v} units`} />
    )
    const svg = container.querySelector('svg')

    fireEvent.mouseMove(svg, { clientX: 50 })
    expect(screen.getByText(/units/)).toBeInTheDocument()

    fireEvent.mouseLeave(svg)
    expect(screen.queryByText(/units/)).not.toBeInTheDocument()
  })
})
