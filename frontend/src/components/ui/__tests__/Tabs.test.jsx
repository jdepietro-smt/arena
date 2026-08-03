import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Tabs from '../Tabs'

const TABS = [
  { value: 'live', label: 'Live Streams' },
  { value: 'presets', label: 'Presets' },
]

describe('Tabs', () => {
  it('renders every tab label', () => {
    render(<Tabs tabs={TABS} active="live" onChange={() => {}} />)
    expect(screen.getByText('Live Streams')).toBeInTheDocument()
    expect(screen.getByText('Presets')).toBeInTheDocument()
  })

  it('visually marks the active tab distinctly from inactive ones', () => {
    render(<Tabs tabs={TABS} active="live" onChange={() => {}} />)
    const active = screen.getByText('Live Streams')
    const inactive = screen.getByText('Presets')
    expect(active.className).toContain('bg-brand-500/15')
    expect(inactive.className).not.toContain('bg-brand-500/15')
  })

  it('calls onChange with the clicked tab\'s value, not its label', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={TABS} active="live" onChange={onChange} />)
    await userEvent.click(screen.getByText('Presets'))
    expect(onChange).toHaveBeenCalledWith('presets')
  })

  it('does not fire onChange just from re-rendering with a different active value', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Tabs tabs={TABS} active="live" onChange={onChange} />)
    rerender(<Tabs tabs={TABS} active="presets" onChange={onChange} />)
    expect(onChange).not.toHaveBeenCalled()
  })
})
