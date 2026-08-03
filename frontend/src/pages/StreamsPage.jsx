import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, ChevronRight, Copy, Trash2, PackageOpen, Radio } from 'lucide-react'
import {
  getStreams, getPresets, savePreset, deletePreset,
  startRecording, stopRecording, getPreviewUrls,
} from '../api/client'
import { startWhep } from '../utils/whep'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import Tabs from '../components/ui/Tabs'
import Button from '../components/ui/Button'
import StatusDot from '../components/ui/StatusDot'
import { toast } from '../store/toast'

// ── Helpers ───────────────────────────────────────────────────────────────────

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-surface-700 rounded ${className}`} />
}

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── WebRTC inline player ──────────────────────────────────────────────────────

function WhepPlayer({ src }) {
  const videoRef = useRef(null)
  const pcRef = useRef(null)
  const retryTimer = useRef(null)

  useEffect(() => {
    let alive = true

    const connect = async () => {
      clearTimeout(retryTimer.current)
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
      if (!alive || !videoRef.current || !src) return
      try {
        const pc = await startWhep(src, videoRef.current)
        if (!alive) { pc.close(); return }
        pcRef.current = pc
        pc.addEventListener('connectionstatechange', () => {
          if (!alive) return
          const s = pc.connectionState
          if (s === 'failed' || s === 'disconnected')
            retryTimer.current = setTimeout(connect, 4000)
        })
      } catch {
        retryTimer.current = setTimeout(connect, 5000)
      }
    }

    connect()
    return () => {
      alive = false
      clearTimeout(retryTimer.current)
      pcRef.current?.close()
      pcRef.current = null
    }
  }, [src])

  return (
    <video
      ref={videoRef}
      className="w-[320px] h-[180px] bg-black rounded-lg object-contain"
      muted
      playsInline
      autoPlay
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streams'] })
      toast.success(isRecording ? 'Recording stopped' : 'Recording started')
    },
    onError: (err) => toast.error(err?.response?.data?.detail || `Failed to ${isRecording ? 'stop' : 'start'} recording`),
  })

  return (
    <tr className="bg-surface-750">
      <td colSpan={7} className="px-6 py-4">
        <div className="flex gap-6 items-start">
          {/* HLS preview */}
          <div className="shrink-0">
            {isLoading ? (
              <Skeleton className="w-[320px] h-[180px]" />
            ) : stream.path && stream.ready ? (
              <WhepPlayer src={`/api/whep/${stream.path}/whep`} />
            ) : (
              <div className="w-[320px] h-[180px] bg-surface-800 border border-surface-600 rounded-lg flex items-center justify-center text-gray-600 text-xs">
                {stream.ready ? 'No HLS available' : 'Stream offline'}
              </div>
            )}
          </div>

          {/* URL details */}
          <div className="flex-1 grid grid-cols-1 gap-3 text-xs">
            {[
              { label: 'SRT URL',   value: urls?.srt_url },
              { label: 'HLS URL',   value: urls?.hls_url },
              { label: 'Watch URL', value: urls?.webrtc_url },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-gray-500 mb-0.5">{label}</p>
                {isLoading ? (
                  <Skeleton className="h-5 w-full" />
                ) : (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-gray-300 font-mono bg-surface-900 border border-surface-600 rounded px-2 py-1 truncate">
                      {value || '—'}
                    </code>
                    {value && (
                      <button
                        onClick={() => navigator.clipboard.writeText(value)}
                        className="shrink-0 text-gray-500 hover:text-brand-400 transition-colors"
                        title="Copy"
                      >
                        <Copy size={15} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Recording control */}
            <div className="pt-2">
              <Button
                variant={isRecording ? 'danger' : 'ghost'}
                size="sm"
                onClick={() => recMutation.mutate()}
                disabled={!stream.ready || recMutation.isPending}
              >
                <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
                {recMutation.isPending ? 'Working...' : isRecording ? 'Stop Recording' : 'Start Recording'}
              </Button>
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

  const { data: streams = [], isLoading, isError } = useQuery({
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
    <div className="overflow-x-auto rounded-xl border border-surface-600">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-600 bg-surface-750">
            {cols.map(c => (
              <th key={c} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-700">
          {isError
            ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-sm text-red-400 bg-red-500/10">
                    Could not load streams. Retrying…
                  </td>
                </tr>
              )
            : isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="bg-surface-800">
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
                  <td colSpan={7} className="px-4 py-10 text-center text-gray-600 text-sm bg-surface-800">
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
                      className={`bg-surface-800 hover:bg-surface-750 transition-colors cursor-pointer ${isExpanded ? 'bg-surface-750' : ''}`}
                      onClick={() => setExpandedId(isExpanded ? null : stream.publisher_id)}
                    >
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronRight size={15} className={`text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          <span className="font-medium text-white truncate max-w-[160px]" title={stream.name || stream.publisher_id}>
                            {stream.name || stream.publisher_id}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <StatusDot tone={isLive ? 'good' : 'muted'} pulse={isLive} size={7} />
                          <Badge tone={isLive ? 'good' : 'muted'}>{isLive ? 'LIVE' : 'OFFLINE'}</Badge>
                          {stream.recording && <Badge tone="critical">REC</Badge>}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3">
                        <Badge tone="info">{stream.protocol || 'SRT'}</Badge>
                      </td>

                      {/* Bitrate */}
                      <td className="px-4 py-3 font-mono text-gray-300 whitespace-nowrap tabular-nums">
                        {bitrateMbps} <span className="text-gray-500 text-xs">Mbps</span>
                      </td>

                      {/* Viewers */}
                      <td className="px-4 py-3 text-gray-300 font-mono tabular-nums">{stream.readers ?? '—'}</td>

                      {/* Duration */}
                      <td className="px-4 py-3 font-mono text-gray-300 whitespace-nowrap tabular-nums">
                        {formatDuration(stream.uptime_seconds)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(isExpanded ? null : stream.publisher_id)}
                        >
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </Button>
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
    <Modal open onClose={onClose}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-surface-600">
        <h3 className="font-semibold text-white">Add Stream Preset</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">✕</button>
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
              className="w-full bg-surface-900 border border-surface-500 focus:border-brand-500 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors"
            />
          </div>
        ))}

        <div className="flex gap-3 pt-2">
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" className="flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save Preset'}
          </Button>
        </div>
      </form>
    </Modal>
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presets'] })
      toast.success('Preset deleted')
    },
    onError: (err) => toast.error(err?.response?.data?.detail || 'Failed to delete preset'),
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
        <PackageOpen size={40} strokeWidth={1} />
        <p className="text-sm">No presets yet</p>
        <button onClick={onAddPreset} className="text-xs text-brand-400 hover:text-brand-300 transition-colors">
          Add your first preset
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {presets.map(preset => (
        <Card key={preset.id || preset.name} hover className="p-4 flex flex-col gap-3 group">
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
              <Trash2 size={15} />
            </button>
          </div>

          <div className="min-w-0">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">SRT URL</p>
            <div className="flex items-center gap-1.5">
              <code className="flex-1 text-[11px] font-mono text-gray-400 bg-surface-900 border border-surface-600 rounded px-2 py-1.5 truncate">
                {preset.srt_url || '—'}
              </code>
              {preset.srt_url && (
                <button
                  onClick={() => navigator.clipboard.writeText(preset.srt_url)}
                  className="shrink-0 text-gray-600 hover:text-brand-400 transition-colors"
                  title="Copy URL"
                >
                  <Copy size={13} />
                </button>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { value: 'live', label: 'Live Streams' },
  { value: 'presets', label: 'Presets' },
]

export default function StreamsPage() {
  const [activeTab, setActiveTab] = useState('live')
  const [search, setSearch] = useState('')
  const [showAddPreset, setShowAddPreset] = useState(false)

  return (
    <div className="relative flex flex-col gap-5 p-6 bg-surface-900 min-h-full">
      <div
        className="absolute top-0 right-1/4 w-[400px] h-[240px] blur-[100px] opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #22d3ee, transparent 70%)' }}
      />

      {/* Top bar */}
      <div className="relative flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2.5">
          <Radio size={22} className="text-brand-400" />
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Streams</h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search streams..."
              className="bg-surface-800 border border-surface-600 focus:border-brand-500 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 outline-none transition-colors w-48 focus:w-64"
            />
          </div>

          <Button
            variant="primary"
            onClick={() => { setActiveTab('presets'); setShowAddPreset(true) }}
          >
            <Plus size={16} />
            Add Preset
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} className="relative self-start" />

      {/* Tab content */}
      <div className="relative flex-1 min-h-0">
        {activeTab === 'live' && <LiveStreamsTab search={search} />}
        {activeTab === 'presets' && (
          <PresetsTab onAddPreset={() => setShowAddPreset(true)} />
        )}
      </div>

      {/* Add Preset modal */}
      {showAddPreset && <AddPresetModal onClose={() => setShowAddPreset(false)} />}
    </div>
  )
}
