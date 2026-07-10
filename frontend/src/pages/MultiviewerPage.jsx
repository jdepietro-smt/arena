import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getStreams } from '../api/client'
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

  const { data: streams = [] } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  })

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
