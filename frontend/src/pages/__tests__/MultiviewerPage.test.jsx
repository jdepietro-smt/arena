import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import MultiviewerPage from '../MultiviewerPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getMultiviewJobs: vi.fn(),
  stopMultiviewJob: vi.fn(),
  getMultiviewJobLog: vi.fn(),
  getExternalSources: vi.fn(),
  addExternalSource: vi.fn(),
  removeExternalSource: vi.fn(),
  getYoutubeCookiesStatus: vi.fn(),
  uploadYoutubeCookies: vi.fn(),
  removeYoutubeCookies: vi.fn(),
}))

import {
  getStreams, getMultiviewJobs, stopMultiviewJob, getMultiviewJobLog,
  getExternalSources, removeExternalSource,
  getYoutubeCookiesStatus, removeYoutubeCookies,
} from '../../api/client'

function renderMultiviewerPage() {
  const queryClient = createTestQueryClient()
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <MultiviewerPage />
        <ToastStack />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getMultiviewJobs.mockReset().mockResolvedValue([])
  stopMultiviewJob.mockReset()
  getMultiviewJobLog.mockReset().mockResolvedValue({ job_id: 'job1', log: '' })
  act(() => useAuthStore.setState({ user: null, token: null }))
  getExternalSources.mockReset().mockResolvedValue([])
  removeExternalSource.mockReset()
  getYoutubeCookiesStatus.mockReset().mockResolvedValue({ present: false })
  removeYoutubeCookies.mockReset()
  localStorage.clear()
  act(() => useToastStore.setState({ toasts: [] }))
})

describe('MultiviewerPage', () => {
  it('shows a connection-error message instead of the empty state when the streams query fails', async () => {
    getStreams.mockRejectedValue(new Error('network error'))
    renderMultiviewerPage()

    expect(await screen.findByText('Could not load streams. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText('No live streams right now.')).not.toBeInTheDocument()
  })

  it('shows the empty state when there are no live streams', async () => {
    renderMultiviewerPage()
    expect(await screen.findByText('No live streams right now.')).toBeInTheDocument()
  })

  it('shows an error toast when stopping a composite job fails', async () => {
    getMultiviewJobs.mockResolvedValue([
      { job_id: 'job1', paths: ['cam1'], audio_path: null, running: true },
    ])
    stopMultiviewJob.mockRejectedValue({ response: { data: { detail: 'Job not found' } } })
    renderMultiviewerPage()
    await screen.findByRole('button', { name: 'Stop' })

    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(await screen.findByText('Job not found')).toBeInTheDocument()
  })

  it('hides the Log button for a non-admin', async () => {
    getMultiviewJobs.mockResolvedValue([
      { job_id: 'job1', paths: ['cam1'], audio_path: null, running: true },
    ])
    renderMultiviewerPage()
    await screen.findByRole('button', { name: 'Stop' })

    expect(screen.queryByRole('button', { name: 'Log' })).not.toBeInTheDocument()
  })

  it('shows the composite job log for an admin', async () => {
    act(() => useAuthStore.setState({ user: { username: 'admin1', role: 'admin' }, token: 'tok' }))
    getMultiviewJobs.mockResolvedValue([
      { job_id: 'job1', paths: ['cam1'], audio_path: null, running: true },
    ])
    getMultiviewJobLog.mockResolvedValue({ job_id: 'job1', log: 'frame=1 fps=30\nframe=2 fps=30' })
    renderMultiviewerPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Log' }))

    expect(getMultiviewJobLog).toHaveBeenCalledWith('job1')
    expect(await screen.findByText(/frame=1 fps=30/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(/frame=1 fps=30/)).not.toBeInTheDocument()
  })

  it('shows an error toast when removing an external source fails', async () => {
    getExternalSources.mockResolvedValue([
      { name: 'ext1', url: 'srt://x', status: 'live', last_error: null },
    ])
    removeExternalSource.mockRejectedValue({ response: { data: { detail: 'Source in use' } } })
    renderMultiviewerPage()
    await screen.findByRole('button', { name: 'Remove' })

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }))

    expect(await screen.findByText('Source in use')).toBeInTheDocument()
  })

  it('shows an error toast when clearing cookies fails', async () => {
    getYoutubeCookiesStatus.mockResolvedValue({ present: true })
    removeYoutubeCookies.mockRejectedValue({ response: { data: { detail: 'Could not remove file' } } })
    renderMultiviewerPage()

    await userEvent.click(screen.getByText(/Advanced: YouTube cookies/))
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }))

    expect(await screen.findByText('Could not remove file')).toBeInTheDocument()
  })

  it('toggles a YouTube embed pin via keyboard (Enter), not just click', async () => {
    localStorage.setItem('arena-youtube-embeds', JSON.stringify([
      { videoId: 'abc12345678', url: 'https://youtu.be/abc12345678', label: 'My Video' },
    ]))
    renderMultiviewerPage()

    const row = await screen.findByText('My Video')
    const embedRow = row.closest('[role="button"]')
    expect(embedRow).toHaveAttribute('aria-pressed', 'false')

    embedRow.focus()
    await userEvent.keyboard('{Enter}')

    expect(embedRow).toHaveAttribute('aria-pressed', 'true')
  })
})
