import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import RecordingsPage from '../RecordingsPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
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
  act(() => useToastStore.setState({ toasts: [] }))
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

  it('deletes a recording after confirming in the dialog, and does nothing if cancelled', async () => {
    getRecordings.mockResolvedValue([recording()])
    deleteRecording.mockResolvedValue({})
    renderRecordingsPage()
    await screen.findByText('cam1_20260101.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Delete "cam1_20260101.mp4"/)).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteRecording).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteRecording).toHaveBeenCalledWith(1))
    expect(await screen.findByText('Recording deleted')).toBeInTheDocument()
  })

  it('shows an error toast when deleting a recording fails', async () => {
    getRecordings.mockResolvedValue([recording()])
    deleteRecording.mockRejectedValue({ response: { data: { detail: 'File is locked' } } })
    renderRecordingsPage()
    await screen.findByText('cam1_20260101.mp4')

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('File is locked')).toBeInTheDocument()
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
