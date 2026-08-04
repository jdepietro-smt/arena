import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RecordingsPage from '../RecordingsPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { usePendingDeleteStore } from '../../store/pendingDelete'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getRecordings: vi.fn(),
  deleteRecording: vi.fn(),
  fetchRecordingBlobUrl: vi.fn(),
  getRecordingStreamUrl: vi.fn(() => '/api/recordings/1/stream'),
  getRecordingThumbnailUrl: vi.fn(() => '/api/recordings/1/thumbnail'),
  getStorageForecast: vi.fn(),
  default: { get: vi.fn() },
}))

import { getRecordings, deleteRecording, getStorageForecast } from '../../api/client'
import api from '../../api/client'

vi.mock('../../utils/csv', () => ({ downloadCsv: vi.fn() }))
import { downloadCsv } from '../../utils/csv'

function renderRecordingsPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <RecordingsPage />
      <ToastStack />
    </QueryClientProvider>
  )
}

function recording(overrides = {}) {
  return {
    id: 1, filename: 'cam1_20260101.mp4', stream_name: 'cam1',
    status: 'complete', duration_seconds: 90, size_bytes: 5_000_000,
    started_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  getRecordings.mockReset().mockResolvedValue([])
  deleteRecording.mockReset()
  api.get.mockReset().mockResolvedValue({ data: null })
  getStorageForecast.mockReset().mockResolvedValue({ available: false })
  act(() => {
    useToastStore.setState({ toasts: [] })
    usePendingDeleteStore.setState({ hidden: new Set() })
  })
})

describe('RecordingsPage', () => {
  it('shows the empty state when there are no recordings', async () => {
    renderRecordingsPage()
    expect(await screen.findByText('No recordings yet')).toBeInTheDocument()
  })

  it('lists recordings with their filename', async () => {
    getRecordings.mockResolvedValue([recording({ filename: 'studio-a.mp4' })])
    renderRecordingsPage()
    expect(await screen.findByText('studio-a.mp4')).toBeInTheDocument()
  })

  it('renders a thumbnail image for completed recordings but not for active ones', async () => {
    getRecordings.mockResolvedValue([
      recording({ id: 1, filename: 'studio-a.mp4', status: 'complete' }),
      recording({ id: 2, filename: 'studio-b.mp4', status: 'recording', duration_seconds: null }),
    ])
    renderRecordingsPage()
    await screen.findByText('studio-a.mp4')

    const images = screen.getAllByRole('img')
    expect(images).toHaveLength(1)
    expect(images[0]).toHaveAttribute('src', '/api/recordings/1/thumbnail')
  })

  it('falls back to a placeholder icon when the thumbnail fails to load', async () => {
    getRecordings.mockResolvedValue([recording({ filename: 'studio-a.mp4' })])
    renderRecordingsPage()
    const img = await screen.findByRole('img')

    act(() => { img.dispatchEvent(new Event('error')) })

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('shows a connection-error message instead of the empty state when the query fails', async () => {
    getRecordings.mockRejectedValue(new Error('network error'))
    renderRecordingsPage()

    expect(await screen.findByText('Could not load recordings. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText('No recordings yet')).not.toBeInTheDocument()
  })

  it('hides the recording immediately on delete and only calls the API after the undo grace period', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getRecordings.mockResolvedValue([recording()])
    deleteRecording.mockResolvedValue({})
    renderRecordingsPage()
    await screen.findByText('cam1_20260101.mp4')

    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.queryByText('cam1_20260101.mp4')).not.toBeInTheDocument()
    expect(screen.getByText('Recording deleted')).toBeInTheDocument()
    expect(deleteRecording).not.toHaveBeenCalled()

    await act(async () => vi.advanceTimersByTime(6001))

    expect(deleteRecording).toHaveBeenCalledWith(1)
    vi.useRealTimers()
  })

  it('undoing a delete restores the recording and never calls the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getRecordings.mockResolvedValue([recording()])
    deleteRecording.mockResolvedValue({})
    renderRecordingsPage()
    await screen.findByText('cam1_20260101.mp4')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByText('cam1_20260101.mp4')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('cam1_20260101.mp4')).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTime(10000))
    expect(deleteRecording).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('shows an error toast and restores the recording if the delete fails after the grace period', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ delay: null })
    getRecordings.mockResolvedValue([recording()])
    deleteRecording.mockRejectedValue({ response: { data: { detail: 'File is locked' } } })
    renderRecordingsPage()
    await screen.findByText('cam1_20260101.mp4')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => vi.advanceTimersByTime(6001))

    expect(screen.getByText('File is locked')).toBeInTheDocument()
    expect(screen.getByText('cam1_20260101.mp4')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('filters recordings by search', async () => {
    getRecordings.mockResolvedValue([
      recording({ id: 1, filename: 'studio-a.mp4', stream_name: 'cam1' }),
      recording({ id: 2, filename: 'studio-b.mp4', stream_name: 'cam2' }),
    ])
    renderRecordingsPage()
    await screen.findByText('studio-a.mp4')

    await userEvent.type(screen.getByPlaceholderText('Search recordings…'), 'studio-a')

    expect(screen.getByText('studio-a.mp4')).toBeInTheDocument()
    expect(screen.queryByText('studio-b.mp4')).not.toBeInTheDocument()
  })

  it('does not show an Export CSV button when there are no recordings', async () => {
    renderRecordingsPage()
    await screen.findByText('No recordings yet')

    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument()
  })

  it('exports the visible recordings as CSV', async () => {
    getRecordings.mockResolvedValue([recording()])
    renderRecordingsPage()
    await screen.findByText('cam1_20260101.mp4')

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }))

    expect(downloadCsv).toHaveBeenCalledTimes(1)
    const [filename, headers, rows] = downloadCsv.mock.calls[0]
    expect(filename).toMatch(/^recordings-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(headers).toEqual(['Filename', 'Stream', 'Status', 'Duration (s)', 'Size (bytes)', 'Started at'])
    expect(rows).toEqual([['cam1_20260101.mp4', 'cam1', 'complete', 90, 5_000_000, '2026-01-01T00:00:00Z']])
  })

  it('does not show a storage bar when there is no recording config', async () => {
    api.get.mockResolvedValue({ data: null })
    getRecordings.mockResolvedValue([recording()])
    renderRecordingsPage()
    await screen.findByText('cam1_20260101.mp4')

    expect(screen.queryByText('Storage used')).not.toBeInTheDocument()
  })

  it('shows storage usage as a healthy (emerald) bar well under the limit', async () => {
    api.get.mockResolvedValue({ data: { max_storage_gb: 500, auto_delete: false } })
    getRecordings.mockResolvedValue([recording({ size_bytes: 5_000_000_000 })]) // 5 GB of 500 GB = 1%
    renderRecordingsPage()

    expect(await screen.findByText('Storage used')).toBeInTheDocument()
    expect(screen.getByText('5.0 GB of 500 GB (1%)')).toBeInTheDocument()
    expect(screen.queryByText(/Storage nearly full/)).not.toBeInTheDocument()
  })

  it('shows a near-full warning once usage crosses 90%, phrased around auto-delete being on', async () => {
    api.get.mockResolvedValue({ data: { max_storage_gb: 100, auto_delete: true } })
    getRecordings.mockResolvedValue([recording({ size_bytes: 95_000_000_000 })]) // 95 of 100 GB = 95%
    renderRecordingsPage()

    expect(await screen.findByText('95.0 GB of 100 GB (95%)')).toBeInTheDocument()
    expect(screen.getByText(/oldest recordings will be deleted automatically/)).toBeInTheDocument()
  })

  it('phrases the near-full warning around failures when auto-delete is off', async () => {
    api.get.mockResolvedValue({ data: { max_storage_gb: 100, auto_delete: false } })
    getRecordings.mockResolvedValue([recording({ size_bytes: 95_000_000_000 })])
    renderRecordingsPage()

    expect(await screen.findByText(/new recordings may fail/)).toBeInTheDocument()
  })

  it('shows a growth forecast when auto-delete is off and a trend is available', async () => {
    api.get.mockResolvedValue({ data: { max_storage_gb: 500, auto_delete: false } })
    getStorageForecast.mockResolvedValue({ available: true, trend_gb_per_day: 2.5, days_until_full: 12, current_gb: 30 })
    getRecordings.mockResolvedValue([recording({ size_bytes: 5_000_000_000 })])
    renderRecordingsPage()

    expect(await screen.findByText(/Growing ~2\.5 GB\/day/)).toBeInTheDocument()
    expect(screen.getByText(/fills up in 12 days/)).toBeInTheDocument()
  })

  it('does not show a forecast when auto-delete is on, even if a trend is available', async () => {
    api.get.mockResolvedValue({ data: { max_storage_gb: 500, auto_delete: true } })
    getStorageForecast.mockResolvedValue({ available: true, trend_gb_per_day: 2.5, days_until_full: 12, current_gb: 30 })
    getRecordings.mockResolvedValue([recording({ size_bytes: 5_000_000_000 })])
    renderRecordingsPage()
    await screen.findByText('Storage used')

    expect(getStorageForecast).not.toHaveBeenCalled()
    expect(screen.queryByText(/Growing ~/)).not.toBeInTheDocument()
  })

  it('does not show a forecast when there is not enough history yet', async () => {
    api.get.mockResolvedValue({ data: { max_storage_gb: 500, auto_delete: false } })
    getStorageForecast.mockResolvedValue({ available: false })
    getRecordings.mockResolvedValue([recording({ size_bytes: 5_000_000_000 })])
    renderRecordingsPage()

    await screen.findByText('Storage used')
    expect(screen.queryByText(/Growing ~/)).not.toBeInTheDocument()
  })
})
