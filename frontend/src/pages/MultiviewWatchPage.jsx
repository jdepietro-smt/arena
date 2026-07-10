import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MultiviewTile from '../components/MultiviewTile'
import { startWhepAudioOnly } from '../utils/whep'

// The composite video goes through a real transcode pipeline (decode, scale,
// pad, stack, re-encode) that the audio-only WHEP connection bypasses — audio
// reaches the browser well ahead of its matching video. A DelayNode holds
// audio back by an adjustable amount to compensate; the right value depends
// on network/encoder conditions so it's a manual control, not a constant.
const DEFAULT_AUDIO_DELAY_MS = 1200

function useAudioSelector(paths) {
  const audioRef = useRef(null)
  const pcRef = useRef(null)
  const audioCtxRef = useRef(null)
  const delayNodeRef = useRef(null)
  const [selected, setSelected] = useState('')
  const [status, setStatus] = useState('idle') // idle | connecting | live | error
  const [delayMs, setDelayMs] = useState(DEFAULT_AUDIO_DELAY_MS)

  // Lazily build the delay graph and route the <audio> element's output
  // through it. Must happen inside a user-gesture call stack (the <select>'s
  // onChange) or the AudioContext stays suspended under autoplay policy.
  const ensureAudioGraph = () => {
    if (audioCtxRef.current || !audioRef.current) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const source = ctx.createMediaElementSource(audioRef.current)
    const delay = ctx.createDelay(10)
    delay.delayTime.value = delayMs / 1000
    source.connect(delay)
    delay.connect(ctx.destination)
    audioCtxRef.current = ctx
    delayNodeRef.current = delay
    audioRef.current.muted = true // playback goes through the graph instead
  }

  useEffect(() => {
    if (delayNodeRef.current) delayNodeRef.current.delayTime.value = delayMs / 1000
  }, [delayMs])

  const selectStream = (path) => {
    ensureAudioGraph()
    audioCtxRef.current?.resume().catch(() => {})
    setSelected(path)
  }

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

  return { audioRef, selected, selectStream, status, delayMs, setDelayMs }
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

  const { audioRef, selected, selectStream, status: audioStatus, delayMs, setDelayMs } = useAudioSelector(paths)

  useEffect(() => {
    if (paths.length === 0) return
    let alive = true
    let retryTimer = null

    const requestJob = async () => {
      try {
        const res = await fetch('/api/multiview/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (alive) {
          setJobId(data.job_id)
          setJobError(null)
        }
      } catch (e) {
        if (!alive) return
        setJobError(e.message || 'failed to start composite')
        retryTimer = setTimeout(requestJob, 5000)
      }
    }

    requestJob()
    // Re-assert the job periodically — ensure_job is a no-op if it's already
    // running, but transparently restarts it if the ffmpeg process died, so
    // the page recovers on its own instead of needing a reload.
    const healthTimer = setInterval(requestJob, 15000)

    return () => {
      alive = false
      clearTimeout(retryTimer)
      clearInterval(healthTimer)
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
  // real screen regardless of browser chrome/viewport quirks — same pattern
  // PlayerPage uses, and containerRef must wrap only the video box (not the
  // page background) or the fullscreened element stretches to the screen
  // without preserving its own aspect ratio.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  return (
    <div className="min-h-screen w-screen bg-[#0a0a0f] flex items-center justify-center p-3">
      <div
        ref={containerRef}
        className={isFullscreen
          ? 'relative w-screen h-screen bg-black flex items-center justify-center'
          : 'relative w-full max-w-6xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl'}
      >
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

        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 gap-3
          bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <span className="text-sm text-white/80 font-mono truncate pointer-events-none">
            Multiviewer — {paths.length} stream{paths.length !== 1 ? 's' : ''}
          </span>

          <div className="flex items-center gap-3 shrink-0 pointer-events-auto">
            {paths.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Audio:</span>
                <select
                  value={selected}
                  onChange={(e) => selectStream(e.target.value)}
                  className="text-xs bg-black/60 border border-white/20 text-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500/50"
                >
                  <option value="">Muted</option>
                  {paths.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                {selected && (
                  <>
                    <span className={`w-2 h-2 rounded-full ${
                      audioStatus === 'live' ? 'bg-green-500' : audioStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
                    }`} title={audioStatus} />
                    <div className="flex items-center gap-1" title="Audio delay — compensates for the composite video's extra transcode latency">
                      <button
                        onClick={() => setDelayMs((d) => Math.max(0, d - 100))}
                        className="w-5 h-5 flex items-center justify-center rounded bg-white/10 text-white/70 hover:bg-white/20 text-xs"
                      >−</button>
                      <span className="text-xs text-gray-400 w-14 text-center font-mono">{delayMs}ms</span>
                      <button
                        onClick={() => setDelayMs((d) => Math.min(10000, d + 100))}
                        className="w-5 h-5 flex items-center justify-center rounded bg-white/10 text-white/70 hover:bg-white/20 text-xs"
                      >+</button>
                    </div>
                  </>
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

        {/* Always muted directly — actual output is routed through the Web
            Audio delay graph in useAudioSelector, straight to speakers. */}
        <audio ref={audioRef} muted autoPlay />
      </div>
    </div>
  )
}
