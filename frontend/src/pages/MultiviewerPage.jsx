import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getStreams, getMultiviewJobs, stopMultiviewJob,
  getExternalSources, addYoutubeSource, removeExternalSource,
} from '../api/client'
import MultiviewTile, { gridColsClassFor } from '../components/MultiviewTile'

function parseStreamsParam(searchParams) {
  return new Set(
    (searchParams.get('streams') || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
  )
}

export default function MultiviewerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pinned, setPinned] = useState(() => parseStreamsParam(searchParams))
  const [copied, setCopied] = useState(false)
  const queryClient = useQueryClient()
  const [stoppingId, setStoppingId] = useState(null)

  const { data: streams = [] } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  })

  const { data: activeJobs = [] } = useQuery({
    queryKey: ['multiview-jobs'],
    queryFn: getMultiviewJobs,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })

  async function stopJob(jobId) {
    setStoppingId(jobId)
    try {
      await stopMultiviewJob(jobId)
      queryClient.invalidateQueries({ queryKey: ['multiview-jobs'] })
    } finally {
      setStoppingId(null)
    }
  }

  const { data: externalSources = [] } = useQuery({
    queryKey: ['external-sources'],
    queryFn: getExternalSources,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })
  const [showAddSource, setShowAddSource] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState(null)
  const [addingSource, setAddingSource] = useState(false)
  const [removingSource, setRemovingSource] = useState(null)

  async function submitYoutubeSource(e) {
    e.preventDefault()
    setSourceError(null)
    setAddingSource(true)
    try {
      await addYoutubeSource(sourceName.trim(), sourceUrl.trim())
      setSourceName('')
      setSourceUrl('')
      setShowAddSource(false)
      queryClient.invalidateQueries({ queryKey: ['external-sources'] })
    } catch (err) {
      setSourceError(err.response?.data?.detail || err.message || 'Failed to add source')
    } finally {
      setAddingSource(false)
    }
  }

  async function removeSource(name) {
    setRemovingSource(name)
    try {
      await removeExternalSource(name)
      queryClient.invalidateQueries({ queryKey: ['external-sources'] })
    } finally {
      setRemovingSource(null)
    }
  }

  const liveStreams = streams.filter((s) => s.ready)
  const pinnedStreams = liveStreams.filter((s) => pinned.has(s.path))

  function applyPinned(next) {
    setPinned(next)
    setSearchParams(next.size ? { streams: Array.from(next).join(',') } : {}, { replace: true })
  }

  function togglePin(path) {
    const next = new Set(pinned)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    applyPinned(next)
  }

  function standaloneUrl() {
    return `${window.location.origin}/multiview?streams=${Array.from(pinned).join(',')}`
  }

  function openStandalone() {
    window.open(standaloneUrl(), '_blank', 'noopener')
  }

  function copyLink() {
    const url = standaloneUrl()

    const fallbackCopy = () => {
      const textarea = document.createElement('textarea')
      textarea.value = url
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
      } finally {
        document.body.removeChild(textarea)
      }
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).catch(fallbackCopy)
    } else {
      fallbackCopy()
    }

    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const gridColsClass = gridColsClassFor(pinnedStreams.length)

  return (
    <div className="flex h-full min-h-0">
      <div className="w-64 shrink-0 border-r border-[#222233] p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-2 px-1">
          <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
            Live Streams
          </h2>
          {pinned.size > 0 && (
            <button
              onClick={() => applyPinned(new Set())}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Clear
            </button>
          )}
        </div>
        {pinned.size > 0 && (
          <div className="flex flex-col gap-1.5 mb-3">
            <button
              onClick={copyLink}
              className="w-full px-2 py-1.5 rounded-lg text-xs font-semibold border border-indigo-500/40 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
            >
              {copied ? 'Link copied' : 'Copy standalone link'}
            </button>
            <button
              onClick={openStandalone}
              className="w-full px-2 py-1.5 rounded-lg text-xs font-semibold border border-[#222233] text-gray-400 hover:text-gray-200 hover:bg-[#1a1a2e] transition-colors"
            >
              Open standalone view
            </button>
          </div>
        )}
        {activeJobs.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-2 px-1">
              Active Composites
            </h2>
            <div className="flex flex-col gap-1">
              {activeJobs.map((j) => (
                <div
                  key={j.job_id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-[#222233] bg-[#12121a]"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${j.running ? 'bg-green-500' : 'bg-gray-500'}`} />
                  <span className="truncate flex-1 text-gray-300" title={j.paths.join(', ')}>
                    {j.paths.join(' + ')}
                    {j.audio_path && <span className="text-gray-500"> 🔊{j.audio_path}</span>}
                  </span>
                  <button
                    onClick={() => stopJob(j.job_id)}
                    disabled={stoppingId === j.job_id}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-red-500/40 bg-red-600/20 text-red-300 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
                  >
                    {stoppingId === j.job_id ? '…' : 'Stop'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2 px-1">
            <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold">
              External Sources
            </h2>
            <button
              onClick={() => setShowAddSource((v) => !v)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              {showAddSource ? 'Cancel' : '+ Add'}
            </button>
          </div>

          {showAddSource && (
            <form onSubmit={submitYoutubeSource} className="flex flex-col gap-1.5 mb-2 px-1">
              <input
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="Name (letters, numbers, - _)"
                className="text-xs bg-[#12121a] border border-[#222233] text-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500/50"
                required
              />
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="YouTube URL"
                className="text-xs bg-[#12121a] border border-[#222233] text-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500/50"
                required
              />
              {sourceError && <p className="text-xs text-red-400">{sourceError}</p>}
              <button
                type="submit"
                disabled={addingSource}
                className="px-2 py-1.5 rounded-lg text-xs font-semibold border border-indigo-500/40 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 disabled:opacity-50 transition-colors"
              >
                {addingSource ? 'Adding…' : 'Add YouTube source'}
              </button>
            </form>
          )}

          {externalSources.length > 0 && (
            <div className="flex flex-col gap-1">
              {externalSources.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs border border-[#222233] bg-[#12121a]"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    s.status === 'live' ? 'bg-green-500' : s.status === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                  }`} title={s.last_error || s.status} />
                  <span className="truncate flex-1 text-gray-300" title={s.url}>{s.name}</span>
                  <button
                    onClick={() => removeSource(s.name)}
                    disabled={removingSource === s.name}
                    className="shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold border border-red-500/40 bg-red-600/20 text-red-300 hover:bg-red-600/30 disabled:opacity-50 transition-colors"
                  >
                    {removingSource === s.name ? '…' : 'Remove'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {liveStreams.length === 0 && (
          <p className="text-sm text-gray-600 px-1">No live streams right now.</p>
        )}
        <div className="flex flex-col gap-1">
          {liveStreams.map((s) => (
            <button
              key={s.path}
              onClick={() => togglePin(s.path)}
              className={`flex items-center gap-2 px-2 py-2 rounded-lg text-left text-sm transition-colors border ${
                pinned.has(s.path)
                  ? 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
                  : 'text-gray-300 hover:bg-[#1a1a2e] border-transparent'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  pinned.has(s.path) ? 'bg-indigo-400' : 'bg-gray-600'
                }`}
              />
              <span className="truncate flex-1">{s.name || s.path}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-4 overflow-auto">
        {pinnedStreams.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
            Select streams from the left to add them to the multiviewer.
          </div>
        ) : (
          <div className={`grid ${gridColsClass} content-start gap-3 w-full`}>
            {pinnedStreams.map((s) => (
              <MultiviewTile key={s.path} path={s.path} label={s.name || s.path} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
