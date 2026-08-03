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
}))

import { getRecordings, deleteRecording } from '../../api/client'

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
})
