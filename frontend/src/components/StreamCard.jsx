import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { Play, Users, MonitorPlay } from 'lucide-react'
import { startRecording, stopRecording } from '../api/client'
import { startWhep } from '../utils/whep'
import StatusDot from './ui/StatusDot'

function CardThumbnail({ whepUrl, onLatency }) {
  const videoRef = useRef(null)
  const pcRef = useRef(null)
  const containerRef = useRef(null)
  const retryTimer = useRef(null)
  const statsTimer = useRef(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  const pollStats = async (pc) => {
    if (!pc || pc.connectionState !== 'connected') return
    try {
      const report = await pc.getStats()
      let jitterMs = null, rttMs = null, decodeMs = null
      report.forEach(s => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          if (s.jitterBufferEmittedCount > 0)
            jitterMs = (s.jitterBufferDelay / s.jitterBufferEmittedCount) * 1000
          if (s.framesDecoded > 0)
            decodeMs = (s.totalDecodeTime / s.framesDecoded) * 1000
        }
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.currentRoundTripTime != null)
          rttMs = s.currentRoundTripTime * 1000
      })
      if (jitterMs != null && rttMs != null) {
        const est = Math.round(35 + rttMs / 2 + jitterMs + (decodeMs ?? 2))
        onLatency?.(est)
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    let alive = true

    const connect = async () => {
      clearTimeout(retryTimer.current)
      clearInterval(statsTimer.current)
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null }
      if (!alive || !videoRef.current) return
      setError(null)

      try {
        const pc = await startWhep(whepUrl, videoRef.current)
        if (!alive) { pc.close(); return }
        pcRef.current = pc
        statsTimer.current = setInterval(() => pollStats(pc), 2000)

        pc.addEventListener('connectionstatechange', () => {
          if (!alive) return
          const s = pc.connectionState
          if (s === 'failed') {
            setLoaded(false)
            setError('reconnecting…')
            clearInterval(statsTimer.current)
            onLatency?.(null)
            retryTimer.current = setTimeout(connect, 4000)
          } else if (s === 'disconnected') {
            setLoaded(false)
            clearInterval(statsTimer.current)
            onLatency?.(null)
            retryTimer.current = setTimeout(connect, 3000)
          }
        })
      } catch (e) {
        if (!alive) return
        setError(e.message)
        retryTimer.current = setTimeout(connect, 5000)
      }
    }

    const video = videoRef.current
    const onPlaying = () => { if (alive) { setLoaded(true); setError(null) } }
    video?.addEventListener('playing', onPlaying)

    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !pcRef.current) connect() },
      { threshold: 0.1 }
    )
    if (containerRef.current) obs.observe(containerRef.current)

    return () => {
      alive = false
      obs.disconnect()
      clearTimeout(retryTimer.current)
      clearInterval(statsTimer.current)
      video?.removeEventListener('playing', onPlaying)
      pcRef.current?.close()
      pcRef.current = null
    }
  }, [whepUrl])

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        muted
        playsInline
        style={{ display: loaded ? 'block' : 'none' }}
      />
      {!loaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2">
          <Play size={30} className="text-brand-400/40 shrink-0" fill="currentColor" />
          {error && (
            <span className="text-[9px] text-red-400/80 font-mono text-center leading-tight break-all">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function PulsingDot({ live }) {
  return <StatusDot tone={live ? 'good' : 'muted'} pulse={live} size={8} />
}

function MiniSparkline({ data }) {
  if (!data || data.length === 0) return null
  const points = data.map((v, i) => ({ i, v }))
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke="#818cf8"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="text-xs bg-surface-700 text-brand-300 px-2 py-1 rounded border border-surface-600">
                {(payload[0].value / 1000).toFixed(1)} Mbps
              </div>
            ) : null
          }
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function StreamCard({ stream, onPreview, sparklineData }) {
  const [hovered, setHovered] = useState(false)
  const [latencyMs, setLatencyMs] = useState(null)
  const queryClient = useQueryClient()

  const isLive = stream.ready === true
  const isRecording = stream.recording === true
  const bitrateMbps = stream.bitrate_kbps ? (stream.bitrate_kbps / 1000).toFixed(2) : '—'
  const rtt = stream.rtt_ms != null ? stream.rtt_ms.toFixed(0) : '—'
  const loss = stream.packet_loss_pct != null ? stream.packet_loss_pct.toFixed(2) : '—'

  const whepUrl = `/api/whep/${stream.path}/whep`

  const recMutation = useMutation({
    mutationFn: isRecording
      ? () => stopRecording(stream.path)
      : () => startRecording(stream.path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streams'] }),
  })

  return (
    <div
      className={`relative flex flex-col bg-surface-800 border rounded-xl overflow-hidden transition-all duration-200
        ${hovered ? 'border-brand-500/60 shadow-lg shadow-brand-900/20' : 'border-surface-600'}
      `}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail / preview area */}
      <div className="relative w-full aspect-video bg-surface-750 flex items-center justify-center overflow-hidden">
        {isLive ? (
          <CardThumbnail whepUrl={whepUrl} onLatency={setLatencyMs} />
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-600">
            <MonitorPlay size={30} strokeWidth={1.5} />
            <span className="text-xs">No Signal</span>
          </div>
        )}

        {/* Status badge overlay */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-black/60 backdrop-blur-sm">
          <PulsingDot live={isLive} />
          <span className={isLive ? 'text-emerald-400' : 'text-gray-400'}>
            {isLive ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        {/* Recording badge */}
        {isRecording && (
          <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-600/80 backdrop-blur-sm text-white">
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            REC
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-2 p-3">
        {/* Stream name */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-bold text-white text-sm leading-tight truncate" title={stream.name}>
            {stream.name || stream.path}
          </h3>
          {stream.readers != null && (
            <span className="shrink-0 text-xs text-gray-400 flex items-center gap-1">
              <Users size={13} />
              {stream.readers}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1 text-center">
          <div className="flex flex-col bg-surface-900 rounded-lg py-1.5 px-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Bitrate</span>
            <span className="text-xs font-mono font-semibold text-gray-200">{bitrateMbps} <span className="text-gray-500 font-normal">Mbps</span></span>
          </div>
          <div className="flex flex-col bg-surface-900 rounded-lg py-1.5 px-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Latency</span>
            {latencyMs != null ? (
              <span className={`text-xs font-mono font-semibold ${latencyMs <= 500 ? 'text-emerald-400' : latencyMs <= 800 ? 'text-amber-400' : 'text-red-400'}`}>
                ~{latencyMs} <span className="text-gray-500 font-normal">ms</span>
              </span>
            ) : (
              <span className="text-xs font-mono font-semibold text-gray-600">— <span className="text-gray-700 font-normal">ms</span></span>
            )}
          </div>
          <div className="flex flex-col bg-surface-900 rounded-lg py-1.5 px-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Loss</span>
            <span className={`text-xs font-mono font-semibold ${parseFloat(loss) > 0.5 ? 'text-red-400' : 'text-gray-200'}`}>
              {loss} <span className="text-gray-500 font-normal">%</span>
            </span>
          </div>
        </div>

        {/* Sparkline */}
        {sparklineData && sparklineData.length > 1 && (
          <div className="w-full">
            <MiniSparkline data={sparklineData} />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => recMutation.mutate()}
            disabled={!isLive || recMutation.isPending}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors
              ${!isLive
                ? 'bg-surface-700/50 text-gray-600 cursor-not-allowed'
                : isRecording
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-surface-700 hover:bg-surface-600 text-gray-300 border border-surface-500'
              }
            `}
          >
            <span className={`w-2 h-2 rounded-full ${isRecording ? 'bg-white animate-pulse' : 'bg-gray-500'}`} />
            {isRecording ? 'Stop Rec' : 'Record'}
          </button>
          <button
            onClick={() => onPreview && onPreview(stream)}
            disabled={!isLive}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors
              ${!isLive
                ? 'bg-surface-700/50 text-gray-600 border-surface-600 cursor-not-allowed'
                : 'bg-surface-700 hover:bg-brand-600/20 text-brand-400 border-brand-500/30 hover:border-brand-500/60'
              }
            `}
          >
            <Play size={12} fill="currentColor" />
            Preview
          </button>
        </div>
      </div>

      {/* Hover detail: stream path */}
      {hovered && stream.path && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm px-3 py-1.5 text-[10px] font-mono text-gray-400 border-t border-surface-600 truncate">
          {stream.source_address || stream.path}
        </div>
      )}
    </div>
  )
}
