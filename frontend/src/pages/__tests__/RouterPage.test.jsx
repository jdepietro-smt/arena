import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RouterPage from '../RouterPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { usePendingDeleteStore } from '../../store/pendingDelete'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getRoutes: vi.fn(),
  createRoute: vi.fn(),
  activateRoute: vi.fn(),
  deactivateRoute: vi.fn(),
  failBackRoute: vi.fn(),
  deleteRoute: vi.fn(),
}))

import {
  getStreams, getRoutes, createRoute, activateRoute, deactivateRoute, failBackRoute, deleteRoute,
} from '../../api/client'

function renderRouterPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterPage />
      <ToastStack />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getRoutes.mockReset().mockResolvedValue([])
  createRoute.mockReset()
  activateRoute.mockReset()
  deactivateRoute.mockReset()
  failBackRoute.mockReset()
  deleteRoute.mockReset()
  act(() => {
    useToastStore.setState({ toasts: [] })
    usePendingDeleteStore.setState({ hidden: new Set() })
    useAuthStore.setState({ user: null, token: null })
  })
})

describe('RouterPage — routing matrix', () => {
  it('shows the empty state when there are no streams', async () => {
    renderRouterPage()
    expect(await screen.findByText('No active streams')).toBeInTheDocument()
  })

  it('renders one matrix row per stream and the three default destinations', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1' }])
    renderRouterPage()

    await screen.findByText('Camera 1')
    expect(screen.getByText('SRT Primary')).toBeInTheDocument()
    expect(screen.getByText('HLS CDN')).toBeInTheDocument()
    expect(screen.getByText('RTMP Backup')).toBeInTheDocument()
  })

  it('toggles a matrix cell between routed and unrouted on click', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1' }])
    renderRouterPage()
    await screen.findByText('Camera 1')

    const [firstCell] = screen.getAllByTitle('Click to route')
    expect(firstCell).toHaveAttribute('aria-pressed', 'false')
    expect(firstCell).toHaveAccessibleName('Route Camera 1 to SRT Primary')

    await userEvent.click(firstCell)

    expect(screen.getByTitle('Click to unroute')).toBeInTheDocument()
    expect(firstCell).toHaveAttribute('aria-pressed', 'true')
  })

  it('adds a new destination column via the Add destination modal', async () => {
    renderRouterPage()
    await userEvent.click(screen.getByTitle('Add destination'))

    await userEvent.type(screen.getByPlaceholderText('Label (e.g. CDN Primary)'), 'Backup CDN')
    await userEvent.type(screen.getByPlaceholderText('srt://host:port'), 'srt://backup.example.com:9000')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByText('Backup CDN')).toBeInTheDocument()
    expect(screen.queryByText('Add destination')).not.toBeInTheDocument()
  })

  it('does not add a destination if the label or URL is missing', async () => {
    renderRouterPage()
    await userEvent.click(screen.getByTitle('Add destination'))

    await userEvent.type(screen.getByPlaceholderText('Label (e.g. CDN Primary)'), 'Incomplete')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument()
    // Modal is still open since onAdd/onClose weren't called.
    expect(screen.getByText('Add destination')).toBeInTheDocument()
  })
})

describe('RouterPage — active routes', () => {
  it('shows the empty state when there are no routes', async () => {
    renderRouterPage()
    expect(await screen.findByText('No routes configured')).toBeInTheDocument()
  })

  it('lists routes with active/inactive badges', async () => {
    getRoutes.mockResolvedValue([
      { id: 1, name: 'Studio A -> CDN', source_path: 'cam1', destinations: [{ url: 'srt://cdn:9000' }], is_active: true },
      { id: 2, name: 'Studio B -> Backup', source_path: 'cam2', destinations: [{ url: 'srt://backup:9000' }], is_active: false },
    ])
    renderRouterPage()

    expect(await screen.findByText('Studio A -> CDN')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('creates a route: calls createRoute then activateRoute, then closes the modal', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1' }])
    createRoute.mockResolvedValue({ id: 5 })
    activateRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Camera 1')

    await userEvent.click(screen.getByRole('button', { name: /new route/i }))
    await userEvent.type(screen.getByPlaceholderText('Studio A → CDN'), 'My New Route')
    await userEvent.selectOptions(screen.getByDisplayValue('Select a stream…'), 'cam1')
    await userEvent.type(screen.getByPlaceholderText('srt://10.0.0.1:9000'), 'srt://dest.example.com:9000')
    await userEvent.click(screen.getByRole('button', { name: 'Create route' }))

    await waitFor(() => expect(createRoute).toHaveBeenCalled())
    expect(createRoute.mock.calls[0][0]).toEqual({
      name: 'My New Route', source_path: 'cam1',
      destinations: [{ type: 'srt', url: 'srt://dest.example.com:9000' }],
      backup_source_path: null,
    })
    await waitFor(() => expect(activateRoute).toHaveBeenCalledWith(5))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'New route' })).not.toBeInTheDocument()
    })
    expect(await screen.findByText('Route created and activated')).toBeInTheDocument()
  })

  it('creates a route with a backup source for automatic failover', async () => {
    getStreams.mockResolvedValue([
      { path: 'cam1', name: 'Camera 1' },
      { path: 'cam1-backup', name: 'Camera 1 Backup' },
    ])
    createRoute.mockResolvedValue({ id: 6 })
    activateRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Camera 1')

    await userEvent.click(screen.getByRole('button', { name: /new route/i }))
    await userEvent.type(screen.getByPlaceholderText('Studio A → CDN'), 'My New Route')
    await userEvent.selectOptions(screen.getByDisplayValue('Select a stream…'), 'cam1')
    await userEvent.selectOptions(screen.getByDisplayValue('No backup — alert only'), 'cam1-backup')
    await userEvent.type(screen.getByPlaceholderText('srt://10.0.0.1:9000'), 'srt://dest.example.com:9000')
    await userEvent.click(screen.getByRole('button', { name: 'Create route' }))

    await waitFor(() => expect(createRoute).toHaveBeenCalled())
    expect(createRoute.mock.calls[0][0].backup_source_path).toBe('cam1-backup')
  })

  it('pauses an active route by calling deactivateRoute', async () => {
    getRoutes.mockResolvedValue([{ id: 1, name: 'Route 1', source_path: 'cam1', destinations: [{ url: 'srt://x' }], is_active: true }])
    deactivateRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Route 1')

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(deactivateRoute).toHaveBeenCalledWith(1))
    expect(activateRoute).not.toHaveBeenCalled()
    expect(await screen.findByText('Route paused')).toBeInTheDocument()
  })

  it('activates an inactive route by calling activateRoute', async () => {
    getRoutes.mockResolvedValue([{ id: 2, name: 'Route 2', source_path: 'cam2', destinations: [{ url: 'srt://y' }], is_active: false }])
    activateRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Route 2')

    await userEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(activateRoute).toHaveBeenCalledWith(2))
  })

  it('shows a "Failed over" badge and hides the Fail back button for a non-admin', async () => {
    getRoutes.mockResolvedValue([{
      id: 1, name: 'Route 1', source_path: 'cam1', backup_source_path: 'cam1-backup',
      destinations: [{ url: 'srt://x' }], is_active: true, failed_over: true,
    }])
    renderRouterPage()

    expect(await screen.findByText('Failed over')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /fail back/i })).not.toBeInTheDocument()
  })

  it('lets an admin fail a route back to its primary source', async () => {
    act(() => useAuthStore.setState({ user: { username: 'admin1', role: 'admin' }, token: 'tok' }))
    getRoutes.mockResolvedValue([{
      id: 1, name: 'Route 1', source_path: 'cam1', backup_source_path: 'cam1-backup',
      destinations: [{ url: 'srt://x' }], is_active: true, failed_over: true,
    }])
    failBackRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Failed over')

    await userEvent.click(screen.getByRole('button', { name: /fail back/i }))

    await waitFor(() => expect(failBackRoute).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Route failed back to primary source')).toBeInTheDocument()
  })

  it('shows an error toast when failing back a route fails', async () => {
    act(() => useAuthStore.setState({ user: { username: 'admin1', role: 'admin' }, token: 'tok' }))
    getRoutes.mockResolvedValue([{
      id: 1, name: 'Route 1', source_path: 'cam1', backup_source_path: 'cam1-backup',
      destinations: [{ url: 'srt://x' }], is_active: true, failed_over: true,
    }])
    failBackRoute.mockRejectedValue({ response: { data: { detail: 'Route manager unavailable' } } })
    renderRouterPage()
    await screen.findByText('Failed over')

    await userEvent.click(screen.getByRole('button', { name: /fail back/i }))

    expect(await screen.findByText('Route manager unavailable')).toBeInTheDocument()
  })

  it('hides the route immediately on delete and only calls the API after the undo grace period', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getRoutes.mockResolvedValue([{ id: 3, name: 'Route 3', source_path: 'cam3', destinations: [{ url: 'srt://z' }], is_active: false }])
    deleteRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Route 3')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.queryByText('Route 3')).not.toBeInTheDocument()
    expect(screen.getByText('Route deleted')).toBeInTheDocument()
    expect(deleteRoute).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(6001))
    expect(deleteRoute).toHaveBeenCalledWith(3)
    vi.useRealTimers()
  })

  it('undoing a route delete restores it and never calls the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getRoutes.mockResolvedValue([{ id: 3, name: 'Route 3', source_path: 'cam3', destinations: [{ url: 'srt://z' }], is_active: false }])
    deleteRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Route 3')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByText('Route 3')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Route 3')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(10000))
    expect(deleteRoute).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('shows an error toast when deleting a route fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getRoutes.mockResolvedValue([{ id: 4, name: 'Route 4', source_path: 'cam4', destinations: [{ url: 'srt://w' }], is_active: false }])
    deleteRoute.mockRejectedValue({ response: { data: { detail: 'Route is in use' } } })
    renderRouterPage()
    await screen.findByText('Route 4')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => vi.advanceTimersByTime(6001))

    expect(screen.getByText('Route is in use')).toBeInTheDocument()
    expect(screen.getByText('Route 4')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows a connection-error message instead of the empty state when the routes query fails', async () => {
    getRoutes.mockRejectedValue(new Error('network error'))
    renderRouterPage()

    expect(await screen.findByText('Could not load routes. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText('No routes configured')).not.toBeInTheDocument()
  })
})
