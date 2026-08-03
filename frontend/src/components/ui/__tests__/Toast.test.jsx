import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ToastStack from '../Toast'
import { toast, useToastStore } from '../../../store/toast'

beforeEach(() => {
  act(() => {
    useToastStore.setState({ toasts: [] })
  })
})

describe('ToastStack', () => {
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastStack />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a success toast pushed via toast.success()', async () => {
    render(<ToastStack />)
    act(() => toast.success('Recording started'))

    expect(await screen.findByText('Recording started')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('renders an error toast pushed via toast.error()', async () => {
    render(<ToastStack />)
    act(() => toast.error('Failed to delete recording'))

    expect(await screen.findByText('Failed to delete recording')).toBeInTheDocument()
  })

  it('stacks multiple toasts', async () => {
    render(<ToastStack />)
    act(() => {
      toast.success('First')
      toast.info('Second')
    })

    expect(await screen.findByText('First')).toBeInTheDocument()
    expect(screen.getByText('Second')).toBeInTheDocument()
  })

  it('dismisses a toast when its close button is clicked', async () => {
    render(<ToastStack />)
    act(() => toast.success('Dismiss me'))
    await screen.findByText('Dismiss me')

    await userEvent.click(screen.getByLabelText('Dismiss'))

    expect(screen.queryByText('Dismiss me')).not.toBeInTheDocument()
  })

  it('auto-dismisses after its duration elapses', async () => {
    vi.useFakeTimers()
    render(<ToastStack />)
    act(() => toast.success('Auto-dismiss', { duration: 1000 }))
    expect(screen.getByText('Auto-dismiss')).toBeInTheDocument()

    await act(async () => {
      vi.advanceTimersByTime(1001)
    })

    expect(screen.queryByText('Auto-dismiss')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
