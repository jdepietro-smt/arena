import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import Modal from '../Modal'

describe('Modal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>content</Modal>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders its children when open', () => {
    render(<Modal open onClose={() => {}}>Hello there</Modal>)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
  })

  it('closes when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose}>content</Modal>)
    // The backdrop is the outer element; click it directly (not the panel inside).
    await userEvent.click(screen.getByText('content').closest('.fixed'))
    expect(onClose).toHaveBeenCalled()
  })

  it('does NOT close when clicking inside the panel itself', async () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose}>content</Modal>)
    await userEvent.click(screen.getByText('content'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    render(<Modal open onClose={onClose}>content</Modal>)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  it('moves focus to the first focusable element inside on open', async () => {
    render(
      <Modal open onClose={() => {}}>
        <button>First</button>
        <button>Second</button>
      </Modal>
    )
    expect(screen.getByText('First')).toHaveFocus()
  })

  it('traps Tab focus within the dialog', async () => {
    render(
      <Modal open onClose={() => {}}>
        <button>First</button>
        <button>Second</button>
      </Modal>
    )
    const first = screen.getByText('First')
    const second = screen.getByText('Second')
    expect(first).toHaveFocus()

    second.focus()
    await userEvent.tab()
    expect(first).toHaveFocus() // wrapped from last back to first
  })
})
