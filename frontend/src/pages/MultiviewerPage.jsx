import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getStreams } from '../api/client'
import { startWhep } from '../utils/whep'

function parseStreamsParam(searchParams) {
  return new Set(
    (searchParams.get('streams') || '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
  )
}

function MultiviewTile({ stream }) {
  const videoRef = useRef(null)
  const pcRef = useRef(null)
  const retryTimer = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  const whepUrl = `/api/whep/${stream.path}/whep`

  useEffect(() => {
    let alive = true

    const connect = async () => {
      clearTimeout(retryTimer.current)
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      if (!alive || !videoRef.current) return
      setError(null)
      try {
        const pc = await startWhep(whepUrl, videoRef.current)
        if (!alive) {
          pc.close()
          return
        }
        pcRef.current = pc
        pc.addEventListener('connectionstatechange', () => {
          if (!alive) return
          const s = pc.connectionState
          if (s === 'failed' || s === 'disconnected') {
            setLoaded(false)
            retryTimer.current = setTimeout(connect, s === 'failed' ? 4000 : 3000)
          }
        })
      } catch (e) {
        if (!alive) return
        setError(e.message || 'connect failed')
        retryTimer.current = setTimeout(connect, 5000)
      }
    }

    const video = videoRef.current
    const onPlaying = () => alive && setLoaded(true)
    video?.addEventListener('playing', onPlaying)
    connect()

    return () => {
      alive = false
      clearTimeout(retryTimer.current)
      video?.removeEventListener('playing', onPlaying)
      pcRef.current?.close()
      pcRef.current = null
    }
  }, [whepUrl])

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        muted
        autoPlay
        playsInline
        style={{ display: loaded ? 'block' : 'none' }}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center px-2 text-center">
          <span className="text-xs text-gray-500">{error || 'Connecting…'}</span>
        </div>
      )}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-black/60 backdrop-blur-sm text-white">
        <span className={`w-2 h-2 rounded-full ${loaded ? 'bg-green-500' : 'bg-gray-500'}`} />
        {stream.name || stream.path}
      </div>
    </div>
  )
}

const GRID_COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2',
  4: 'grid-cols-2',
  5: 'grid-cols-3',
  6: 'grid-cols-3',
  7: 'grid-cols-3',
  8: 'grid-cols-4',
  9: 'grid-cols-3',
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

  function copyLink() {
    const url = window.location.href

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

  const gridColsClass = GRID_COLS[Math.min(pinnedStreams.length, 9)] || GRID_COLS[9]

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
          <button
            onClick={copyLink}
            className="w-full mb-3 px-2 py-1.5 rounded-lg text-xs font-semibold border border-indigo-500/40 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
          >
            {copied ? 'Link copied' : 'Copy shareable link'}
          </button>
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
              <MultiviewTile key={s.path} stream={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
