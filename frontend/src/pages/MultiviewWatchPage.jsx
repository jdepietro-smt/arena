import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MultiviewTile from '../components/MultiviewTile'
import { startWhepAudioOnly } from '../utils/whep'

function useAudioSelector(paths) {
  const audioRef = useRef(null)
  const pcRef = useRef(null)
  const [selected, setSelected] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | live | error

  useEffect(() => {
    let alive = true
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (!selected) {
      setStatus('idle')
      return
    }
    setStatus('connecting')
    const connect = async () => {
      try {
        const pc = await startWhepAudioOnly(`/api/whep/${selected}/whep`, audioRef.current)
        if (!alive) {
          pc.close()
          return
        }
        pcRef.current = pc
        setStatus('live')
      } catch {
        if (alive) setStatus('error')
      }
    }
    connect()
    return () => {
      alive = false
      pcRef.current?.close()
      pcRef.current = null
    }
  }, [selected])

  // Deselect if the chosen path drops out of the current stream list.
  useEffect(() => {
    if (selected && !paths.includes(selected)) setSelected('')
  }, [paths, selected])

  return { audioRef, selected, setSelected, status }
}

export default function MultiviewWatchPage() {
  const [searchParams] = useSearchParams()
  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [jobError, setJobError] = useState(null)

  const paths = (searchParams.get('streams') || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  const { audioRef, selected, setSelected, status: audioStatus } = useAudioSelector(paths)

  useEffect(() => {
    if (paths.length === 0) return
    let alive = true
    let retryTimer = null

    const requestJob = async () => {
      setJobError(null)
      try {
        const res = await fetch('/api/multiview/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (alive) setJobId(data.job_id)
      } catch (e) {
        if (!alive) return
        setJobError(e.message || 'failed to start composite')
        retryTimer = setTimeout(requestJob, 5000)
      }
    }

    requestJob()
    return () => {
      alive = false
      clearTimeout(retryTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('streams')])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  // Native fullscreen (not CSS position:fixed) sizes correctly against the
  // real screen regardless of browser chrome/viewport quirks.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  return (
    <div ref={containerRef} className="min-h-screen w-screen bg-[#0a0a0f] flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#222233] shrink-0 gap-3">
        <span className="text-sm text-gray-400 font-mono truncate">
          Multiviewer — {paths.length} stream{paths.length !== 1 ? 's' : ''}
        </span>

        <div className="flex items-center gap-3 shrink-0">
          {paths.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Audio:</span>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="text-xs bg-[#12121c] border border-[#222233] text-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500/50"
              >
                <option value="">Muted</option>
                {paths.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {selected && (
                <span className={`w-2 h-2 rounded-full ${
                  audioStatus === 'live' ? 'bg-green-500' : audioStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                }`} title={audioStatus} />
              )}
            </div>
          )}

          <button
            onClick={toggleFullscreen}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-xs font-semibold transition-colors
              bg-white/10 text-white/80 border border-white/20 hover:bg-white/20"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M15 9h4.5M15 9V4.5M15 9l5.25-5.25M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 p-3 overflow-auto min-h-0">
        {paths.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
            No streams specified — add ?streams=path1,path2 to the URL.
          </div>
        ) : jobError ? (
          <div className="w-full h-full flex items-center justify-center text-red-400 text-sm">
            Could not start composite: {jobError} — retrying…
          </div>
        ) : !jobId ? (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
            Compositing streams…
          </div>
        ) : (
          <MultiviewTile path={jobId} fill showLabel={false} />
        )}
      </div>

      <audio ref={audioRef} muted={!selected} autoPlay />
    </div>
  )
}
