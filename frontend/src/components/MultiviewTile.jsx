import { useEffect, useRef, useState } from 'react'
import { startWhep } from '../utils/whep'

export const GRID_COLS = {
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

export function gridColsClassFor(count) {
  return GRID_COLS[Math.min(count, 9)] || GRID_COLS[9]
}

export default function MultiviewTile({ path, label, fill = false, showLabel = true, muted = true }) {
  const videoRef = useRef(null)
  const pcRef = useRef(null)
  const retryTimer = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  const whepUrl = `/api/whep/${path}/whep`

  // Set imperatively via ref, not the JSX muted attribute — React re-applies
  // JSX attributes on every render and would fight a later imperative change
  // (same gotcha PlayerPage's mute toggle already ran into).
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

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
    <div className={`relative w-full bg-black rounded-lg overflow-hidden ${fill ? 'h-full' : 'aspect-video'}`}>
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        autoPlay
        playsInline
        style={{ display: loaded ? 'block' : 'none' }}
      />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center px-2 text-center">
          <span className="text-xs text-gray-500">{error ? 'Waiting for stream…' : 'Connecting…'}</span>
        </div>
      )}
      {showLabel && (
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-black/60 backdrop-blur-sm text-white">
          <span className={`w-2 h-2 rounded-full ${loaded ? 'bg-green-500' : 'bg-gray-500'}`} />
          {label || path}
        </div>
      )}
    </div>
  )
}
