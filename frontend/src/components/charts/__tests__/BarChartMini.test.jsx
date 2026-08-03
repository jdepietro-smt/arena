import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BarChartMini from '../BarChartMini'

const data = [
  { x: -2, y: 0.5 },
  { x: -1, y: 2 },
  { x: 0, y: 1 },
]

describe('BarChartMini', () => {
  it('renders one visible bar per non-null data point', () => {
    const { container } = render(<BarChartMini data={data} />)
    // 3 visible bars + 3 invisible hit-target rects = 6 rects total
    expect(container.querySelectorAll('rect').length).toBe(6)
  })

  it('skips rendering a bar for a null value but keeps its hit target', () => {
    const withGap = [{ x: -1, y: null }, { x: 0, y: 5 }]
    const { container } = render(<BarChartMini data={withGap} />)
    // 1 visible bar (null point skipped) + 2 hit targets
    expect(container.querySelectorAll('rect').length).toBe(3)
  })

  it('shows a per-bar tooltip on hover and hides it on mouse leave', () => {
    render(<BarChartMini data={data} unit="%" />)
    const hitTargets = document.querySelectorAll('rect[fill="transparent"]')

    fireEvent.mouseEnter(hitTargets[1])
    expect(screen.getByText(/ago/)).toBeInTheDocument()
    expect(screen.getByText('2%')).toBeInTheDocument()

    fireEvent.mouseLeave(hitTargets[1])
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument()
  })
})
