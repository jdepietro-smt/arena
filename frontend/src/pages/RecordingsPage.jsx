import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CirclePlay, Search, X } from 'lucide-react'
import { getRecordings, deleteRecording, fetchRecordingBlobUrl, getRecordingStreamUrl } from '../api/client'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import StatusDot from '../components/ui/StatusDot'
import { toast } from '../store/toast'
import { scheduleDelete, usePendingDeleteIds } from '../store/pendingDelete'
import { getErrorMessage } from '../utils/errors'

function formatDuration(seconds) {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

function formatSize(bytes) {
  if (bytes == null) return '—'
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  return `${(bytes / 1e6).toFixed(1)} MB`
}

function fileFormat(filename) {
  const ext = (filename || '').split('.').pop()
  return ext ? ext.toUpperCase() : '—'
}

function formatTimestamp(ts) {
  if (!ts) return '—'
  // Backend sends naive UTC (datetime.utcnow(), no "Z"/offset) — JS's Date
  // parser treats a timezone-less ISO string as local time, not UTC, so
  // without this it silently renders several hours off depending on the
  // viewer's UTC offset.
  const iso = /Z$|[+-]\d{2}:\d{2}$/.test(ts) ? ts : `${ts}Z`
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function ElapsedTimer({ startedAt }) {
  const elapsed = startedAt ? Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) : 0
  return <span>{formatDuration(elapsed)}</span>
}

function StatusBadge({ status }) {
  if (status === 'recording') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
        Recording
      </span>
    )
  }
  if (status === 'error') return <Badge tone="critical">Error</Badge>
  return <Badge tone="good">Complete</Badge>
}

function RecordingCard({ rec, onDelete, onPreview }) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const url = await fetchRecordingBlobUrl(rec.id)
      const a = document.createElement('a')
      a.href = url
      a.download = rec.filename || rec.name || `recording-${rec.id}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to download recording'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card hover className="p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-gray-100 text-sm font-medium truncate">{rec.filename || rec.name}</div>
          <div className="text-gray-500 text-xs mt-0.5 truncate">{rec.stream_name || rec.stream}</div>
        </div>
        <StatusBadge status={rec.status} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Duration</span>
          <span className="text-sm text-gray-300 font-medium font-mono tabular-nums">
            {rec.status === 'recording'
              ? <ElapsedTimer startedAt={rec.started_at} />
              : formatDuration(rec.duration_seconds)
            }
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Size</span>
          <span className="text-sm text-gray-300 font-medium font-mono tabular-nums">
            {rec.status === 'recording' && rec.size_bytes
              ? <span className="text-amber-400">{formatSize(rec.size_bytes)} ↑</span>
              : formatSize(rec.size_bytes)
            }
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Recorded</span>
          <span className="text-sm text-gray-300">{formatTimestamp(rec.started_at || rec.created_at)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">Format</span>
          <span className="text-sm text-gray-300">{fileFormat(rec.filename || rec.name)}</span>
        </div>
      </div>
      <div className="flex gap-2 pt-1 border-t border-surface-600">
        {rec.status !== 'recording' && (
          <>
            <button
              onClick={() => onPreview(rec)}
              className="flex-1 text-xs text-gray-300 hover:text-white border border-surface-500 hover:border-surface-500 py-1.5 rounded-lg transition-colors"
            >
              Preview
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex-1 text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 hover:border-brand-500/60 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {downloading ? 'Preparing…' : 'Download'}
            </button>
          </>
        )}
        <button
          onClick={() => onDelete(rec)}
          className="flex-1 text-xs text-red-400/60 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 py-1.5 rounded-lg transition-colors"
        >
          Delete
        </button>
      </div>
    </Card>
  )
}

function PreviewModal({ rec, onClose }) {
  const [error, setError] = useState(null)
  const url = getRecordingStreamUrl(rec.id)

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-fadeIn" onClick={onClose}>
      <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-300 truncate">{rec.filename || rec.name}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white flex items-center gap-1 text-sm px-2 py-1">
            <X size={16} /> Close
          </button>
        </div>
        <div className="bg-black rounded-xl overflow-hidden aspect-video flex items-center justify-center border border-surface-600">
          {error ? (
            <span className="text-red-400 text-sm">{error}</span>
          ) : (
            <video
              src={url}
              controls
              autoPlay
              className="w-full h-full"
              onError={() => setError('Could not load recording')}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function RecordingsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [previewRec, setPreviewRec] = useState(null)
  const pendingDeleteIds = usePendingDeleteIds()

  const { data: recordings = [], isLoading, isError } = useQuery({
    queryKey: ['recordings'],
    queryFn: getRecordings,
    refetchInterval: 5000,
  })

  function handleDelete(rec) {
    scheduleDelete({
      id: rec.id,
      label: 'Recording',
      onDelete: async () => {
        await deleteRecording(rec.id)
        qc.invalidateQueries({ queryKey: ['recordings'] })
      },
      onError: (err) => toast.error(getErrorMessage(err, 'Failed to delete recording')),
    })
  }

  const visible = recordings.filter(r => !pendingDeleteIds.has(r.id))
  const active = visible.filter(r => r.status === 'recording')
  const completed = visible.filter(r => r.status !== 'recording')

  const filtered = completed.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (r.filename || r.name || '').toLowerCase().includes(q) ||
      (r.stream_name || r.stream || '').toLowerCase().includes(q)
    )
  })

  const totalBytes = completed.reduce((sum, r) => sum + (r.size_bytes || 0), 0)

  return (
    <div className="relative p-6 min-h-screen bg-surface-900">
      <div
        className="absolute top-0 left-1/4 w-[450px] h-[260px] blur-[100px] opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #f87171, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <CirclePlay size={24} className="text-red-400" />
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Recordings</h1>
            <p className="text-gray-500 text-sm mt-0.5 font-mono">
              {completed.length} recordings · {formatSize(totalBytes)} stored
            </p>
          </div>
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            className="bg-surface-800 border border-surface-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-500 w-56"
            placeholder="Search recordings…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Active recordings */}
      {active.length > 0 && (
        <div className="relative mb-6">
          <div className="flex items-center gap-2 mb-3">
            <StatusDot tone="critical" pulse size={8} />
            <h2 className="text-sm font-semibold text-white">Recording now</h2>
            <span className="text-xs text-gray-500">({active.length})</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.map(rec => (
              <RecordingCard key={rec.id} rec={rec} onDelete={handleDelete} onPreview={setPreviewRec} />
            ))}
          </div>
        </div>
      )}

      {/* Completed recordings */}
      <div className="relative">
        {active.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-white">Library</h2>
            {search && <span className="text-xs text-gray-500">{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</span>}
          </div>
        )}

        {isError && (
          <div className="text-center py-6 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg mb-4">
            Could not load recordings. Retrying…
          </div>
        )}

        {isLoading && (
          <div className="text-center py-20 text-gray-400">Loading…</div>
        )}

        {!isLoading && !isError && filtered.length === 0 && !active.length && (
          <div className="text-center py-20">
            <div className="text-gray-500 text-sm">No recordings yet</div>
            <div className="text-gray-400 text-xs mt-1">Start recording a stream to see it here</div>
          </div>
        )}

        {!isLoading && !isError && filtered.length === 0 && search && (
          <div className="text-center py-10 text-gray-400 text-sm">
            No recordings match "{search}"
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(rec => (
            <RecordingCard key={rec.id} rec={rec} onDelete={handleDelete} onPreview={setPreviewRec} />
          ))}
        </div>
      </div>

      {previewRec && <PreviewModal rec={previewRec} onClose={() => setPreviewRec(null)} />}
    </div>
  )
}
