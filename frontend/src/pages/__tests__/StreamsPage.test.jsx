import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import StreamsPage from '../StreamsPage'
import ToastStack from '../../components/ui/Toast'
import { useToastStore } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { createTestQueryClient } from '../../test/testQueryClient'

vi.mock('../../api/client', () => ({
  getStreams: vi.fn(),
  getPresets: vi.fn(),
  savePreset: vi.fn(),
  deletePreset: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  getPreviewUrls: vi.fn(),
  getFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
  getQcStatus: vi.fn(),
  enableQc: vi.fn(),
  disableQc: vi.fn(),
}))

import {
  getStreams, getPresets, savePreset, deletePreset,
  startRecording, stopRecording, getPreviewUrls,
  getFavorites, addFavorite, removeFavorite,
  getQcStatus, enableQc, disableQc,
} from '../../api/client'

function renderStreamsPage() {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>
      <StreamsPage />
      <ToastStack />
    </QueryClientProvider>
  )
}

function stream(overrides = {}) {
  return {
    publisher_id: 'cam1', name: 'Camera 1', ready: true, recording: false,
    bitrate_kbps: 5000, readers: 2, uptime_seconds: 125, protocol: 'SRT',
    ...overrides,
  }
}

beforeEach(() => {
  getStreams.mockReset().mockResolvedValue([])
  getPresets.mockReset().mockResolvedValue([])
  savePreset.mockReset()
  deletePreset.mockReset()
  startRecording.mockReset()
  stopRecording.mockReset()
  getPreviewUrls.mockReset().mockResolvedValue({ srt_url: 'srt://x', hls_url: '/hls/x', webrtc_url: '/watch/x' })
  getFavorites.mockReset().mockResolvedValue([])
  addFavorite.mockReset().mockResolvedValue({})
  removeFavorite.mockReset().mockResolvedValue({})
  getQcStatus.mockReset().mockResolvedValue({ monitored_paths: [], active_issues: [] })
  enableQc.mockReset().mockResolvedValue({})
  disableQc.mockReset().mockResolvedValue({})
  act(() => {
    useToastStore.setState({ toasts: [] })
    useAuthStore.setState({ user: null, token: null })
  })
})

describe('StreamsPage — Live Streams tab', () => {
  it('shows the empty state when there are no streams', async () => {
    renderStreamsPage()
    expect(await screen.findByText('No streams connected')).toBeInTheDocument()
  })

  it('renders LIVE/OFFLINE badges and REC badge based on stream state', async () => {
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'live1', name: 'Live Cam', ready: true, recording: true }),
      stream({ publisher_id: 'off1', name: 'Offline Cam', ready: false, recording: false }),
    ])
    renderStreamsPage()

    await screen.findByText('Live Cam')
    const liveRow = screen.getByText('Live Cam').closest('tr')
    expect(within(liveRow).getByText('LIVE')).toBeInTheDocument()
    expect(within(liveRow).getByText('REC')).toBeInTheDocument()

    const offRow = screen.getByText('Offline Cam').closest('tr')
    expect(within(offRow).getByText('OFFLINE')).toBeInTheDocument()
    expect(within(offRow).queryByText('REC')).not.toBeInTheDocument()
  })

  it('filters streams by name via the search box', async () => {
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'cam1', name: 'Studio A' }),
      stream({ publisher_id: 'cam2', name: 'Studio B' }),
    ])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.type(screen.getByPlaceholderText('Search streams...'), 'Studio A')

    expect(screen.getByText('Studio A')).toBeInTheDocument()
    expect(screen.queryByText('Studio B')).not.toBeInTheDocument()
  })

  it('shows a no-match message when the search filters out every stream', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', name: 'Studio A' })])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.type(screen.getByPlaceholderText('Search streams...'), 'nonexistent')

    expect(await screen.findByText('No streams match your search')).toBeInTheDocument()
  })

  it('converts bitrate from kbps to Mbps', async () => {
    getStreams.mockResolvedValue([stream({ bitrate_kbps: 5500 })])
    renderStreamsPage()

    expect(await screen.findByText('5.50')).toBeInTheDocument()
  })

  it('expands a row and toggles recording via the correct API call', async () => {
    // path omitted so ExpandedRow's WhepPlayer (real WebRTC) never mounts —
    // the recording button only depends on stream.ready, not stream.path.
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true, recording: false })])
    startRecording.mockResolvedValue({})
    renderStreamsPage()
    await screen.findByText('Camera 1')

    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))

    const startButton = await screen.findByRole('button', { name: /start recording/i })
    await userEvent.click(startButton)

    await waitFor(() => expect(startRecording).toHaveBeenCalledWith('cam1'))
  })

  it('calls stopRecording when the stream is already recording', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true, recording: true })])
    stopRecording.mockResolvedValue({})
    renderStreamsPage()
    await screen.findByText('Camera 1')

    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    await userEvent.click(await screen.findByRole('button', { name: /stop recording/i }))

    await waitFor(() => expect(stopRecording).toHaveBeenCalledWith('cam1'))
  })

  it('shows a success toast when starting a recording succeeds', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true, recording: false })])
    startRecording.mockResolvedValue({})
    renderStreamsPage()
    await screen.findByText('Camera 1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))

    await userEvent.click(await screen.findByRole('button', { name: /start recording/i }))

    expect(await screen.findByText('Recording started')).toBeInTheDocument()
  })

  it('shows an error toast when starting a recording fails', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true, recording: false })])
    startRecording.mockRejectedValue({ response: { data: { detail: 'Stream not ready' } } })
    renderStreamsPage()
    await screen.findByText('Camera 1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))

    await userEvent.click(await screen.findByRole('button', { name: /start recording/i }))

    expect(await screen.findByText('Stream not ready')).toBeInTheDocument()
  })

  it('hides the QC monitoring toggle for a non-admin, but shows a read-only badge when monitoring is on', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true })])
    getQcStatus.mockResolvedValue({ monitored_paths: ['cam1'], active_issues: [] })
    renderStreamsPage()
    await screen.findByText('Camera 1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))

    expect(await screen.findByText('QC monitoring on')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /QC Monitoring/ })).not.toBeInTheDocument()
  })

  it('lets an admin enable QC monitoring for a stream', async () => {
    act(() => useAuthStore.setState({ user: { username: 'admin1', role: 'admin' }, token: 'tok' }))
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true })])
    renderStreamsPage()
    await screen.findByText('Camera 1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))

    const toggle = await screen.findByRole('button', { name: 'QC Monitoring: Off' })
    await userEvent.click(toggle)

    expect(enableQc.mock.calls[0][0]).toBe('cam1')
    expect(await screen.findByText('QC monitoring enabled')).toBeInTheDocument()
  })

  it('lets an admin disable QC monitoring when it is already on', async () => {
    act(() => useAuthStore.setState({ user: { username: 'admin1', role: 'admin' }, token: 'tok' }))
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true })])
    getQcStatus.mockResolvedValue({ monitored_paths: ['cam1'], active_issues: [] })
    renderStreamsPage()
    await screen.findByText('Camera 1')
    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))

    const toggle = await screen.findByRole('button', { name: 'QC Monitoring: On' })
    await userEvent.click(toggle)

    expect(disableQc.mock.calls[0][0]).toBe('cam1')
    expect(await screen.findByText('QC monitoring disabled')).toBeInTheDocument()
  })

  it('shows an active QC issue as a warning icon on the collapsed row and a detail banner when expanded', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', ready: true })])
    getQcStatus.mockResolvedValue({
      monitored_paths: ['cam1'],
      active_issues: [{ path: 'cam1', kind: 'freeze', started_at: '2026-01-01T00:00:00' }],
    })
    renderStreamsPage()
    await screen.findByText('Camera 1')

    expect(await screen.findByTitle('freeze detected')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Expand' }))
    expect(await screen.findByText('freeze detected')).toBeInTheDocument()
  })

  it('shows a connection-error message instead of the empty state when the streams query fails', async () => {
    getStreams.mockRejectedValue(new Error('network error'))
    renderStreamsPage()

    expect(await screen.findByText('Could not load streams. Retrying…')).toBeInTheDocument()
    expect(screen.queryByText('No streams connected')).not.toBeInTheDocument()
  })
})

describe('StreamsPage — favorites', () => {
  it('pins a stream and moves it to the top of the list', async () => {
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'cam1', name: 'Studio A' }),
      stream({ publisher_id: 'cam2', name: 'Studio B' }),
    ])
    renderStreamsPage()
    await screen.findByText('Studio B')

    await userEvent.click(screen.getByRole('button', { name: 'Pin Studio B' }))

    expect(addFavorite).toHaveBeenCalled()
    expect(addFavorite.mock.calls[0][0]).toBe('Studio B')
  })

  it('sorts a favorited stream first even though it was returned second', async () => {
    getFavorites.mockResolvedValue(['Studio B'])
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'cam1', name: 'Studio A' }),
      stream({ publisher_id: 'cam2', name: 'Studio B' }),
    ])
    renderStreamsPage()
    await screen.findByText('Studio B')

    const rows = screen.getAllByRole('row').slice(1) // drop the header row
    expect(within(rows[0]).getByText('Studio B')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Studio A')).toBeInTheDocument()
  })

  it('shows a filled star and "Unpin" label for an already-favorited stream, and unpins on click', async () => {
    getFavorites.mockResolvedValue(['Studio A'])
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', name: 'Studio A' })])
    renderStreamsPage()
    await screen.findByText('Studio A')

    const star = screen.getByRole('button', { name: 'Unpin Studio A' })
    expect(star).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(star)

    expect(removeFavorite).toHaveBeenCalled()
    expect(removeFavorite.mock.calls[0][0]).toBe('Studio A')
  })

  it('clicking the star does not also expand/collapse the row', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', name: 'Studio A' })])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.click(screen.getByRole('button', { name: 'Pin Studio A' }))

    expect(screen.queryByRole('button', { name: 'Collapse' })).not.toBeInTheDocument()
  })
})

describe('StreamsPage — bulk actions', () => {
  it('shows no bulk actions bar until a stream is selected', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', name: 'Studio A' })])
    renderStreamsPage()
    await screen.findByText('Studio A')

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  it('selecting a stream shows the bulk actions bar with a count', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', name: 'Studio A' })])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Studio A' }))

    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('"select all" selects every filtered stream and updates the count', async () => {
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'cam1', name: 'Studio A' }),
      stream({ publisher_id: 'cam2', name: 'Studio B' }),
    ])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all streams' }))

    expect(screen.getByText('2 selected')).toBeInTheDocument()
  })

  it('bulk-starts recording only on selected streams that are live and not already recording', async () => {
    startRecording.mockResolvedValue({})
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'cam1', name: 'Studio A', ready: true, recording: false }),
      stream({ publisher_id: 'cam2', name: 'Studio B', ready: false, recording: false }),
    ])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all streams' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start Recording (1)' }))

    await waitFor(() => expect(startRecording).toHaveBeenCalledTimes(1))
    expect(startRecording).toHaveBeenCalledWith('cam1')
    expect(await screen.findByText('Started recording on 1 stream')).toBeInTheDocument()
  })

  it('bulk-stops recording only on selected streams currently recording', async () => {
    stopRecording.mockResolvedValue({})
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'cam1', name: 'Studio A', ready: true, recording: true }),
      stream({ publisher_id: 'cam2', name: 'Studio B', ready: true, recording: false }),
    ])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all streams' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stop Recording (1)' }))

    await waitFor(() => expect(stopRecording).toHaveBeenCalledTimes(1))
    expect(stopRecording).toHaveBeenCalledWith('cam1')
    expect(await screen.findByText('Stopped recording on 1 stream')).toBeInTheDocument()
  })

  it('shows a partial-failure toast when some bulk actions fail', async () => {
    startRecording.mockImplementation((id) => id === 'cam1' ? Promise.resolve({}) : Promise.reject(new Error('boom')))
    getStreams.mockResolvedValue([
      stream({ publisher_id: 'cam1', name: 'Studio A', ready: true, recording: false }),
      stream({ publisher_id: 'cam2', name: 'Studio B', ready: true, recording: false }),
    ])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all streams' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start Recording (2)' }))

    expect(await screen.findByText('Started recording on 1, failed on 1')).toBeInTheDocument()
  })

  it('clears the selection via the close button on the bulk actions bar', async () => {
    getStreams.mockResolvedValue([stream({ publisher_id: 'cam1', name: 'Studio A' })])
    renderStreamsPage()
    await screen.findByText('Studio A')

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Studio A' }))
    expect(screen.getByText('1 selected')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument()
  })
})

describe('StreamsPage — Presets tab', () => {
  async function goToPresetsTab() {
    await userEvent.click(screen.getByRole('tab', { name: 'Presets' }))
  }

  it('shows the empty state when there are no presets', async () => {
    renderStreamsPage()
    await goToPresetsTab()

    expect(await screen.findByText('No presets yet')).toBeInTheDocument()
  })

  it('lists presets returned by the API', async () => {
    getPresets.mockResolvedValue([
      { id: 1, name: 'Studio A Main', srt_url: 'srt://host:9000', description: 'Main camera' },
    ])
    renderStreamsPage()
    await goToPresetsTab()

    expect(await screen.findByText('Studio A Main')).toBeInTheDocument()
    expect(screen.getByText('Main camera')).toBeInTheDocument()
    expect(screen.getByText('srt://host:9000')).toBeInTheDocument()
  })

  it('deletes a preset', async () => {
    getPresets.mockResolvedValue([{ id: 1, name: 'Studio A Main', srt_url: 'srt://host:9000' }])
    deletePreset.mockResolvedValue({})
    renderStreamsPage()
    await goToPresetsTab()
    await screen.findByText('Studio A Main')

    await userEvent.click(screen.getByTitle('Delete preset'))

    await waitFor(() => expect(deletePreset).toHaveBeenCalled())
    expect(deletePreset.mock.calls[0][0]).toBe(1)
    expect(await screen.findByText('Preset deleted')).toBeInTheDocument()
  })

  it('validates required fields before saving a new preset', async () => {
    renderStreamsPage()
    await userEvent.click(screen.getByRole('button', { name: /add preset/i }))

    await userEvent.click(screen.getByRole('button', { name: 'Save Preset' }))

    expect(await screen.findByText('Name and SRT URL are required')).toBeInTheDocument()
    expect(savePreset).not.toHaveBeenCalled()
  })

  it('saves a new preset with valid fields and closes the modal', async () => {
    savePreset.mockResolvedValue({ id: 2 })
    renderStreamsPage()
    await userEvent.click(screen.getByRole('button', { name: /add preset/i }))

    await userEvent.type(screen.getByPlaceholderText('e.g. Studio A Main'), 'New Preset')
    await userEvent.type(screen.getByPlaceholderText('srt://host:port?streamid=...'), 'srt://host:9000')
    await userEvent.click(screen.getByRole('button', { name: 'Save Preset' }))

    await waitFor(() => expect(savePreset).toHaveBeenCalled())
    expect(savePreset.mock.calls[0][0]).toEqual({
      name: 'New Preset', srt_url: 'srt://host:9000', description: '',
    })
    await waitFor(() => {
      expect(screen.queryByText('Add Stream Preset')).not.toBeInTheDocument()
    })
  })

  it('shows a server error message when saving a preset fails', async () => {
    savePreset.mockRejectedValue({ response: { data: { detail: 'Name already taken' } } })
    renderStreamsPage()
    await userEvent.click(screen.getByRole('button', { name: /add preset/i }))

    await userEvent.type(screen.getByPlaceholderText('e.g. Studio A Main'), 'Dup')
    await userEvent.type(screen.getByPlaceholderText('srt://host:port?streamid=...'), 'srt://host:9000')
    await userEvent.click(screen.getByRole('button', { name: 'Save Preset' }))

    expect(await screen.findByText('Name already taken')).toBeInTheDocument()
  })
})
