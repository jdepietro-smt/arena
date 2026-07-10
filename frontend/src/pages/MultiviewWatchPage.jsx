import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MultiviewTile, { gridColsClassFor } from '../components/MultiviewTile'

function YoutubeTile({ videoId }) {
  return (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      <iframe
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`}
        className="w-full h-full"
        title={videoId}
        frameBorder="0"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}

export default function MultiviewWatchPage() {
  const [searchParams] = useSearchParams()
  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [jobError, setJobError] = useState(null)
  const [audioPath, setAudioPath] = useState('')
  const [muted, setMuted] = useState(true)

  const paths = (searchParams.get('streams') || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const youtubeIds = (searchParams.get('youtube') || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  // Grid mode (composited SDI tile + separate YouTube iframe tiles) only
  // kicks in once a YouTube embed is actually present — a pure-SDI link
  // keeps the original single full-bleed composited video untouched.
  const gridMode = youtubeIds.length > 0
  const totalCells = (paths.length > 0 ? 1 : 0) + youtubeIds.length
  const gridColsClass = gridColsClassFor(totalCells || 1)

  // Deselect if the chosen audio source drops out of the current stream list.
  useEffect(() => {
    if (audioPath && !paths.includes(audioPath)) setAudioPath('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('streams')])

  // Switching audio means requesting a different composite job — rather than
  // unmounting the current video while the new one spins up (a blank/
  // "Compositing…" flash every time), keep every requested job mounted,
  // stacked with older ones on top, until the newest signals it's actually
  // playing — then drop everything older in one step, no visible gap.
  const [layers, setLayers] = useState([]) // [{ jobId }], oldest first
  useEffect(() => {
    if (!jobId) return
    setLayers((prev) => (prev.some((l) => l.jobId === jobId) ? prev : [...prev, { jobId }]))
  }, [jobId])

  const promoteLayer = (readyJobId) => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.jobId === readyJobId)
      // only prune if this is the newest layer — an older one finishing its
      // (re)connect after a newer request has already superseded it shouldn't
      // jump back to the front.
      if (idx === -1 || idx !== prev.length - 1) return prev
      return [prev[idx]]
    })
  }

  useEffect(() => {
    if (paths.length === 0) return
    let alive = true
    let retryTimer = null

    const requestJob = async () => {
      try {
        const res = await fetch('/api/multiview/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths, audio_path: audioPath || null }),
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
  }, [searchParams.get('streams'), audioPath])

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

  const sdiCell = paths.length === 0 ? null : jobError ? (
    <div className="w-full h-full flex items-center justify-center text-red-400 text-sm bg-black rounded-lg">
      Could not start composite: {jobError} — retrying…
    </div>
  ) : layers.length === 0 ? (
    <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm bg-black rounded-lg">
      Compositing streams…
    </div>
  ) : (
    <div className="relative w-full h-full bg-black rounded-lg overflow-hidden">
      {layers.map((l, i) => (
        <div key={l.jobId} className="absolute inset-0" style={{ zIndex: layers.length - i }}>
          <MultiviewTile
            path={l.jobId}
            fill
            showLabel={false}
            muted={muted}
            onReady={() => promoteLayer(l.jobId)}
          />
        </div>
      ))}
    </div>
  )

  return (
    <div className="min-h-screen w-screen bg-[#0a0a0f] flex items-center justify-center p-3">
      <div
        ref={containerRef}
        className={isFullscreen
          ? 'relative w-screen h-screen bg-black flex items-center justify-center'
          : 'relative w-full max-w-6xl aspect-video bg-black rounded-xl overflow-hidden shadow-2xl'}
      >
        {paths.length === 0 && youtubeIds.length === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
            No streams specified — add ?streams=path1,path2 and/or ?youtube=videoId to the URL.
          </div>
        ) : gridMode ? (
          <div className={`absolute inset-0 grid ${gridColsClass} content-start gap-2 p-2`}>
            {sdiCell}
            {youtubeIds.map((id) => (
              <YoutubeTile key={id} videoId={id} />
            ))}
          </div>
        ) : (
          sdiCell
        )}

        <div className="absolute top-0 left-0 right-0 z-[100] flex items-center justify-between px-4 py-3 gap-3
          bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <span className="text-sm text-white/80 font-mono truncate pointer-events-none">
            Multiviewer — {paths.length} stream{paths.length !== 1 ? 's' : ''}
            {youtubeIds.length > 0 && `, ${youtubeIds.length} YouTube`}
          </span>

          <div className="flex items-center gap-3 shrink-0 pointer-events-auto">
            {paths.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Audio:</span>
                <select
                  value={audioPath}
                  onChange={(e) => {
                    setAudioPath(e.target.value)
                    setMuted(!e.target.value)
                  }}
                  className="text-xs bg-black/60 border border-white/20 text-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500/50"
                >
                  <option value="">Muted</option>
                  {paths.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            )}

            {audioPath && (
              <button
                onClick={() => setMuted((m) => !m)}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-xs font-semibold transition-colors
                  bg-white/10 text-white/80 border border-white/20 hover:bg-white/20"
                title={muted ? 'Unmute' : 'Mute'}
              >
                {muted ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                      d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                )}
              </button>
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
      </div>
    </div>
  )
}
