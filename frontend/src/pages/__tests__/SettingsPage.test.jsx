import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsPage from '../SettingsPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { usePendingDeleteStore } from '../../store/pendingDelete'
import { useAuthStore } from '../../store/auth'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  getAuditLog: vi.fn(),
  getLoginAttempts: vi.fn(),
  clearLoginLockout: vi.fn(),
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn() },
}))

import { getUsers, createUser, updateUser, deleteUser, getAuditLog, getLoginAttempts, clearLoginLockout } from '../../api/client'
import api from '../../api/client'

vi.mock('../../utils/csv', () => ({ downloadCsv: vi.fn() }))
import { downloadCsv } from '../../utils/csv'

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
  updateUser.mockReset()
  deleteUser.mockReset()
  getAuditLog.mockReset().mockResolvedValue([])
  getLoginAttempts.mockReset().mockResolvedValue([])
  clearLoginLockout.mockReset()
  api.get.mockReset().mockResolvedValue({ data: {} })
  api.put.mockReset().mockResolvedValue({ data: {} })
  api.post.mockReset()
  act(() => {
    useToastStore.setState({ toasts: [] })
    usePendingDeleteStore.setState({ hidden: new Set() })
    useAuthStore.setState({ user: null, token: null })
  })
})

describe('SettingsPage', () => {
  it('defaults to the Server tab', async () => {
    renderSettingsPage()
    expect(screen.getByText('Server configuration')).toBeInTheDocument()
  })

  it('disables "Send test alert" and shows "Not configured" when no webhook is set', async () => {
    api.get.mockResolvedValue({ data: { webhook_configured: false } })
    renderSettingsPage()

    expect(await screen.findByText('Not configured')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send test alert' })).toBeDisabled()
  })

  it('sends a test alert and shows a success message', async () => {
    api.get.mockResolvedValue({ data: { webhook_configured: true } })
    api.post.mockResolvedValue({ data: { ok: true, status_code: 200 } })
    renderSettingsPage()
    await screen.findByText('Configured')

    await userEvent.click(screen.getByRole('button', { name: 'Send test alert' }))

    expect(api.post).toHaveBeenCalledWith('/settings/test-webhook')
    expect(await screen.findByText('Test alert sent successfully.')).toBeInTheDocument()
  })

  it('shows a readable error message when the test alert fails', async () => {
    api.get.mockResolvedValue({ data: { webhook_configured: true } })
    api.post.mockRejectedValue({ response: { data: { detail: 'Webhook responded with HTTP 404' } } })
    renderSettingsPage()
    await screen.findByText('Configured')

    await userEvent.click(screen.getByRole('button', { name: 'Send test alert' }))

    expect(await screen.findByText('Webhook responded with HTTP 404')).toBeInTheDocument()
  })

  it('shows nothing for login attempts when there is no tracked activity', async () => {
    renderSettingsPage()
    await screen.findByText('Server configuration')

    expect(screen.queryByText('Login attempts')).not.toBeInTheDocument()
  })

  it('shows a locked IP with an Unlock button, and hides Unlock for an unlocked one', async () => {
    getLoginAttempts.mockResolvedValue([
      { ip: '10.0.0.9', attempt_count: 5, locked: true, seconds_remaining: 300 },
      { ip: '10.0.0.5', attempt_count: 2, locked: false, seconds_remaining: null },
    ])
    renderSettingsPage()

    expect(await screen.findByText('10.0.0.9')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.5')).toBeInTheDocument()
    expect(screen.getByText(/locked, unlocks in 5 mins/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Unlock' })).toHaveLength(1)
  })

  it('unlocks a locked IP and refreshes the list', async () => {
    getLoginAttempts.mockResolvedValueOnce([
      { ip: '10.0.0.9', attempt_count: 5, locked: true, seconds_remaining: 300 },
    ]).mockResolvedValueOnce([])
    clearLoginLockout.mockResolvedValue({ ok: true })
    renderSettingsPage()
    await screen.findByText('10.0.0.9')

    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(clearLoginLockout).toHaveBeenCalled()
    expect(clearLoginLockout.mock.calls[0][0]).toBe('10.0.0.9')
    expect(await screen.findByText('Lockout cleared')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Login attempts')).not.toBeInTheDocument())
  })

  it('shows the empty state when there are no users', async () => {
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await screen.findByText('No users found')).toBeInTheDocument()
  })

  it('lists users returned by the API with role and status badges', async () => {
    getUsers.mockResolvedValue([
      { id: 1, username: 'alice', email: 'alice@example.com', role: 'admin', is_active: true },
      { id: 2, username: 'bob', email: null, role: 'viewer', is_active: false },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('No email')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('shows "Never logged in" for a user with no last_login, and a timestamp for one who has', async () => {
    getUsers.mockResolvedValue([
      { id: 1, username: 'alice', email: 'alice@example.com', role: 'admin', is_active: true, last_login: '2026-01-15T10:30:00Z' },
      { id: 2, username: 'bob', email: 'bob@example.com', role: 'viewer', is_active: true, last_login: null },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))

    await screen.findByText('alice')
    expect(screen.getByText('Never logged in')).toBeInTheDocument()
    expect(screen.getByText(/Last login/)).toBeInTheDocument()
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

  it('shows "Inactive" for a deactivated user (regression: badge used to read the nonexistent "active" field)', async () => {
    getUsers.mockResolvedValue([
      { id: 1, username: 'alice', email: 'alice@example.com', role: 'admin', is_active: false },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))

    expect(await screen.findByText('Inactive')).toBeInTheDocument()
  })

  it('edits a user\'s role and active status through the Edit modal', async () => {
    getUsers.mockResolvedValue([
      { id: 2, username: 'op1', email: 'op1@example.com', role: 'operator', is_active: true },
    ])
    updateUser.mockResolvedValue({ id: 2, username: 'op1', role: 'viewer', is_active: false })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByText('Edit op1')).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByDisplayValue('operator'), 'viewer')
    await userEvent.click(screen.getByRole('button', { name: 'Active' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalled())
    expect(updateUser.mock.calls[0]).toEqual([2, { role: 'viewer', is_active: false }])
    expect(await screen.findByText('User updated')).toBeInTheDocument()
  })

  it('only sends a password field when one is actually entered', async () => {
    getUsers.mockResolvedValue([
      { id: 2, username: 'op1', email: 'op1@example.com', role: 'operator', is_active: true },
    ])
    updateUser.mockResolvedValue({})
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateUser).toHaveBeenCalled())
    expect(updateUser.mock.calls[0][1]).not.toHaveProperty('password')
  })

  it('disables role and active controls when editing your own account', async () => {
    act(() => useAuthStore.setState({ user: { username: 'admin1' } }))
    getUsers.mockResolvedValue([
      { id: 1, username: 'admin1', email: 'admin1@example.com', role: 'admin', is_active: true },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Users' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))

    expect(screen.getByDisplayValue('admin')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Active' })).toBeDisabled()
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
    getUsers.mockResolvedValue([{ id: 1, username: 'alice', email: null, role: 'viewer', is_active: true }])
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
    getUsers.mockResolvedValue([{ id: 1, username: 'alice', email: null, role: 'viewer', is_active: true }])
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

  it('exports audit entries as CSV', async () => {
    getAuditLog.mockResolvedValue([
      { id: 1, username: 'admin1', action: 'user.create', target: 'newop', detail: 'role=operator', created_at: '2026-01-15T10:30:00Z' },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Audit Log' }))
    await screen.findByText('newop')

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, headers, rows] = downloadCsv.mock.calls[0]
    expect(filename).toMatch(/^audit-log-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(headers).toEqual(['When', 'Who', 'Action', 'Target', 'Detail'])
    expect(rows).toEqual([['2026-01-15T10:30:00Z', 'admin1', 'Created user', 'newop', 'role=operator']])
  })
})
