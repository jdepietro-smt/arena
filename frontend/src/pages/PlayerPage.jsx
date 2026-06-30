import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { startWhep } from '../utils/whep'

export default function PlayerPage() {
  const { streamName } = useParams()
  const videoRef = useRef(null)
  const pcRef = useRef(null)
  const retryRef = useRef(null)
  const statsRef = useRef(null)
  const [status, setStatus] = useState('connecting')
  const [latencyMs, setLatencyMs] = useState(null)

  const whepUrl = `/api/whep/${streamName}/whep`

  const pollStats = async (pc) => {
    if (!pc || pc.connectionState !== 'connected') return
    try {
      const report = await pc.getStats()
      let jitter = null, rtt = null, decode = null
      report.forEach(s => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          if (s.jitterBufferEmittedCount > 0)
            jitter = (s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000
          if (s.framesDecoded > 0)
            decode = (s.totalDecodeTime / s.framesDecoded) * 1000
        }
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null)
          rtt = s.currentRoundTripTime * 1000
      })
      if (jitter != null && rtt != null)
        setLatencyMs(Math.round(35 + rtt / 2 + jitter + (decode ?? 2)))
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let alive = true

    const connect = async () => {
      clearTimeout(retryRef.current)
      clearInterval(statsRef.current)
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
      if (!alive || !videoRef.current) return
      setStatus('connecting')

      try {
        const pc = await startWhep(whepUrl, videoRef.current)
        if (!alive) { pc.close(); return }
        pcRef.current = pc
        setStatus('live')
        statsRef.current = setInterval(() => pollStats(pc), 2000)

        pc.addEventListener('connectionstatechange', () => {
          if (!alive) return
          const s = pc.connectionState
          if (s === 'failed') {
            setStatus('reconnecting')
            setLatencyMs(null)
            clearInterval(statsRef.current)
            retryRef.current = setTimeout(connect, 4000)
          } else if (s === 'disconnected') {
            setStatus('reconnecting')
            setLatencyMs(null)
            clearInterval(statsRef.current)
            retryRef.current = setTimeout(connect, 3000)
          }
        })
      } catch (e) {
        if (!alive) return
        setStatus('offline')
        retryRef.current = setTimeout(connect, 5000)
      }
    }

    const video = videoRef.current
    if (video) {
      video.addEventListener('playing', () => { if (alive) setStatus('live') })
    }

    connect()

    return () => {
      alive = false
      clearTimeout(retryRef.current)
      clearInterval(statsRef.current)
      pcRef.current?.close()
      pcRef.current = null
    }
  }, [whepUrl])

  const isLive = status === 'live'

  return (
    <div className="fixed inset-0 bg-black flex flex-col">
      {/* Video fills all space */}
      <video
        ref={videoRef}
        className="flex-1 w-full object-contain"
        muted
        playsInline
        autoPlay
      />

      {/* Overlay bar at bottom */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3
        bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <div className="flex items-center gap-3">
          {/* Status dot */}
          {isLive ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
            </span>
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-gray-500" />
          )}
          <span className="text-white font-semibold text-sm tracking-wide">{streamName}</span>
          <span className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
            isLive
              ? 'bg-green-500/20 text-green-400 border-green-500/40'
              : status === 'connecting' || status === 'reconnecting'
                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
                : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
          }`}>
            {status === 'live' ? 'LIVE' : status === 'connecting' ? 'CONNECTING…' : status === 'reconnecting' ? 'RECONNECTING…' : 'OFFLINE'}
          </span>
        </div>
        {latencyMs != null && (
          <span className={`text-xs font-mono ${latencyMs <= 500 ? 'text-green-400' : latencyMs <= 800 ? 'text-yellow-400' : 'text-red-400'}`}>
            ~{latencyMs}ms
          </span>
        )}
      </div>

      {/* Waiting overlay when not live */}
      {!isLive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <svg className="w-16 h-16 text-white/10" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
          <p className="text-white/40 text-sm font-mono">
            {status === 'connecting' ? 'Connecting to stream…' : status === 'reconnecting' ? 'Reconnecting…' : 'Stream offline'}
          </p>
        </div>
      )}
    </div>
  )
}
