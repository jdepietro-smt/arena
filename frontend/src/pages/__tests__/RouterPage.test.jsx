import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RouterPage from '../RouterPage'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getRoutes: vi.fn(),
  createRoute: vi.fn(),
  activateRoute: vi.fn(),
  deactivateRoute: vi.fn(),
  deleteRoute: vi.fn(),
}))

import {
  getStreams, getRoutes, createRoute, activateRoute, deactivateRoute, deleteRoute,
} from '../../api/client'

function renderRouterPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getRoutes.mockReset().mockResolvedValue([])
  createRoute.mockReset()
  activateRoute.mockReset()
  deactivateRoute.mockReset()
  deleteRoute.mockReset()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    await userEvent.click(firstCell)

    expect(screen.getByTitle('Click to unroute')).toBeInTheDocument()
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
      { id: 1, name: 'Studio A -> CDN', source_path: 'cam1', dest_url: 'srt://cdn:9000', active: true },
      { id: 2, name: 'Studio B -> Backup', source_path: 'cam2', dest_url: 'srt://backup:9000', active: false },
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
      name: 'My New Route', source_path: 'cam1', dest_type: 'SRT Out', dest_url: 'srt://dest.example.com:9000',
    })
    await waitFor(() => expect(activateRoute).toHaveBeenCalledWith(5))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'New route' })).not.toBeInTheDocument()
    })
  })

  it('pauses an active route by calling deactivateRoute', async () => {
    getRoutes.mockResolvedValue([{ id: 1, name: 'Route 1', source_path: 'cam1', dest_url: 'srt://x', active: true }])
    deactivateRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Route 1')

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))

    await waitFor(() => expect(deactivateRoute).toHaveBeenCalledWith(1))
    expect(activateRoute).not.toHaveBeenCalled()
  })

  it('activates an inactive route by calling activateRoute', async () => {
    getRoutes.mockResolvedValue([{ id: 2, name: 'Route 2', source_path: 'cam2', dest_url: 'srt://y', active: false }])
    activateRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Route 2')

    await userEvent.click(screen.getByRole('button', { name: 'Activate' }))

    await waitFor(() => expect(activateRoute).toHaveBeenCalledWith(2))
  })

  it('deletes a route after confirming, and does nothing if declined', async () => {
    getRoutes.mockResolvedValue([{ id: 3, name: 'Route 3', source_path: 'cam3', dest_url: 'srt://z', active: false }])
    deleteRoute.mockResolvedValue({})
    renderRouterPage()
    await screen.findByText('Route 3')

    window.confirm.mockReturnValueOnce(false)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(deleteRoute).not.toHaveBeenCalled()

    window.confirm.mockReturnValueOnce(true)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteRoute).toHaveBeenCalledWith(3))
  })
})
