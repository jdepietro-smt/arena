import { render, screen } from '@testing-library/react'
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
}))

import {
  getStreams, getStatsSummary, getAlertStatus, getAlertRules, getEvents, getStatsHistory,
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
