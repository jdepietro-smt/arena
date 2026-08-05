import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import OverviewPage from '../OverviewPage'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getStatsSummary: vi.fn(),
  getAlertStatus: vi.fn(),
  getAlertRules: vi.fn(),
  getEvents: vi.fn(),
  getStatsHistory: vi.fn(),
  getFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  getStreamUptimeHistory: vi.fn(),
}))

import {
  getStreams, getStatsSummary, getAlertStatus, getAlertRules, getEvents, getStatsHistory,
  getFavorites, addFavorite, removeFavorite, getStreamUptimeHistory,
} from '../../api/client'

function renderOverviewPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <OverviewPage />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getStatsSummary.mockReset().mockResolvedValue({ total_bitrate_kbps: 0, recordings_active: 0, total_readers: 0 })
  getAlertStatus.mockReset().mockResolvedValue({ down_streams: [], firing_rule_ids: [] })
  getAlertRules.mockReset().mockResolvedValue([])
  getEvents.mockReset().mockResolvedValue([])
  getStatsHistory.mockReset().mockResolvedValue([])
  getFavorites.mockReset().mockResolvedValue([])
  addFavorite.mockReset().mockResolvedValue({})
  removeFavorite.mockReset().mockResolvedValue({})
  getStreamUptimeHistory.mockReset().mockResolvedValue([])
})

describe('OverviewPage', () => {
  it('shows the empty state when there are no streams', async () => {
    renderOverviewPage()
    expect(await screen.findByText('No streams connected')).toBeInTheDocument()
  })

  it('shows "All systems normal" when nothing is down and no rules are firing', async () => {
    renderOverviewPage()
    expect(await screen.findByText('All systems normal')).toBeInTheDocument()
  })

  it('renders a health tile per stream with its live metrics', async () => {
    getStreams.mockResolvedValue([
      { path: 'cam1', name: 'Camera 1', ready: true, bitrate_kbps: 4500, rtt_ms: 42, packet_loss_pct: 0.1, readers: 3 },
    ])
    renderOverviewPage()

    expect(await screen.findByText('Camera 1')).toBeInTheDocument()
    expect(screen.getByText('4500')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows no uptime badge when there is not yet enough uptime history', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1', ready: true }])
    renderOverviewPage()

    await screen.findByText('Camera 1')
    expect(screen.queryByText(/7d/)).not.toBeInTheDocument()
  })

  it('shows a weighted-average 7-day uptime badge, colored by threshold', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1', ready: true }])
    getStreamUptimeHistory.mockResolvedValue([
      { date: '2026-01-01', uptime_pct: 100, total_samples: 100 },
      { date: '2026-01-02', uptime_pct: 90, total_samples: 100 },
    ])
    renderOverviewPage()

    const badge = await screen.findByText('95.0% · 7d')
    expect(badge).toHaveClass('text-amber-400')
  })

  it('pins a stream via its star button', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1', ready: true }])
    renderOverviewPage()
    await screen.findByText('Camera 1')

    await userEvent.click(screen.getByRole('button', { name: 'Pin Camera 1' }))

    expect(addFavorite).toHaveBeenCalled()
    expect(addFavorite.mock.calls[0][0]).toBe('cam1')
  })

  it('sorts a favorited stream first even though it was returned second', async () => {
    getFavorites.mockResolvedValue(['cam2'])
    getStreams.mockResolvedValue([
      { path: 'cam1', name: 'Camera 1', ready: true },
      { path: 'cam2', name: 'Camera 2', ready: true },
    ])
    renderOverviewPage()
    await screen.findByText('Camera 2')

    const tiles = screen.getAllByText(/^Camera [12]$/)
    expect(tiles[0]).toHaveTextContent('Camera 2')
    expect(tiles[1]).toHaveTextContent('Camera 1')
  })

  it('shows an offline tile without metrics for a stream that is not ready', async () => {
    getStreams.mockResolvedValue([{ path: 'cam2', name: 'Camera 2', ready: false }])
    renderOverviewPage()

    expect(await screen.findByText('Camera 2')).toBeInTheDocument()
    expect(screen.getByText('Offline — no telemetry')).toBeInTheDocument()
  })

  it('surfaces a down stream and a firing rule in the alerts panel', async () => {
    getAlertStatus.mockResolvedValue({ down_streams: ['cam1'], firing_rule_ids: [7] })
    getAlertRules.mockResolvedValue([
      { id: 7, stream_path: 'cam2', metric: 'rtt', operator: 'gt', threshold: 300, is_active: true },
    ])
    renderOverviewPage()

    expect(await screen.findByText(/is down/)).toBeInTheDocument()
    expect(screen.getByText('cam2')).toBeInTheDocument()
    expect(screen.queryByText('All systems normal')).not.toBeInTheDocument()
  })

  it('shows a predicted-risk section separately from the firing-alerts panel', async () => {
    getAlertStatus.mockResolvedValue({
      down_streams: [],
      firing_rule_ids: [],
      predicted_risks: { cam3: 'Bitrate collapsing — projected 400kbps vs a recent average of 5000kbps' },
    })
    renderOverviewPage()

    expect(await screen.findByText('Predicted Risk')).toBeInTheDocument()
    expect(screen.getByText('cam3')).toBeInTheDocument()
    expect(screen.getByText('All systems normal')).toBeInTheDocument()
  })

  it('renders recent events with a relative timestamp', async () => {
    getEvents.mockResolvedValue([
      { id: 1, type: 'stream_connected', stream_path: 'cam1', message: 'Connected', created_at: new Date().toISOString() },
    ])
    renderOverviewPage()

    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })
})
