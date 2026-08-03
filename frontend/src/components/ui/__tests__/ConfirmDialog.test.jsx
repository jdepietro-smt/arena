import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import ConfirmDialog from '../ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmDialog open={false} onConfirm={() => {}} onCancel={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the title and message when open', () => {
    render(
      <ConfirmDialog
        open
        title="Delete route"
        message='Delete route "cam1"?'
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    )
    expect(screen.getByText('Delete route')).toBeInTheDocument()
    expect(screen.getByText('Delete route "cam1"?')).toBeInTheDocument()
  })

  it('calls onConfirm when the confirm button is clicked', async () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog open confirmLabel="Delete" onConfirm={onConfirm} onCancel={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onConfirm).toHaveBeenCalled()
  })

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open onConfirm={() => {}} onCancel={onCancel} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalled()
  })

  it('calls onCancel on Escape (inherited from Modal)', async () => {
    const onCancel = vi.fn()
    render(<ConfirmDialog open onConfirm={() => {}} onCancel={onCancel} />)

    await userEvent.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalled()
  })

  it('disables both buttons and shows a loading label while loading', () => {
    render(
      <ConfirmDialog open loading confirmLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />
    )

    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled()
  })
})
