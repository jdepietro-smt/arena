import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Hls from 'hls.js'
import {
  getStreams, getPresets, savePreset, deletePreset,
  startRecording, stopRecording, getPreviewUrls,
} from '../api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1e1e2e] rounded ${className}`} />
}

function Badge({ children, color = 'gray' }) {
  const colors = {
    green:  'bg-green-500/15 text-green-400 border-green-500/30',
    gray:   'bg-gray-500/15 text-gray-400 border-gray-500/30',
    indigo: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
    red:    'bg-red-500/15 text-red-400 border-red-500/30',
    yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${colors[color]}`}>
      {children}
    </span>
  )
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── HLS inline player ─────────────────────────────────────────────────────────

function HlsPlayer({ src }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (!src || !videoRef.current) return
    const video = videoRef.current

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 5,
      })
      hls.loadSource(src)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
      return () => hls.destroy()
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      video.play().catch(() => {})
    }
  }, [src])

  return (
    <video
      ref={videoRef}
      className="w-[320px] h-[180px] bg-black rounded-lg object-contain"
      muted
      playsInline
    />
  )
}

// ── Expanded stream row ───────────────────────────────────────────────────────

function ExpandedRow({ stream }) {
  const { data: urls, isLoading } = useQuery({
    queryKey: ['preview-urls', stream.publisher_id],
    queryFn: () => getPreviewUrls(stream.publisher_id),
    enabled: !!stream.publisher_id,
  })

  const queryClient = useQueryClient()
  const isRecording = stream.recording === true

  const recMutation = useMutation({
    mutationFn: isRecording
      ? () => stopRecording(stream.publisher_id)
      : () => startRecording(stream.publisher_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streams'] }),
  })

  return (
    <tr className="bg-[#0d0d14]">
      <td colSpan={7} className="px-6 py-4">
        <div className="flex gap-6 items-start">
          {/* HLS preview */}
          <div className="shrink-0">
            {isLoading ? (
              <Skeleton className="w-[320px] h-[180px]" />
            ) : urls?.hls_url && stream.ready ? (
              <HlsPlayer src={urls.hls_url} />
            ) : (
              <div className="w-[320px] h-[180px] bg-[#111118] border border-[#222233] rounded-lg flex items-center justify-center text-gray-600 text-xs">
                {stream.ready ? 'No HLS available' : 'Stream offline'}
              </div>
            )}
          </div>

          {/* URL details */}
          <div className="flex-1 grid grid-cols-1 gap-3 text-xs">
            {[
              { label: 'SRT URL',    value: urls?.srt_url },
              { label: 'HLS URL',    value: urls?.hls_url },
              { label: 'WebRTC URL', value: urls?.webrtc_url },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-full" />
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-gray-300 font-mono bg-[#0a0a0f] border border-[#222233] rounded px-2 py-1 truncate">
                      {value || '—'}
                    </code>
                    {value && (
                      <button
                        onClick={() => navigator.clipboard.writeText(value)}
                        className="shrink-0 text-gray-500 hover:text-indigo-400 transition-colors"
                        title="Copy"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="1.5" />
                          <path strokeWidth="1.5" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Recording control */}
            <div className="pt-2">
              <button
                onClick={() => recMutation.mutate()}
                disabled={!stream.ready || recMutation.isPending}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors
                  ${!stream.ready
                    ? 'bg-[#1a1a1a] text-gray-600 cursor-not-allowed'
                    : isRecording
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-[#1e1e2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#333344]'
                  }
                `}
              >
                <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
                {recMutation.isPending ? 'Working...' : isRecording ? 'Stop Recording' : 'Start Recording'}
              </button>
            </div>
          </div>
        </div>
      </td>
    </tr>
  )
}

// ── Live Streams tab ──────────────────────────────────────────────────────────

function LiveStreamsTab({ search }) {
  const [expandedId, setExpandedId] = useState(null)

  const { data: streams = [], isLoading } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 3000,
  })

  const filtered = streams.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (s.name || '').toLowerCase().includes(q) ||
      (s.publisher_id || '').toLowerCase().includes(q)
    )
  })

  const cols = ['Name', 'Status', 'Source', 'Bitrate', 'Viewers', 'Duration', 'Actions']

  return (
    <div className="overflow-x-auto rounded-xl border border-[#222233]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#222233] bg-[#0d0d14]">
            {cols.map(c => (
              <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1a1a28]">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="bg-[#111118]">
                  {cols.map(c => (
                    <td key={c} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            : filtered.length === 0
              ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-600 text-sm bg-[#111118]">
                    {search ? 'No streams match your search' : 'No streams connected'}
                  </td>
                </tr>
              )
              : filtered.flatMap(stream => {
                  const isExpanded = expandedId === stream.publisher_id
                  const isLive = stream.ready === true
                  const bitrateMbps = stream.bitrate_kbps
                    ? (stream.bitrate_kbps / 1000).toFixed(2)
                    : '—'

                  return [
                    <tr
                      key={stream.publisher_id}
                      className={`bg-[#111118] hover:bg-[#15151f] transition-colors cursor-pointer ${isExpanded ? 'bg-[#13131c]' : ''}`}
                      onClick={() => setExpandedId(isExpanded ? null : stream.publisher_id)}
                    >
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <svg
                            className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="font-medium text-white truncate max-w-[160px]" title={stream.name || stream.publisher_id}>
                            {stream.name || stream.publisher_id}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {isLive && (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                            </span>
                          )}
                          <Badge color={isLive ? 'green' : 'gray'}>
                            {isLive ? 'LIVE' : 'OFFLINE'}
                          </Badge>
                          {stream.recording && <Badge color="red">REC</Badge>}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3">
                        <Badge color="indigo">{stream.protocol || 'SRT'}</Badge>
                      </td>

                      {/* Bitrate */}
                      <td className="px-4 py-3 font-mono text-gray-300 whitespace-nowrap">
                        {bitrateMbps} <span className="text-gray-500 text-xs">Mbps</span>
                      </td>

                      {/* Viewers */}
                      <td className="px-4 py-3 text-gray-300">{stream.readers ?? '—'}</td>

                      {/* Duration */}
                      <td className="px-4 py-3 font-mono text-gray-300 whitespace-nowrap">
                        {formatDuration(stream.uptime_seconds)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : stream.publisher_id)}
                            className="text-xs px-3 py-1 rounded-lg bg-[#1e1e2e] hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 hover:border-indigo-500/40 transition-colors"
                          >
                            {isExpanded ? 'Collapse' : 'Expand'}
                          </button>
                        </div>
                      </td>
                    </tr>,

                    isExpanded && (
                      <ExpandedRow key={`${stream.publisher_id}-expanded`} stream={stream} />
                    ),
                  ].filter(Boolean)
                })
          }
        </tbody>
      </table>
    </div>
  )
}

// ── Add Preset modal ──────────────────────────────────────────────────────────

function AddPresetModal({ onClose }) {
  const [form, setForm] = useState({ name: '', srt_url: '', description: '' })
  const [error, setError] = useState('')
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: savePreset,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presets'] })
      onClose()
    },
    onError: (err) => setError(err?.response?.data?.detail || 'Failed to save preset'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim() || !form.srt_url.trim()) {
      setError('Name and SRT URL are required')
      return
    }
    setError('')
    mutation.mutate(form)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#111118] border border-[#222233] rounded-xl w-full max-w-md mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#222233]">
          <h3 className="font-semibold text-white">Add Stream Preset</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {[
            { key: 'name', label: 'Preset Name', placeholder: 'e.g. Studio A Main', type: 'text' },
            { key: 'srt_url', label: 'SRT URL', placeholder: 'srt://host:port?streamid=...', type: 'text' },
            { key: 'description', label: 'Description', placeholder: 'Optional notes', type: 'text' },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full bg-[#0a0a0f] border border-[#333344] focus:border-indigo-500 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors"
              />
            </div>
          ))}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-gray-400 bg-[#1e1e2e] hover:bg-[#2a2a3e] border border-[#333344] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Saving...' : 'Save Preset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Presets tab ───────────────────────────────────────────────────────────────

function PresetsTab({ onAddPreset }) {
  const queryClient = useQueryClient()

  const { data: presets = [], isLoading } = useQuery({
    queryKey: ['presets'],
    queryFn: getPresets,
  })

  const deleteMutation = useMutation({
    mutationFn: deletePreset,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['presets'] }),
  })

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36" />
        ))}
      </div>
    )
  }

  if (presets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-3">
        <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-sm">No presets yet</p>
        <button
          onClick={onAddPreset}
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
        >
          Add your first preset
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {presets.map(preset => (
        <div
          key={preset.id || preset.name}
          className="bg-[#111118] border border-[#222233] hover:border-indigo-500/40 rounded-xl p-4 flex flex-col gap-3 transition-colors group"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-semibold text-white truncate">{preset.name}</h3>
              {preset.description && (
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{preset.description}</p>
              )}
            </div>
            <button
              onClick={() => deleteMutation.mutate(preset.id)}
              disabled={deleteMutation.isPending}
              className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all"
              title="Delete preset"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>

          <div className="min-w-0">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">SRT URL</p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-[11px] font-mono text-gray-400 bg-[#0a0a0f] border border-[#222233] rounded px-2 py-1.5 truncate">
                {preset.srt_url || '—'}
              </code>
              {preset.srt_url && (
                <button
                  onClick={() => navigator.clipboard.writeText(preset.srt_url)}
                  className="shrink-0 text-gray-600 hover:text-indigo-400 transition-colors"
                  title="Copy URL"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <rect x="9" y="9" width="13" height="13" rx="2" strokeWidth="1.5" />
                    <path strokeWidth="1.5" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = ['Live Streams', 'Presets']

export default function StreamsPage() {
  const [activeTab, setActiveTab] = useState('Live Streams')
  const [search, setSearch] = useState('')
  const [showAddPreset, setShowAddPreset] = useState(false)

  return (
    <div className="flex flex-col gap-5 p-6 bg-[#0a0a0f] min-h-full">

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-white">Streams</h1>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search streams..."
              className="bg-[#111118] border border-[#222233] focus:border-indigo-500 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors w-48 focus:w-64"
            />
          </div>

          {/* Add preset button */}
          <button
            onClick={() => {
              setActiveTab('Presets')
              setShowAddPreset(true)
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
            </svg>
            Add Preset
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#222233]">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors
              ${activeTab === tab
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
              }
            `}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {activeTab === 'Live Streams' && <LiveStreamsTab search={search} />}
        {activeTab === 'Presets' && (
          <PresetsTab onAddPreset={() => setShowAddPreset(true)} />
        )}
      </div>

      {/* Add Preset modal */}
      {showAddPreset && <AddPresetModal onClose={() => setShowAddPreset(false)} />}
    </div>
  )
}
