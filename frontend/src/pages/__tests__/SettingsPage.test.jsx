import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsPage from '../SettingsPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { usePendingDeleteStore } from '../../store/pendingDelete'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  getAuditLog: vi.fn(),
  default: { get: vi.fn(), put: vi.fn() },
}))

import { getUsers, createUser, deleteUser, getAuditLog } from '../../api/client'
import api from '../../api/client'

function renderSettingsPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
      <ToastStack />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getUsers.mockReset().mockResolvedValue([])
  createUser.mockReset()
  deleteUser.mockReset()
  getAuditLog.mockReset().mockResolvedValue([])
  api.get.mockReset().mockResolvedValue({ data: {} })
  api.put.mockReset().mockResolvedValue({ data: {} })
  act(() => {
    useToastStore.setState({ toasts: [] })
    usePendingDeleteStore.setState({ hidden: new Set() })
  })
})

describe('SettingsPage', () => {
  it('defaults to the Server tab', async () => {
    renderSettingsPage()
    expect(screen.getByText('Server configuration')).toBeInTheDocument()
  })

  it('shows the empty state when there are no users', async () => {
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await screen.findByText('No users found')).toBeInTheDocument()
  })

  it('lists users returned by the API with role and status badges', async () => {
    getUsers.mockResolvedValue([
      { id: 1, username: 'alice', email: 'alice@example.com', role: 'admin', active: true },
      { id: 2, username: 'bob', email: null, role: 'viewer', active: false },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('No email')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('creates a user through the Add user modal and refreshes the list', async () => {
    createUser.mockResolvedValue({ id: 3, username: 'newop', role: 'operator' })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    await userEvent.click(await screen.findByRole('button', { name: /add user/i }))

    await userEvent.type(screen.getByPlaceholderText('operator1'), 'newop')
    await userEvent.type(screen.getByPlaceholderText('operator1@arena.local'), 'newop@arena.local')
    await userEvent.type(screen.getByPlaceholderText('Minimum 8 characters'), 'Password123!')
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))

    await waitFor(() => {
      expect(createUser).toHaveBeenCalled()
    })
    expect(createUser.mock.calls[0][0]).toEqual({
      username: 'newop', email: 'newop@arena.local', password: 'Password123!', role: 'operator',
    })
    // Modal closes on success.
    await waitFor(() => {
      expect(screen.queryByText('Add user')).not.toBeInTheDocument()
    })
  })

  it('shows a readable error toast (and does not crash) on a 422 validation error', async () => {
    // FastAPI sends `detail` as an array of {type, loc, msg, input} objects
    // for request-validation errors, not a string — rendering that array
    // directly used to crash the whole app ("Objects are not valid as a
    // React child").
    createUser.mockRejectedValue({
      response: {
        status: 422,
        data: {
          detail: [
            { type: 'missing', loc: ['body', 'email'], msg: 'Field required', input: {} },
          ],
        },
      },
    })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    await userEvent.click(await screen.findByRole('button', { name: /add user/i }))

    await userEvent.type(screen.getByPlaceholderText('operator1'), 'newop')
    await userEvent.type(screen.getByPlaceholderText('operator1@arena.local'), 'newop@arena.local')
    await userEvent.type(screen.getByPlaceholderText('Minimum 8 characters'), 'Password123!')
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))

    expect(await screen.findByText('Field required')).toBeInTheDocument()
    // The page is still alive and interactive — not an error-boundary crash.
    expect(screen.getByRole('button', { name: 'Create user' })).toBeInTheDocument()
  })

  it('hides the user immediately on remove and only calls the API after the undo grace period', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getUsers.mockResolvedValue([{ id: 1, username: 'alice', email: null, role: 'viewer', active: true }])
    deleteUser.mockResolvedValue({})
    renderSettingsPage()
    await user.click(screen.getByRole('tab', { name: 'Users' }))
    await screen.findByText('alice')

    await user.click(screen.getByRole('button', { name: 'Remove' }))

    expect(screen.queryByText('alice')).not.toBeInTheDocument()
    expect(screen.getByText('User deleted')).toBeInTheDocument()
    expect(deleteUser).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(6001))
    expect(deleteUser).toHaveBeenCalledWith(1)
    vi.useRealTimers()
  })

  it('undoing a user removal restores it and never calls the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getUsers.mockResolvedValue([{ id: 1, username: 'alice', email: null, role: 'viewer', active: true }])
    deleteUser.mockResolvedValue({})
    renderSettingsPage()
    await user.click(screen.getByRole('tab', { name: 'Users' }))
    await screen.findByText('alice')

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByText('alice')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('alice')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(10000))
    expect(deleteUser).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('shows a connection-error message instead of the empty state when the users query fails', async () => {
    getUsers.mockRejectedValue(new Error('network error'))
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await screen.findByText('Could not load users. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText('No users found')).not.toBeInTheDocument()
  })

  it('shows an error toast when saving recording settings fails', async () => {
    api.put.mockRejectedValue({ response: { data: { detail: 'Disk full' } } })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Recording' }))

    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(await screen.findByText('Disk full')).toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('loads the saved recording config into the form instead of the hardcoded default', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/settings/recording') {
        return Promise.resolve({ data: { output_dir: '/mnt/real-recordings', max_storage_gb: 250, auto_delete: true } })
      }
      return Promise.resolve({ data: {} })
    })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Recording' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('/mnt/real-recordings')).toBeInTheDocument()
    })
    expect(screen.getByText('250 GB')).toBeInTheDocument()
  })

  it('saves recording settings and shows a confirmation', async () => {
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Recording' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/settings/recording', {
        output_dir: '/recordings', max_storage_gb: 500, auto_delete: false,
      })
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('shows the empty state on the Audit Log tab when there are no entries', async () => {
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Audit Log' }))

    expect(await screen.findByText('No audit entries yet')).toBeInTheDocument()
  })

  it('lists audit entries with a human-readable action label', async () => {
    getAuditLog.mockResolvedValue([
      { id: 1, username: 'admin1', action: 'user.create', target: 'newop', detail: 'role=operator', created_at: '2026-01-15T10:30:00Z' },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Audit Log' }))

    expect(await screen.findByText('Created user')).toBeInTheDocument()
    expect(screen.getByText('admin1')).toBeInTheDocument()
    expect(screen.getByText('newop')).toBeInTheDocument()
  })

  it('shows a permission message instead of a generic error on 403', async () => {
    getAuditLog.mockRejectedValue({ response: { status: 403 } })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Audit Log' }))

    expect(await screen.findByText('Admin access required to view the audit log.')).toBeInTheDocument()
  })
})
