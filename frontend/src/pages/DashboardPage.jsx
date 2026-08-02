import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Radio, Zap, Disc, Users, X } from 'lucide-react'
import { getStreams, getStatsSummary, getEvents } from '../api/client'
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
  emerald: { text: 'text-emerald-300', iconBg: 'bg-emerald-500/15', ring: 'ring-emerald-500/40', glow: 'rgba(52,211,153,0.4)', bar: 'from-emerald-400 to-emerald-600' },
  brand:   { text: 'text-brand-300',   iconBg: 'bg-brand-500/15',   ring: 'ring-brand-500/40',   glow: 'rgba(129,140,248,0.4)', bar: 'from-brand-400 to-brand-600' },
  red:     { text: 'text-red-300',     iconBg: 'bg-red-500/15',     ring: 'ring-red-500/40',     glow: 'rgba(248,113,113,0.4)', bar: 'from-red-400 to-red-600' },
  signal:  { text: 'text-signal-300',  iconBg: 'bg-signal-500/15',  ring: 'ring-signal-500/40',  glow: 'rgba(34,211,238,0.4)',  bar: 'from-signal-400 to-signal-500' },
}

function StatCard({ label, value, unit, accent, icon: Icon, loading }) {
  const a = ACCENTS[accent] ?? ACCENTS.brand
  return (
    <div className="group relative rounded-2xl overflow-hidden bg-gradient-to-br from-surface-800 to-surface-750 border border-surface-600 transition-all hover:border-surface-500 hover:-translate-y-0.5 hover:shadow-2xl">
      {/* Top accent bar names the card's identity before you even read the label */}
      <div className={`h-[3px] w-full bg-gradient-to-r ${a.bar}`} />
      {/* Ambient glow anchored to this card's own accent — quiet until hover */}
      <div
        className="absolute -top-8 -right-8 w-28 h-28 rounded-full blur-2xl opacity-30 group-hover:opacity-60 transition-opacity pointer-events-none"
        style={{ background: a.glow }}
      />
      <div className="relative p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.12em]">{label}</p>
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.iconBg} ring-1 ${a.ring}`}>
            <Icon size={17} strokeWidth={2} className={a.text} />
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p className={`relative font-mono text-4xl font-bold leading-none tracking-tight tabular-nums ${a.text}`}>
            {value}
            {unit && <span className="text-base font-medium text-gray-500 ml-1.5">{unit}</span>}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Event sidebar ─────────────────────────────────────────────────────────────

const EVENT_META = {
  stream_connected:    { label: 'Connected',    tone: 'good' },
  stream_disconnected: { label: 'Disconnected', tone: 'critical' },
  recording_started:   { label: 'Recording',    tone: 'muted' },
  recording_stopped:   { label: 'Recording stopped', tone: 'muted' },
  alert_fired:         { label: 'Alert',        tone: 'warning' },
  alert_recovered:     { label: 'Alert cleared', tone: 'good' },
}

function timeAgo(isoString) {
  const diffMs = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function EventRow({ ev }) {
  const meta = EVENT_META[ev.type] || EVENT_META.alert_fired
  return (
    <div className="px-4 py-2.5 flex gap-3 items-start hover:bg-surface-750 transition-colors">
      <span className="mt-1"><StatusDot tone={meta.tone} size={7} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-gray-300 truncate">{ev.stream_path || '—'}</p>
        <p className="text-[11px] text-gray-500 truncate">{ev.message || meta.label}</p>
      </div>
      <span className="text-[10px] text-gray-600 whitespace-nowrap shrink-0 mt-0.5">{timeAgo(ev.created_at)}</span>
    </div>
  )
}

function AllEventsModal({ events, onClose }) {
  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-600">
        <h3 className="font-semibold text-white">All Events</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
          <X size={20} />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto divide-y divide-surface-700">
        {events.length === 0 ? (
          <p className="px-5 py-6 text-sm text-gray-500 text-center">No events yet</p>
        ) : (
          events.map(ev => <EventRow key={ev.id} ev={ev} />)
        )}
      </div>
    </Modal>
  )
}

function EventSidebar() {
  const [showAll, setShowAll] = useState(false)

  const { data: events = [] } = useQuery({
    queryKey: ['events'],
    queryFn: () => getEvents(50),
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })

  return (
    <Card as="aside" className="w-full lg:w-[280px] shrink-0 flex flex-col overflow-hidden max-h-64 lg:max-h-none">
      <div className="px-4 py-3 border-b border-surface-600 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Recent Events</h2>
        <span className="text-xs text-gray-600">{events.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-surface-700">
        {events.length === 0 ? (
          <p className="px-4 py-6 text-xs text-gray-600 text-center">No events yet</p>
        ) : (
          events.slice(0, 8).map(ev => <EventRow key={ev.id} ev={ev} />)
        )}
      </div>
      <div className="px-4 py-2.5 border-t border-surface-600">
        <button
          onClick={() => setShowAll(true)}
          className="w-full text-center text-xs text-brand-400 hover:text-brand-300 transition-colors"
        >
          View all events
        </button>
      </div>
      {showAll && <AllEventsModal events={events} onClose={() => setShowAll(false)} />}
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
    <div className="relative flex flex-col h-full min-h-0 gap-4 p-6 bg-surface-900">
      <div
        className="absolute top-0 left-1/4 w-[500px] h-[300px] blur-[100px] opacity-[0.07] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #818cf8, transparent 70%)' }}
      />

      {/* Summary bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
          accent="signal"
          icon={Users}
        />
      </div>

      {/* Content row: stream grid + sidebar */}
      <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0">

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
            <div className="relative flex flex-col items-center justify-center h-full min-h-[360px] gap-4 rounded-2xl border border-dashed border-surface-600 overflow-hidden">
              <div
                className="absolute inset-0 opacity-[0.06]"
                style={{ background: 'radial-gradient(circle at 50% 40%, #818cf8, transparent 60%)' }}
              />
              <div className="relative w-16 h-16 rounded-2xl bg-brand-500/10 ring-1 ring-brand-500/30 flex items-center justify-center">
                <Radio size={28} strokeWidth={1.5} className="text-brand-400" />
              </div>
              <div className="relative text-center">
                <p className="text-base font-semibold text-gray-300">No streams connected</p>
                <p className="text-sm text-gray-600 mt-1">Publish an SRT stream to this server to see it here</p>
              </div>
              <code className="relative text-xs font-mono text-signal-400/80 bg-surface-800 border border-surface-600 rounded-lg px-3 py-1.5 mt-1">
                srt://{window.location.hostname}:8890?streamid=publish:mystream
              </code>
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
