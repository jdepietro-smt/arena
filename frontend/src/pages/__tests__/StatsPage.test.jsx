import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import StatsPage from '../StatsPage'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getStatsHistory: vi.fn(),
  getStreamUptimeHistory: vi.fn(),
}))

import { getStreams, getStatsHistory, getStreamUptimeHistory } from '../../api/client'

function renderStatsPage(initialPath = '/stats') {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <StatsPage />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getStatsHistory.mockReset().mockResolvedValue([])
  getStreamUptimeHistory.mockReset().mockResolvedValue([])
})

describe('StatsPage', () => {
  it('shows a connection-error message when the streams query fails', async () => {
    getStreams.mockRejectedValue(new Error('network error'))
    renderStatsPage()

    expect(await screen.findByText('Could not load streams. Retrying…')).toBeInTheDocument()
  })

  it('auto-selects the first stream once streams load', async () => {
    getStreams.mockResolvedValue([
      { path: 'cam1', name: 'Camera 1' },
      { path: 'cam2', name: 'Camera 2' },
    ])
    renderStatsPage()

    expect(await screen.findByText('Camera 1')).toBeInTheDocument()
    await waitFor(() => expect(getStatsHistory).toHaveBeenCalledWith('cam1', 60))
  })

  it('does not show the error banner when streams load successfully', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1' }])
    renderStatsPage()

    await screen.findByText('Camera 1')
    expect(screen.queryByText('Could not load streams. Retrying…')).not.toBeInTheDocument()
  })

  it('preselects the stream named in a ?stream= deep link instead of the first one', async () => {
    getStreams.mockResolvedValue([
      { path: 'cam1', name: 'Camera 1' },
      { path: 'cam2', name: 'Camera 2' },
    ])
    renderStatsPage('/stats?stream=cam2')

    await screen.findByRole('option', { name: 'Camera 2' })
    await waitFor(() => expect(getStatsHistory).toHaveBeenCalledWith('cam2', 60))
    expect(screen.getByRole('combobox').value).toBe('cam2')
    expect(getStatsHistory).not.toHaveBeenCalledWith('cam1', 60)
  })

  it('does not fetch or render an uptime heatmap when no stream is selected', async () => {
    renderStatsPage()
    await screen.findByText('No stream selected')

    expect(getStreamUptimeHistory).not.toHaveBeenCalled()
    expect(screen.queryByText(/Uptime — last 30 days/)).not.toBeInTheDocument()
  })

  it('renders the uptime heatmap with 30 day cells once a stream is selected', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1' }])
    getStreamUptimeHistory.mockResolvedValue([
      { date: '2026-01-01', uptime_pct: 100, total_samples: 8640 },
    ])
    renderStatsPage()

    await screen.findByText('Uptime — last 30 days')
    await waitFor(() => expect(getStreamUptimeHistory).toHaveBeenCalledWith('cam1', 30))
  })
})
