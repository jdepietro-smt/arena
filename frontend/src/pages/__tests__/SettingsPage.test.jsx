import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SettingsPage from '../SettingsPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getUsers: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
  default: { get: vi.fn(), put: vi.fn() },
}))

import { getUsers, createUser, deleteUser } from '../../api/client'
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
  api.get.mockReset().mockResolvedValue({ data: {} })
  api.put.mockReset().mockResolvedValue({ data: {} })
  act(() => useToastStore.setState({ toasts: [] }))
})

describe('SettingsPage', () => {
  it('defaults to the Server tab', async () => {
    renderSettingsPage()
    expect(screen.getByText('Server configuration')).toBeInTheDocument()
  })

  it('shows the empty state when there are no users', async () => {
    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: 'Users' }))

    expect(await screen.findByText('No users found')).toBeInTheDocument()
  })

  it('lists users returned by the API with role and status badges', async () => {
    getUsers.mockResolvedValue([
      { id: 1, username: 'alice', email: 'alice@example.com', role: 'admin', active: true },
      { id: 2, username: 'bob', email: null, role: 'viewer', active: false },
    ])
    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: 'Users' }))

    expect(await screen.findByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('No email')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('creates a user through the Add user modal and refreshes the list', async () => {
    createUser.mockResolvedValue({ id: 3, username: 'newop', role: 'operator' })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: 'Users' }))
    await userEvent.click(await screen.findByRole('button', { name: /add user/i }))

    await userEvent.type(screen.getByPlaceholderText('operator1'), 'newop')
    await userEvent.type(screen.getByPlaceholderText('Minimum 8 characters'), 'Password123!')
    await userEvent.click(screen.getByRole('button', { name: 'Create user' }))

    await waitFor(() => {
      expect(createUser).toHaveBeenCalled()
    })
    expect(createUser.mock.calls[0][0]).toEqual({ username: 'newop', password: 'Password123!', role: 'operator' })
    // Modal closes on success.
    await waitFor(() => {
      expect(screen.queryByText('Add user')).not.toBeInTheDocument()
    })
  })

  it('deletes a user after confirming in the dialog, and does nothing if cancelled', async () => {
    getUsers.mockResolvedValue([{ id: 1, username: 'alice', email: null, role: 'viewer', active: true }])
    deleteUser.mockResolvedValue({})
    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: 'Users' }))
    await screen.findByText('alice')

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Remove user "alice"?')).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteUser).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(deleteUser).toHaveBeenCalled())
    expect(deleteUser.mock.calls[0][0]).toBe(1)
    expect(await screen.findByText('User removed')).toBeInTheDocument()
  })

  it('shows a connection-error message instead of the empty state when the users query fails', async () => {
    getUsers.mockRejectedValue(new Error('network error'))
    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: 'Users' }))

    expect(await screen.findByText('Could not load users. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText('No users found')).not.toBeInTheDocument()
  })

  it('shows an error toast when saving recording settings fails', async () => {
    api.put.mockRejectedValue({ response: { data: { detail: 'Disk full' } } })
    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: 'Recording' }))

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
    await userEvent.click(screen.getByRole('button', { name: 'Recording' }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('/mnt/real-recordings')).toBeInTheDocument()
    })
    expect(screen.getByText('250 GB')).toBeInTheDocument()
  })

  it('saves recording settings and shows a confirmation', async () => {
    renderSettingsPage()
    await userEvent.click(screen.getByRole('button', { name: 'Recording' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/settings/recording', {
        output_dir: '/recordings', max_storage_gb: 500, auto_delete: false,
      })
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})
