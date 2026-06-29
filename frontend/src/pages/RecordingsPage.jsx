import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getRecordings, deleteRecording, downloadUrl } from '../api/client'

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

function formatRelative(ts) {
  if (!ts) return '—'
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function ElapsedTimer({ startedAt }) {
  const [, forceUpdate] = useState(0)
  // Rerender every second via a query interval — simpler than useEffect here
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
  if (status === 'error') {
    return (
      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
        Error
      </span>
    )
  }
  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
      Complete
    </span>
  )
}

function RecordingCard({ rec, onDelete }) {
  return (
    <div className="bg-[#111118] border border-[#222233] rounded-xl p-4 flex flex-col gap-3 hover:border-[#333355] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-gray-100 text-sm font-medium truncate">{rec.filename || rec.name}</div>
          <div className="text-gray-500 text-xs mt-0.5 truncate">{rec.stream_name || rec.stream}</div>
        </div>
        <StatusBadge status={rec.status} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Duration</span>
          <span className="text-sm text-gray-300 font-medium font-mono">
            {rec.status === 'recording'
              ? <ElapsedTimer startedAt={rec.started_at} />
              : formatDuration(rec.duration_seconds)
            }
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Size</span>
          <span className="text-sm text-gray-300 font-medium">
            {rec.status === 'recording' && rec.size_bytes
              ? <span className="text-amber-400">{formatSize(rec.size_bytes)} ↑</span>
              : formatSize(rec.size_bytes)
            }
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Recorded</span>
          <span className="text-sm text-gray-300">{formatRelative(rec.started_at || rec.created_at)}</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-600 uppercase tracking-wider">Format</span>
          <span className="text-sm text-gray-300">{rec.format || 'mkv'}</span>
        </div>
      </div>
      <div className="flex gap-2 pt-1 border-t border-[#222233]">
        {rec.status !== 'recording' && (
          <a
            href={downloadUrl(rec.id)}
            className="flex-1 text-center text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/60 py-1.5 rounded-lg transition-colors"
            download
          >
            Download
          </a>
        )}
        <button
          onClick={() => onDelete(rec)}
          className="flex-1 text-xs text-red-400/60 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 py-1.5 rounded-lg transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

export default function RecordingsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: recordings = [], isLoading } = useQuery({
    queryKey: ['recordings'],
    queryFn: getRecordings,
    refetchInterval: 5000,
  })

  const deleteMut = useMutation({
    mutationFn: (id) => deleteRecording(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recordings'] }),
  })

  const handleDelete = (rec) => {
    if (window.confirm(`Delete "${rec.filename || rec.name}"? This cannot be undone.`)) {
      deleteMut.mutate(rec.id)
    }
  }

  const active = recordings.filter(r => r.status === 'recording')
  const completed = recordings.filter(r => r.status !== 'recording')

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
    <div className="p-6 min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-medium">Recordings</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {completed.length} recordings · {formatSize(totalBytes)} stored
          </p>
        </div>
        <input
          className="bg-[#111118] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 w-56"
          placeholder="Search recordings…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Active recordings */}
      {active.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <h2 className="text-sm font-medium text-white">Recording now</h2>
            <span className="text-xs text-gray-500">({active.length})</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {active.map(rec => (
              <RecordingCard key={rec.id} rec={rec} onDelete={handleDelete} />
            ))}
          </div>
        </div>
      )}

      {/* Completed recordings */}
      <div>
        {active.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-medium text-white">Library</h2>
            {search && <span className="text-xs text-gray-500">{filtered.length} match{filtered.length !== 1 ? 'es' : ''}</span>}
          </div>
        )}

        {isLoading && (
          <div className="text-center py-20 text-gray-600">Loading…</div>
        )}

        {!isLoading && filtered.length === 0 && !active.length && (
          <div className="text-center py-20">
            <div className="text-gray-500 text-sm">No recordings yet</div>
            <div className="text-gray-600 text-xs mt-1">Start recording a stream to see it here</div>
          </div>
        )}

        {!isLoading && filtered.length === 0 && search && (
          <div className="text-center py-10 text-gray-600 text-sm">
            No recordings match "{search}"
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          {filtered.map(rec => (
            <RecordingCard key={rec.id} rec={rec} onDelete={handleDelete} />
          ))}
        </div>
      </div>
    </div>
  )
}
