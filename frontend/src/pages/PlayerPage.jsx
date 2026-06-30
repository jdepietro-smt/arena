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
  const [muted, setMuted] = useState(true)
  const [hasAudio, setHasAudio] = useState(false)

  const whepUrl = `/api/whep/${streamName}/whep`

  // Keep DOM muted state in sync — do NOT use the muted JSX prop because
  // React re-applies it on every render and overwrites the DOM property.
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  const toggleMute = () => setMuted(m => !m)

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
      setHasAudio(false)

      try {
        const pc = await startWhep(whepUrl, videoRef.current)
        if (!alive) { pc.close(); return }
        pcRef.current = pc

        // Detect whether the stream actually contains an audio track
        pc.ontrack = ({ track, streams }) => {
          if (track.kind === 'audio') setHasAudio(true)
          // Re-attach stream in case startWhep already set it
          if (streams[0] && videoRef.current && videoRef.current.srcObject !== streams[0]) {
            videoRef.current.srcObject = streams[0]
            videoRef.current.play().catch(() => {})
          }
        }

        setStatus('live')
        statsRef.current = setInterval(() => pollStats(pc), 2000)

        pc.addEventListener('connectionstatechange', () => {
          if (!alive) return
          const s = pc.connectionState
          if (s === 'failed') {
            setStatus('reconnecting'); setLatencyMs(null); setHasAudio(false)
            clearInterval(statsRef.current)
            retryRef.current = setTimeout(connect, 4000)
          } else if (s === 'disconnected') {
            setStatus('reconnecting'); setLatencyMs(null); setHasAudio(false)
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
      // Start muted via DOM property (not JSX prop) so React can't override it
      video.muted = true
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
      {/* Video — no muted prop; controlled via DOM ref only */}
      <video
        ref={videoRef}
        className="flex-1 w-full object-contain"
        playsInline
        autoPlay
      />

      {/* Bottom overlay */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-3
        bg-gradient-to-t from-black/80 to-transparent">
        <div className="flex items-center gap-3 pointer-events-none">
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
            isLive ? 'bg-green-500/20 text-green-400 border-green-500/40'
            : (status === 'connecting' || status === 'reconnecting')
              ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40'
              : 'bg-gray-500/20 text-gray-400 border-gray-500/40'
          }`}>
            {isLive ? 'LIVE' : status === 'connecting' ? 'CONNECTING…' : status === 'reconnecting' ? 'RECONNECTING…' : 'OFFLINE'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {latencyMs != null && (
            <span className={`text-xs font-mono pointer-events-none ${latencyMs <= 500 ? 'text-green-400' : latencyMs <= 800 ? 'text-yellow-400' : 'text-red-400'}`}>
              ~{latencyMs}ms
            </span>
          )}

          {/* Audio control */}
          {isLive && !hasAudio ? (
            // Stream has no audio track at all
            <span className="text-xs text-gray-600 font-mono px-3 py-1.5 bg-black/40 rounded-lg border border-white/10">
              No audio in stream
            </span>
          ) : (
            <button
              onClick={toggleMute}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
                ${muted
                  ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 hover:bg-yellow-500/30'
                  : 'bg-white/10 text-white/80 border border-white/20 hover:bg-white/20'
                }`}
            >
              {muted ? (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                  Unmute
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                      d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  Mute
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Waiting overlay */}
      {!isLive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
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
