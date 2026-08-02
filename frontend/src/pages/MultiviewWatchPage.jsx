import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MultiviewTile from '../components/MultiviewTile'

// Mirrors backend/services/compositor.py's _grid(): smallest near-square
// cols x rows with cols*rows >= n. Must stay identical to that function —
// the server bakes its own black filler cells into the composited video
// using this exact math, and YouTube tiles are overlaid client-side on top
// of wherever that grid says the reserved cells landed.
function computeGrid(n) {
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return [cols, rows]
}

function cellRect(index, cols, rows) {
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    left: `${(col / cols) * 100}%`,
    top: `${(row / rows) * 100}%`,
    width: `${(1 / cols) * 100}%`,
    height: `${(1 / rows) * 100}%`,
  }
}

const YT_AUDIO_PREFIX = 'yt:'

// Loaded once globally — every YoutubeTile shares the same API script/promise.
let ytApiPromise = null
function loadYoutubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(window.YT)
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return ytApiPromise
}

function useYoutubeApiReady() {
  const [ready, setReady] = useState(!!window.YT?.Player)
  useEffect(() => {
    if (ready) return
    let cancelled = false
    loadYoutubeApi().then(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [ready])
  return ready
}

// Wraps the iframe with the YouTube IFrame Player API (enablejsapi=1) so the
// audio dropdown can mute/unmute it directly, in place — reloading the
// iframe's src to toggle mute would restart playback from the beginning.
function YoutubeTile({ videoId, label, style, active, registerPlayer }) {
  const iframeId = `yt-tile-${videoId}`
  const apiReady = useYoutubeApiReady()
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (!apiReady) return
    const player = new window.YT.Player(iframeId, {
      events: {
        onReady: (e) => {
          registerPlayer(videoId, e.target)
          if (activeRef.current) e.target.unMute()
          else e.target.mute()
        },
      },
    })
    return () => {
      try { player.destroy?.() } catch { /* ignore */ }
      registerPlayer(videoId, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady, videoId])

  return (
    <div className="absolute bg-black overflow-hidden" style={{ ...style, zIndex: 50 }}>
      <iframe
        id={iframeId}
        src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&enablejsapi=1&playsinline=1&origin=${window.location.origin}`}
        className="w-full h-full"
        title={label || videoId}
        frameBorder="0"
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
      <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-black/60 backdrop-blur-sm text-white pointer-events-none">
        <span className="w-2 h-2 rounded-full bg-emerald-500" />
        {label || videoId}
      </div>
    </div>
  )
}

export default function MultiviewWatchPage() {
  const [searchParams] = useSearchParams()
  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [jobError, setJobError] = useState(null)
  // '' (muted), a plain SDI path, or `yt:<videoId>` — one control for every
  // feed, SDI or YouTube, instead of separate mute switches per tile.
  const [activeAudio, setActiveAudio] = useState('')

  const paths = (searchParams.get('streams') || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const youtubeIds = (searchParams.get('youtube') || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const youtubeLabels = (searchParams.get('ytLabels') || '')
    .split(',')
    .map((l) => {
      try {
        return decodeURIComponent(l)
      } catch {
        return l
      }
    })

  const audioPath = paths.includes(activeAudio) ? activeAudio : ''
  const activeYoutubeId = activeAudio.startsWith(YT_AUDIO_PREFIX) ? activeAudio.slice(YT_AUDIO_PREFIX.length) : null
  const compositeMuted = !audioPath

  // Same grid the backend computed the composite with: real streams first,
  // then any genuinely-wasted rounding cells, then one reserved cell per
  // YouTube embed — always last, i.e. bottom-right-most in the grid.
  const needed = paths.length + youtubeIds.length
  const [cols, rows] = computeGrid(Math.max(needed, 1))
  const capacity = cols * rows
  const wasted = capacity - needed
  const youtubeRects = youtubeIds.map((id, i) => ({
    id,
    label: youtubeLabels[i] || id,
    rect: cellRect(paths.length + wasted + i, cols, rows),
  }))

  const ytPlayersRef = useRef({}) // videoId -> YT.Player
  const registerPlayer = (videoId, player) => {
    if (player) ytPlayersRef.current[videoId] = player
    else delete ytPlayersRef.current[videoId]
  }

  // Whenever the selection changes, sync every already-ready YouTube player
  // (new players apply the current selection themselves in onReady).
  useEffect(() => {
    Object.entries(ytPlayersRef.current).forEach(([id, player]) => {
      if (!player?.mute) return
      if (id === activeYoutubeId) player.unMute()
      else player.mute()
    })
  }, [activeYoutubeId])

  // Deselect if the chosen audio source drops out of the current selection.
  useEffect(() => {
    if (activeAudio && !audioPath && activeYoutubeId && !youtubeIds.includes(activeYoutubeId)) {
      setActiveAudio('')
    } else if (activeAudio && !audioPath && !activeYoutubeId) {
      setActiveAudio('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.get('streams'), searchParams.get('youtube')])

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
          body: JSON.stringify({ paths, audio_path: audioPath || null, blank_slots: youtubeIds.length }),
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
  }, [searchParams.get('streams'), searchParams.get('youtube'), audioPath])

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

  const sdiLayer = paths.length === 0 ? null : jobError ? (
    <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm bg-black">
      Could not start composite: {jobError} — retrying…
    </div>
  ) : layers.length === 0 ? (
    <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-sm bg-black">
      Compositing streams…
    </div>
  ) : (
    layers.map((l, i) => (
      <div key={l.jobId} className="absolute inset-0" style={{ zIndex: layers.length - i }}>
        <MultiviewTile
          path={l.jobId}
          fill
          showLabel={false}
          muted={compositeMuted}
          onReady={() => promoteLayer(l.jobId)}
        />
      </div>
    ))
  )

  return (
    <div className="min-h-screen w-screen bg-surface-900 flex items-center justify-center p-3">
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
        ) : (
          <div className="absolute inset-0">
            {/* One full-bleed composited video (or placeholder) underneath —
                it already has black cells baked in exactly where the
                YouTube overlays below land, via the same grid math. */}
            {sdiLayer}
            {youtubeRects.map(({ id, label, rect }) => (
              <YoutubeTile
                key={id}
                videoId={id}
                label={label}
                style={rect}
                active={activeYoutubeId === id}
                registerPlayer={registerPlayer}
              />
            ))}
          </div>
        )}

        <div className="absolute top-0 left-0 right-0 z-[100] flex items-center justify-between px-4 py-3 gap-3
          bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
          <span className="text-sm text-white/80 font-mono truncate pointer-events-none">
            Multiviewer — {paths.length} stream{paths.length !== 1 ? 's' : ''}
            {youtubeIds.length > 0 && `, ${youtubeIds.length} YouTube`}
          </span>

          <div className="flex items-center gap-3 shrink-0 pointer-events-auto">
            {(paths.length > 0 || youtubeIds.length > 0) && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Audio:</span>
                <select
                  value={activeAudio}
                  onChange={(e) => setActiveAudio(e.target.value)}
                  className="text-xs bg-black/60 border border-white/20 text-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-brand-500/50"
                >
                  <option value="">Muted</option>
                  {paths.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                  {youtubeRects.map(({ id, label }) => (
                    <option key={id} value={`${YT_AUDIO_PREFIX}${id}`}>{label}</option>
                  ))}
                </select>
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
      </div>
    </div>
  )
}
