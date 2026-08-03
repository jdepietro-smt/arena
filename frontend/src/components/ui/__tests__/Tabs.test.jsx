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

  it('exposes proper tab semantics: role="tablist", role="tab", and aria-selected', () => {
    render(<Tabs tabs={TABS} active="live" onChange={() => {}} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Live Streams' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Presets' })).toHaveAttribute('aria-selected', 'false')
  })

  it('only the active tab is in the Tab order (roving tabindex)', () => {
    render(<Tabs tabs={TABS} active="live" onChange={() => {}} />)
    expect(screen.getByRole('tab', { name: 'Live Streams' })).toHaveAttribute('tabIndex', '0')
    expect(screen.getByRole('tab', { name: 'Presets' })).toHaveAttribute('tabIndex', '-1')
  })

  it('ArrowRight moves selection to the next tab and wraps around', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={TABS} active="presets" onChange={onChange} />)
    screen.getByRole('tab', { name: 'Presets' }).focus()

    await userEvent.keyboard('{ArrowRight}')

    expect(onChange).toHaveBeenCalledWith('live')
  })

  it('ArrowLeft moves selection to the previous tab and wraps around', async () => {
    const onChange = vi.fn()
    render(<Tabs tabs={TABS} active="live" onChange={onChange} />)
    screen.getByRole('tab', { name: 'Live Streams' }).focus()

    await userEvent.keyboard('{ArrowLeft}')

    expect(onChange).toHaveBeenCalledWith('presets')
  })
})
