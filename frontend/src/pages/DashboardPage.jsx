import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getStreams, getStatsSummary } from '../api/client'
import StreamCard from '../components/StreamCard'
import { startWhep } from '../utils/whep'

// ── Skeleton helpers ──────────────────────────────────────────────────────────

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-[#1e1e2e] rounded-lg ${className}`} />
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, unit, accent, icon, loading }) {
  return (
    <div className="bg-[#111118] border border-[#222233] rounded-xl p-4 flex items-center gap-4">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 uppercase tracking-wider truncate">{label}</p>
        {loading ? (
          <Skeleton className="h-6 w-20 mt-1" />
        ) : (
          <p className="text-xl font-bold text-white leading-tight">
            {value}
            {unit && <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Event sidebar ─────────────────────────────────────────────────────────────

const MOCK_EVENTS = [
  { id: 1, type: 'connected',    stream: 'Studio-A-Main',    time: '14:32:01', ago: '2m ago' },
  { id: 2, type: 'disconnected', stream: 'Backup-Feed-3',    time: '14:30:44', ago: '3m ago' },
  { id: 3, type: 'recording',    stream: 'Studio-A-Main',    time: '14:32:05', ago: '2m ago' },
  { id: 4, type: 'connected',    stream: 'Remote-Cam-B',     time: '14:28:11', ago: '6m ago' },
  { id: 5, type: 'warning',      stream: 'Backup-Feed-2',    time: '14:25:58', ago: '8m ago' },
  { id: 6, type: 'disconnected', stream: 'Remote-Cam-A',     time: '14:19:03', ago: '15m ago' },
  { id: 7, type: 'connected',    stream: 'Studio-B-Fill',    time: '14:10:22', ago: '24m ago' },
  { id: 8, type: 'warning',      stream: 'Studio-A-Main',    time: '14:05:09', ago: '29m ago' },
]

const EVENT_META = {
  connected:    { label: 'Connected',    color: 'text-green-400',  dot: 'bg-green-500',  bg: 'bg-green-500/10' },
  disconnected: { label: 'Disconnected', color: 'text-red-400',    dot: 'bg-red-500',    bg: 'bg-red-500/10' },
  recording:    { label: 'Recording',    color: 'text-indigo-400', dot: 'bg-indigo-500', bg: 'bg-indigo-500/10' },
  warning:      { label: 'Warning',      color: 'text-yellow-400', dot: 'bg-yellow-500', bg: 'bg-yellow-500/10' },
}

function EventSidebar() {
  return (
    <aside className="w-[280px] shrink-0 flex flex-col bg-[#111118] border border-[#222233] rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#222233] flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Recent Events</h2>
        <span className="text-xs text-gray-500">{MOCK_EVENTS.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-[#1a1a28]">
        {MOCK_EVENTS.map(ev => {
          const meta = EVENT_META[ev.type] || EVENT_META.warning
          return (
            <div key={ev.id} className="px-4 py-2.5 flex gap-3 items-start hover:bg-[#16161f] transition-colors">
              <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${meta.dot}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-200 truncate">{ev.stream}</p>
                <p className={`text-[11px] ${meta.color}`}>{meta.label}</p>
              </div>
              <span className="text-[10px] text-gray-600 whitespace-nowrap shrink-0 mt-0.5">{ev.ago}</span>
            </div>
          )
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-[#222233]">
        <button className="w-full text-center text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
          View all events
        </button>
      </div>
    </aside>
  )
}

// ── WebRTC latency stats ──────────────────────────────────────────────────────

function useWhepStats(pcRef) {
  const [stats, setStats] = useState(null)

  useEffect(() => {
    const poll = async () => {
      const pc = pcRef.current
      if (!pc || pc.connectionState !== 'connected') return

      const report = await pc.getStats()
      let jitterMs = null, decodeMs = null, rttMs = null

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

      // Glass-to-glass estimate:
      //   encode+capture (~35ms) + SRT one-way (rtt/2) + jitter buffer + decode
      const networkMs = rttMs != null ? rttMs / 2 : null
      const estimated =
        jitterMs != null && networkMs != null
          ? Math.round(35 + networkMs + jitterMs + (decodeMs ?? 2))
          : null

      setStats({
        rttMs: rttMs != null ? Math.round(rttMs) : null,
        jitterMs: jitterMs != null ? Math.round(jitterMs) : null,
        decodeMs: decodeMs != null ? decodeMs.toFixed(1) : null,
        estimated,
      })
    }

    const id = setInterval(poll, 1500)
    return () => clearInterval(id)
  }, [pcRef])

  return stats
}

// ── WebRTC preview player ─────────────────────────────────────────────────────

function WhepPlayer({ url, onPcReady }) {
  const videoRef = useRef(null)
  const pcRef = useRef(null)
  const retryTimer = useRef(null)

  useEffect(() => {
    let alive = true

    const connect = async () => {
      clearTimeout(retryTimer.current)
      if (pcRef.current) { pcRef.current.close(); pcRef.current = null; onPcReady?.(null) }
      if (!alive || !videoRef.current || !url) return

      try {
        const pc = await startWhep(url, videoRef.current)
        if (!alive) { pc.close(); return }
        pcRef.current = pc
        onPcReady?.(pc)
        pc.addEventListener('connectionstatechange', () => {
          if (!alive) return
          const s = pc.connectionState
          if (s === 'failed' || s === 'disconnected') {
            onPcReady?.(null)
            retryTimer.current = setTimeout(connect, 3000)
          }
        })
      } catch {
        retryTimer.current = setTimeout(connect, 5000)
      }
    }

    connect()
    return () => {
      alive = false
      clearTimeout(retryTimer.current)
      pcRef.current?.close()
      pcRef.current = null
      onPcReady?.(null)
    }
  }, [url])

  return (
    <video
      ref={videoRef}
      className="w-full h-full object-contain bg-black"
      controls
      playsInline
      autoPlay
    />
  )
}

// ── Preview modal ─────────────────────────────────────────────────────────────

function LatencyBar({ stats }) {
  if (!stats) {
    return (
      <div className="px-5 py-2.5 border-t border-[#222233] text-xs text-gray-600 font-mono">
        Measuring latency…
      </div>
    )
  }

  const color = stats.estimated == null ? 'text-gray-500'
    : stats.estimated <= 500 ? 'text-green-400'
    : stats.estimated <= 800 ? 'text-yellow-400'
    : 'text-red-400'

  return (
    <div className="px-5 py-2.5 border-t border-[#222233] flex items-center gap-4 text-xs font-mono flex-wrap">
      {stats.estimated != null && (
        <span className={`font-bold text-sm ${color}`}>
          ~{stats.estimated} ms glass-to-glass
        </span>
      )}
      {stats.rttMs != null && (
        <span className="text-gray-500">WebRTC RTT <span className="text-gray-300">{stats.rttMs} ms</span></span>
      )}
      {stats.jitterMs != null && (
        <span className="text-gray-500">jitter buf <span className="text-gray-300">{stats.jitterMs} ms</span></span>
      )}
      {stats.decodeMs != null && (
        <span className="text-gray-500">decode <span className="text-gray-300">{stats.decodeMs} ms</span></span>
      )}
    </div>
  )
}

function PreviewModal({ stream, onClose }) {
  if (!stream) return null
  const whepUrl = `/api/whep/${stream.path}/whep`
  const pcRef = useRef(null)
  const stats = useWhepStats(pcRef)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#111118] border border-[#222233] rounded-xl overflow-hidden w-full max-w-3xl mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#222233]">
          <h3 className="font-semibold text-white">{stream.name || stream.path}</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="aspect-video bg-black">
          <WhepPlayer url={whepUrl} onPcReady={pc => { pcRef.current = pc }} />
        </div>
        <LatencyBar stats={stats} />
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [previewStream, setPreviewStream] = useState(null)

  const { data: streams = [], isLoading: streamsLoading } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  })

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['stats-summary'],
    queryFn: getStatsSummary,
    refetchInterval: 3000,
    refetchIntervalInBackground: true,
  })

  // Derive summary values from streams if summary endpoint not yet populated
  const liveStreams = streams.filter(s => s.ready)
  const totalBitrate = summary?.total_bitrate_kbps
    ?? streams.reduce((acc, s) => acc + (s.bitrate_kbps || 0), 0)
  const recordingCount = summary?.recordings_active
    ?? streams.filter(s => s.recording).length
  const totalViewers = summary?.total_readers
    ?? streams.reduce((acc, s) => acc + (s.readers || 0), 0)

  return (
    <div className="flex flex-col h-full min-h-0 gap-4 p-6 bg-[#0a0a0f]">

      {/* Summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Active Streams"
          value={summaryLoading ? '' : liveStreams.length}
          loading={summaryLoading && streamsLoading}
          accent="bg-green-500/10"
          icon={
            <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3" fill="currentColor" />
              <path strokeLinecap="round" strokeWidth="1.5" d="M5.6 5.6a9 9 0 0112.8 0M8.46 8.46a5 5 0 017.07 0" />
            </svg>
          }
        />
        <StatCard
          label="Total Bitrate"
          value={summaryLoading ? '' : (totalBitrate / 1000).toFixed(1)}
          unit="Mbps"
          loading={summaryLoading && streamsLoading}
          accent="bg-indigo-500/10"
          icon={
            <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          label="Recordings"
          value={summaryLoading ? '' : recordingCount}
          loading={summaryLoading && streamsLoading}
          accent="bg-red-500/10"
          icon={
            <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
            </svg>
          }
        />
        <StatCard
          label="Connected Viewers"
          value={summaryLoading ? '' : totalViewers}
          loading={summaryLoading && streamsLoading}
          accent="bg-sky-500/10"
          icon={
            <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
      </div>

      {/* Content row: stream grid + sidebar */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Stream grid */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {streamsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="bg-[#111118] border border-[#222233] rounded-xl overflow-hidden">
                  <Skeleton className="aspect-video rounded-none" />
                  <div className="p-3 flex flex-col gap-2">
                    <Skeleton className="h-4 w-3/4" />
                    <div className="grid grid-cols-3 gap-1">
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                      <Skeleton className="h-10" />
                    </div>
                    <div className="flex gap-2">
                      <Skeleton className="h-8 flex-1" />
                      <Skeleton className="h-8 flex-1" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : streams.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-3">
              <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1"
                  d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              <p className="text-sm">No streams connected</p>
              <p className="text-xs">Publish an SRT stream to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {streams.map(stream => (
                <StreamCard
                  key={stream.path}
                  stream={stream}
                  onPreview={setPreviewStream}
                  sparklineData={stream.bitrate_history || []}
                />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <EventSidebar />
      </div>

      {/* Preview modal */}
      {previewStream && (
        <PreviewModal stream={previewStream} onClose={() => setPreviewStream(null)} />
      )}
    </div>
  )
}
