import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act } from 'react'
import CompanionPage from '../CompanionPage'
import { useAuthStore } from '../../store/auth'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getAlertStatus: vi.fn(),
}))

import { getStreams, getAlertStatus } from '../../api/client'

function renderCompanionPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/companion']}>
        <Routes>
          <Route path="/companion" element={<CompanionPage />} />
          <Route path="/dashboard" element={<div>Dashboard content</div>} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getAlertStatus.mockReset().mockResolvedValue({ down_streams: [], firing_rule_ids: [], predicted_risks: {} })
  act(() => {
    useAuthStore.setState({ token: 'fake-token', user: { username: 'admin', role: 'admin' } })
  })
})

describe('CompanionPage', () => {
  it('shows the empty state when there are no streams', async () => {
    renderCompanionPage()
    expect(await screen.findByText('No streams connected')).toBeInTheDocument()
  })

  it('shows "All systems normal" when nothing is down or predicted at risk', async () => {
    renderCompanionPage()
    expect(await screen.findByText('All systems normal')).toBeInTheDocument()
  })

  it('renders a big-touch-target row per stream with live metrics', async () => {
    getStreams.mockResolvedValue([
      { path: 'cam1', name: 'Camera 1', ready: true, bitrate_kbps: 4500, rtt_ms: 42, packet_loss_pct: 0.1 },
    ])
    renderCompanionPage()

    expect(await screen.findByText('Camera 1')).toBeInTheDocument()
    expect(screen.getByText('4500')).toBeInTheDocument()
  })

  it('shows a prominent banner when a stream is down', async () => {
    getStreams.mockResolvedValue([{ path: 'cam1', name: 'Camera 1', ready: false }])
    getAlertStatus.mockResolvedValue({ down_streams: ['cam1'], firing_rule_ids: [], predicted_risks: {} })
    renderCompanionPage()

    expect(await screen.findByText(/1.*issue.*need.*attention/)).toBeInTheDocument()
    expect(screen.queryByText('All systems normal')).not.toBeInTheDocument()
  })

  it('shows a predicted-risk banner distinct from the down-stream banner', async () => {
    getAlertStatus.mockResolvedValue({ down_streams: [], firing_rule_ids: [], predicted_risks: { cam1: 'RTT trending up' } })
    renderCompanionPage()

    expect(await screen.findByText(/1.*stream.*trending toward trouble/)).toBeInTheDocument()
  })

  it('has no sidebar navigation — this is the chrome-free view', async () => {
    renderCompanionPage()
    await screen.findByText('ArenaHub Companion')
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('signs out via the header button', async () => {
    renderCompanionPage()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(await screen.findByText('Login page')).toBeInTheDocument()
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('links back to the full dashboard', async () => {
    renderCompanionPage()
    await userEvent.click(screen.getByRole('button', { name: 'Open full dashboard' }))

    expect(await screen.findByText('Dashboard content')).toBeInTheDocument()
  })
})
