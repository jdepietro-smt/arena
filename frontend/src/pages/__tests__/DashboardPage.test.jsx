import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardPage from '../DashboardPage'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getStatsSummary: vi.fn(),
  getEvents: vi.fn(),
}))

import { getStreams, getStatsSummary, getEvents } from '../../api/client'

function renderDashboard() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>
  )
}

function stream(overrides = {}) {
  return {
    path: 'cam1', name: 'Camera 1', ready: true, recording: false,
    bitrate_kbps: 4000, readers: 3,
    ...overrides,
  }
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getStatsSummary.mockReset().mockResolvedValue(null)
  getEvents.mockReset().mockResolvedValue([])
})

describe('DashboardPage — empty state', () => {
  it('shows the "no streams" placeholder with the real SRT publish URL', async () => {
    renderDashboard()

    expect(await screen.findByText('No streams connected')).toBeInTheDocument()
    expect(screen.getByText(/srt:\/\/.*:8890\?streamid=publish:mystream/)).toBeInTheDocument()
  })
})

describe('DashboardPage — stat cards derived from streams', () => {
  it('derives active-stream count, bitrate, recordings, and viewers from raw stream data when summary is absent', async () => {
    getStreams.mockResolvedValue([
      stream({ path: 'cam1', name: 'Camera 1', ready: true, recording: true, bitrate_kbps: 4000, readers: 3 }),
      stream({ path: 'cam2', name: 'Camera 2', ready: true, recording: false, bitrate_kbps: 2000, readers: 1 }),
      stream({ path: 'cam3', name: 'Camera 3', ready: false, recording: false, bitrate_kbps: 0, readers: 0 }),
    ])
    renderDashboard()

    await screen.findByText('Camera 1')

    const statValue = (label) => within(screen.getByText(label).closest('.group')).getByText((_, el) => el.tagName === 'P' && el.className.includes('font-mono'))

    // 2 of 3 streams are ready=true.
    expect(statValue('Active Streams')).toHaveTextContent('2')
    // (4000+2000)/1000 = 6.0 Mbps.
    expect(statValue('Total Bitrate')).toHaveTextContent('6.0')
    // 1 stream recording.
    expect(statValue('Recordings')).toHaveTextContent('1')
    // 3+1+0 = 4 viewers.
    expect(statValue('Connected Viewers')).toHaveTextContent('4')
  })

  it('prefers the stats-summary endpoint values over derived stream totals when present', async () => {
    getStreams.mockResolvedValue([stream({ bitrate_kbps: 4000, readers: 3, recording: false })])
    getStatsSummary.mockResolvedValue({
      total_bitrate_kbps: 99000, recordings_active: 7, total_readers: 42,
    })
    renderDashboard()
    await screen.findByText('Camera 1')

    const statValue = (label) => within(screen.getByText(label).closest('.group')).getByText((_, el) => el.tagName === 'P' && el.className.includes('font-mono'))

    expect(statValue('Total Bitrate')).toHaveTextContent('99.0')
    expect(statValue('Recordings')).toHaveTextContent('7')
    expect(statValue('Connected Viewers')).toHaveTextContent('42')
  })
})

describe('DashboardPage — stream grid', () => {
  it('renders a StreamCard for every stream returned by the API', async () => {
    getStreams.mockResolvedValue([
      stream({ path: 'cam1', name: 'Studio A' }),
      stream({ path: 'cam2', name: 'Studio B' }),
    ])
    renderDashboard()

    expect(await screen.findByText('Studio A')).toBeInTheDocument()
    expect(screen.getByText('Studio B')).toBeInTheDocument()
  })
})

describe('DashboardPage — Recent Events sidebar', () => {
  it('shows the empty state when there are no events', async () => {
    renderDashboard()
    expect(await screen.findByText('No events yet')).toBeInTheDocument()
  })

  it('renders events with their stream path and a relative time', async () => {
    getEvents.mockResolvedValue([
      { id: 1, type: 'stream_connected', stream_path: 'cam1', message: null, created_at: new Date().toISOString() },
    ])
    renderDashboard()

    expect(await screen.findByText('cam1')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
  })

  it('opens the All Events modal showing every event, not just the sidebar\'s slice of 8', async () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: i, type: 'stream_connected', stream_path: `cam${i}`, message: null,
      created_at: new Date().toISOString(),
    }))
    getEvents.mockResolvedValue(events)
    renderDashboard()
    await screen.findByText('cam0')

    // Sidebar only shows 8.
    expect(screen.queryByText('cam9')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'View all events' }))

    const modal = screen.getByText('All Events').closest('div').parentElement
    expect(within(modal).getByText('cam9')).toBeInTheDocument()
  })
})
