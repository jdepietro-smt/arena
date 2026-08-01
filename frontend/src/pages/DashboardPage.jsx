import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, Zap, Disc, Users, Inbox, X } from 'lucide-react'
import { getStreams, getStatsSummary } from '../api/client'
import StreamCard from '../components/StreamCard'
import { startWhep } from '../utils/whep'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import StatusDot from '../components/ui/StatusDot'

// ── Skeleton helpers ──────────────────────────────────────────────────────────

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-surface-700 rounded-lg ${className}`} />
}

// ── Stat card ─────────────────────────────────────────────────────────────────

const ACCENTS = {
  emerald: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', glow: 'shadow-[0_0_20px_-6px_rgba(52,211,153,0.5)]' },
  brand:   { bg: 'bg-brand-500/10',   text: 'text-brand-400',   glow: 'shadow-[0_0_20px_-6px_rgba(129,140,248,0.5)]' },
  red:     { bg: 'bg-red-500/10',     text: 'text-red-400',     glow: 'shadow-[0_0_20px_-6px_rgba(248,113,113,0.5)]' },
  sky:     { bg: 'bg-sky-500/10',     text: 'text-sky-400',     glow: 'shadow-[0_0_20px_-6px_rgba(56,189,248,0.5)]' },
}

function StatCard({ label, value, unit, accent, icon: Icon, loading }) {
  const a = ACCENTS[accent] ?? ACCENTS.brand
  return (
    <Card className="p-4 flex items-center gap-4" hover>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${a.bg} ${a.glow}`}>
        <Icon size={20} strokeWidth={1.75} className={a.text} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 uppercase tracking-wider truncate">{label}</p>
        {loading ? (
          <Skeleton className="h-6 w-20 mt-1" />
        ) : (
          <p className="text-2xl font-bold text-white leading-tight tracking-tight">
            {value}
            {unit && <span className="text-sm font-normal text-gray-500 ml-1">{unit}</span>}
          </p>
        )}
      </div>
    </Card>
  )
}

// ── Event sidebar ─────────────────────────────────────────────────────────────
// NOTE: MOCK_EVENTS is placeholder data — no backend event log exists yet
// to back a real "Recent Events" feed. Flagged as a follow-up; this
// component's job right now is the visual shell, not real data.

const MOCK_EVENTS = [
  { id: 1, type: 'connected',    stream: 'Studio-A-Main',    ago: '2m ago' },
  { id: 2, type: 'disconnected', stream: 'Backup-Feed-3',    ago: '3m ago' },
  { id: 3, type: 'recording',    stream: 'Studio-A-Main',    ago: '2m ago' },
  { id: 4, type: 'connected',    stream: 'Remote-Cam-B',     ago: '6m ago' },
  { id: 5, type: 'warning',      stream: 'Backup-Feed-2',    ago: '8m ago' },
  { id: 6, type: 'disconnected', stream: 'Remote-Cam-A',     ago: '15m ago' },
  { id: 7, type: 'connected',    stream: 'Studio-B-Fill',    ago: '24m ago' },
  { id: 8, type: 'warning',      stream: 'Studio-A-Main',    ago: '29m ago' },
]

const EVENT_META = {
  connected:    { label: 'Connected',    tone: 'good' },
  disconnected: { label: 'Disconnected', tone: 'critical' },
  recording:    { label: 'Recording',    tone: 'info' },
  warning:      { label: 'Warning',      tone: 'warning' },
}

function EventSidebar() {
  return (
    <Card as="aside" className="w-[280px] shrink-0 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-600 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Recent Events</h2>
        <span className="text-xs text-gray-600">{MOCK_EVENTS.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-surface-700">
        {MOCK_EVENTS.map(ev => {
          const meta = EVENT_META[ev.type] || EVENT_META.warning
          return (
            <div key={ev.id} className="px-4 py-2.5 flex gap-3 items-start hover:bg-surface-750 transition-colors">
              <span className="mt-1"><StatusDot tone={meta.tone} size={7} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-gray-300 truncate">{ev.stream}</p>
                <p className="text-[11px] text-gray-500">{meta.label}</p>
              </div>
              <span className="text-[10px] text-gray-600 whitespace-nowrap shrink-0 mt-0.5">{ev.ago}</span>
            </div>
          )
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-surface-600">
        <button className="w-full text-center text-xs text-brand-400 hover:text-brand-300 transition-colors">
          View all events
        </button>
      </div>
    </Card>
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
      <div className="px-5 py-2.5 border-t border-surface-600 text-xs text-gray-600 font-mono">
        Measuring latency…
      </div>
    )
  }

  const color = stats.estimated == null ? 'text-gray-500'
    : stats.estimated <= 500 ? 'text-emerald-400'
    : stats.estimated <= 800 ? 'text-amber-400'
    : 'text-red-400'

  return (
    <div className="px-5 py-2.5 border-t border-surface-600 flex items-center gap-4 text-xs font-mono flex-wrap">
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
    <Modal open onClose={onClose} maxWidth="max-w-3xl">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-600">
        <h3 className="font-semibold text-white">{stream.name || stream.path}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <X size={20} />
        </button>
      </div>
      <div className="aspect-video bg-black">
        <WhepPlayer url={whepUrl} onPcReady={pc => { pcRef.current = pc }} />
      </div>
      <LatencyBar stats={stats} />
    </Modal>
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
    <div className="flex flex-col h-full min-h-0 gap-4 p-6 bg-surface-900">

      {/* Summary bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Active Streams"
          value={summaryLoading ? '' : liveStreams.length}
          loading={summaryLoading && streamsLoading}
          accent="emerald"
          icon={Radio}
        />
        <StatCard
          label="Total Bitrate"
          value={summaryLoading ? '' : (totalBitrate / 1000).toFixed(1)}
          unit="Mbps"
          loading={summaryLoading && streamsLoading}
          accent="brand"
          icon={Zap}
        />
        <StatCard
          label="Recordings"
          value={summaryLoading ? '' : recordingCount}
          loading={summaryLoading && streamsLoading}
          accent="red"
          icon={Disc}
        />
        <StatCard
          label="Connected Viewers"
          value={summaryLoading ? '' : totalViewers}
          loading={summaryLoading && streamsLoading}
          accent="sky"
          icon={Users}
        />
      </div>

      {/* Content row: stream grid + sidebar */}
      <div className="flex gap-4 flex-1 min-h-0">

        {/* Stream grid */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {streamsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="overflow-hidden">
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
                </Card>
              ))}
            </div>
          ) : streams.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-3">
              <Inbox size={44} strokeWidth={1} />
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
