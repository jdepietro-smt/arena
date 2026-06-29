import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Hls from 'hls.js'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { startRecording, stopRecording } from '../api/client'

function CardThumbnail({ hlsUrl }) {
  const videoRef = useRef(null)
  const hlsRef = useRef(null)
  const containerRef = useRef(null)
  const retryTimer = useRef(null)
  const [loaded, setLoaded] = useState(false)

  const startHls = () => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null }
    if (!videoRef.current) return
    const hls = new Hls({ maxBufferLength: 4, liveSyncDurationCount: 2 })
    hlsRef.current = hls
    hls.loadSource(hlsUrl)
    hls.attachMedia(videoRef.current)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      videoRef.current?.play().catch(() => {})
      setLoaded(true)
    })
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (data.fatal) {
        hls.destroy()
        hlsRef.current = null
        setLoaded(false)
        retryTimer.current = setTimeout(startHls, 5000)
      }
    })
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting && !hlsRef.current) startHls() },
      { threshold: 0.1 }
    )
    obs.observe(container)
    return () => {
      obs.disconnect()
      clearTimeout(retryTimer.current)
      hlsRef.current?.destroy()
      hlsRef.current = null
    }
  }, [hlsUrl])

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
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-10 h-10 text-indigo-400/40" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      )}
    </div>
  )
}

function PulsingDot({ live }) {
  if (!live) return <span className="w-2 h-2 rounded-full bg-gray-500 inline-block" />
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
    </span>
  )
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
          stroke="#6366f1"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={({ active, payload }) =>
            active && payload?.length ? (
              <div className="text-xs bg-[#1a1a2e] text-indigo-300 px-2 py-1 rounded border border-[#222233]">
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
  const queryClient = useQueryClient()

  const isLive = stream.ready === true
  const isRecording = stream.recording === true
  const bitrateMbps = stream.bitrate_kbps ? (stream.bitrate_kbps / 1000).toFixed(2) : '—'
  const rtt = stream.rtt_ms != null ? stream.rtt_ms.toFixed(0) : '—'
  const loss = stream.packet_loss_pct != null ? stream.packet_loss_pct.toFixed(2) : '—'

  const recMutation = useMutation({
    mutationFn: isRecording
      ? () => stopRecording(stream.path)
      : () => startRecording(stream.path),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streams'] }),
  })

  return (
    <div
      className={`relative flex flex-col bg-[#111118] border rounded-xl overflow-hidden transition-all duration-200
        ${hovered ? 'border-indigo-500/60 shadow-lg shadow-indigo-900/20' : 'border-[#222233]'}
      `}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Thumbnail / preview area */}
      <div className="relative w-full aspect-video bg-[#0d0d15] flex items-center justify-center overflow-hidden">
        {isLive ? (
          <CardThumbnail hlsUrl={`/api/hls/${stream.path}/index.m3u8`} />
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-600">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="2" y="4" width="20" height="16" rx="2" strokeWidth="1.5" />
              <path d="M10 9l5 3-5 3V9z" strokeWidth="1.5" />
            </svg>
            <span className="text-xs">No Signal</span>
          </div>
        )}

        {/* Status badge overlay */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-black/60 backdrop-blur-sm">
          <PulsingDot live={isLive} />
          <span className={isLive ? 'text-green-400' : 'text-gray-400'}>
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
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              {stream.readers}
            </span>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-1 text-center">
          <div className="flex flex-col bg-[#0a0a0f] rounded-lg py-1.5 px-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">Bitrate</span>
            <span className="text-xs font-mono font-semibold text-gray-200">{bitrateMbps} <span className="text-gray-500 font-normal">Mbps</span></span>
          </div>
          <div className="flex flex-col bg-[#0a0a0f] rounded-lg py-1.5 px-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">RTT</span>
            <span className={`text-xs font-mono font-semibold ${parseFloat(rtt) > 100 ? 'text-yellow-400' : 'text-gray-200'}`}>
              {rtt} <span className="text-gray-500 font-normal">ms</span>
            </span>
          </div>
          <div className="flex flex-col bg-[#0a0a0f] rounded-lg py-1.5 px-1">
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
                ? 'bg-[#1a1a1a] text-gray-600 cursor-not-allowed'
                : isRecording
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-[#1e1e2e] hover:bg-[#2a2a3e] text-gray-300 border border-[#333344]'
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
                ? 'bg-[#1a1a1a] text-gray-600 border-[#222233] cursor-not-allowed'
                : 'bg-[#1e1e2e] hover:bg-indigo-600/20 text-indigo-400 border-indigo-500/30 hover:border-indigo-500/60'
              }
            `}
          >
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
            Preview
          </button>
        </div>
      </div>

      {/* Hover detail: stream path */}
      {hovered && stream.path && (
        <div className="absolute bottom-0 left-0 right-0 bg-black/80 backdrop-blur-sm px-3 py-1.5 text-[10px] font-mono text-gray-400 border-t border-[#222233] truncate">
          {stream.source_address || stream.path}
        </div>
      )}
    </div>
  )
}
