import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, Radio, Zap, Disc, Users, BellRing, CheckCircle2 } from 'lucide-react'
import { getStreams, getStatsSummary, getAlertStatus, getAlertRules, getEvents, getStatsHistory } from '../api/client'
import Card from '../components/ui/Card'
import StatusDot from '../components/ui/StatusDot'
import Sparkline from '../components/charts/Sparkline'

const METRIC_LABEL = { bitrate: 'Bitrate', rtt: 'RTT', packet_loss: 'Packet loss' }
const METRIC_UNIT = { bitrate: 'kbps', rtt: 'ms', packet_loss: '%' }
const OPERATOR_LABEL = { lt: '<', gt: '>' }

// KPI tile accents — same job as DashboardPage's ACCENTS (identity color per
// metric, not magnitude), kept local since every page in this app defines its
// own small accent map rather than sharing one.
const ACCENTS = {
  emerald: { text: 'text-emerald-300', iconBg: 'bg-emerald-500/15', ring: 'ring-emerald-500/40', bar: 'from-emerald-400 to-emerald-600' },
  brand:   { text: 'text-brand-300',   iconBg: 'bg-brand-500/15',   ring: 'ring-brand-500/40',   bar: 'from-brand-400 to-brand-600' },
  red:     { text: 'text-red-300',     iconBg: 'bg-red-500/15',     ring: 'ring-red-500/40',     bar: 'from-red-400 to-red-600' },
  amber:   { text: 'text-amber-300',   iconBg: 'bg-amber-500/15',   ring: 'ring-amber-500/40',   bar: 'from-amber-400 to-amber-600' },
  signal:  { text: 'text-signal-300',  iconBg: 'bg-signal-500/15',  ring: 'ring-signal-500/40',  bar: 'from-signal-400 to-signal-500' },
}

function KpiTile({ label, value, unit, accent, icon: Icon }) {
  const a = ACCENTS[accent] ?? ACCENTS.brand
  return (
    <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-surface-800 to-surface-750 border border-surface-600">
      <div className={`h-[3px] w-full bg-gradient-to-r ${a.bar}`} />
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.1em]">{label}</p>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${a.iconBg} ring-1 ${a.ring}`}>
            <Icon size={15} strokeWidth={2} className={a.text} />
          </div>
        </div>
        <p className={`font-mono text-3xl font-bold leading-none tabular-nums ${a.text}`}>
          {value}
          {unit && <span className="text-sm font-medium text-gray-500 ml-1.5">{unit}</span>}
        </p>
      </div>
    </div>
  )
}

// Same threshold logic AlertsPage uses to color raw metric badges — kept
// local since it's a quick indicative read, not the user-defined AlertRules.
function metricTone(metric, value) {
  if (value == null) return 'muted'
  if (metric === 'packet_loss') return value > 5 ? 'critical' : value > 1 ? 'warning' : 'good'
  if (metric === 'rtt') return value > 300 ? 'critical' : value > 150 ? 'warning' : 'good'
  return 'good'
}

function MetricReadout({ label, value, unit, tone }) {
  const color = { good: '#34d399', warning: '#fbbf24', critical: '#f87171', muted: '#9ca3af' }[tone]
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
      <span className="text-xs font-mono font-semibold" style={{ color }}>
        {value ?? '—'}{value != null && <span className="text-gray-500 font-normal ml-0.5">{unit}</span>}
      </span>
    </div>
  )
}

function StreamHealthTile({ stream, isDown }) {
  const path = stream.path || stream.name
  const isLive = stream.ready === true

  const { data: history = [] } = useQuery({
    queryKey: ['stats', path, 'sparkline'],
    queryFn: () => getStatsHistory(path, 60),
    enabled: isLive,
    refetchInterval: 5000,
  })

  const bitrateSeries = useMemo(() => history.map(h => h.bitrate_kbps ?? null), [history])

  const tone = isDown ? 'critical' : isLive ? 'good' : 'muted'
  const bitrate = stream.bitrate_kbps != null ? Math.round(stream.bitrate_kbps) : null
  const rtt = stream.rtt_ms != null ? Math.round(stream.rtt_ms) : null
  const loss = stream.packet_loss_pct != null ? +stream.packet_loss_pct.toFixed(2) : null

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <StatusDot tone={tone} pulse={isDown} />
          <span className="text-sm font-semibold text-gray-100 truncate">{stream.name || path}</span>
        </div>
        {stream.readers != null && (
          <span className="shrink-0 text-xs text-gray-500 flex items-center gap-1">
            <Users size={12} />{stream.readers}
          </span>
        )}
      </div>

      {isLive ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <MetricReadout label="Bitrate" value={bitrate} unit="kbps" tone={bitrate != null ? 'good' : 'muted'} />
            <MetricReadout label="RTT" value={rtt} unit="ms" tone={metricTone('rtt', rtt)} />
            <MetricReadout label="Loss" value={loss} unit="%" tone={metricTone('packet_loss', loss)} />
          </div>
          {bitrateSeries.length > 1 && (
            <Sparkline data={bitrateSeries} height={32} color="#818cf8" formatValue={(v) => `${Math.round(v)} kbps`} />
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500">Offline — no telemetry</p>
      )}
    </Card>
  )
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

export default function OverviewPage() {
  const { data: streams = [] } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 3000,
  })
  const { data: summary } = useQuery({
    queryKey: ['stats-summary'],
    queryFn: getStatsSummary,
    refetchInterval: 3000,
  })
  const { data: alertStatus = { down_streams: [], firing_rule_ids: [] } } = useQuery({
    queryKey: ['alert-status'],
    queryFn: getAlertStatus,
    refetchInterval: 5000,
  })
  const { data: rules = [] } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: getAlertRules,
    refetchInterval: 5000,
  })
  const { data: events = [] } = useQuery({
    queryKey: ['events', 'overview'],
    queryFn: () => getEvents(8),
    refetchInterval: 5000,
  })

  const liveStreams = streams.filter(s => s.ready)
  const downSet = new Set(alertStatus.down_streams)
  const firingSet = new Set(alertStatus.firing_rule_ids)
  const firingRules = rules.filter(r => firingSet.has(r.id))
  const alertCount = downSet.size + firingRules.length

  const totalBitrate = summary?.total_bitrate_kbps
    ?? streams.reduce((acc, s) => acc + (s.bitrate_kbps || 0), 0)
  const recordingCount = summary?.recordings_active
    ?? streams.filter(s => s.recording).length
  const totalViewers = summary?.total_readers
    ?? streams.reduce((acc, s) => acc + (s.readers || 0), 0)

  return (
    <div className="relative flex flex-col gap-5 p-6 min-h-screen bg-surface-900">
      <div
        className="absolute top-0 left-1/3 w-[500px] h-[280px] blur-[100px] opacity-[0.07] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #818cf8, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={24} className="text-brand-400" />
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Overview</h1>
            <p className="text-gray-500 text-sm mt-0.5">Live status across every stream — 3s refresh</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-800 border border-surface-600 text-xs font-semibold text-emerald-400">
          <StatusDot tone="good" pulse size={7} />
          Live
        </div>
      </div>

      {/* KPI row */}
      <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiTile label="Active Streams" value={liveStreams.length} accent="emerald" icon={Radio} />
        <KpiTile label="Total Bitrate" value={(totalBitrate / 1000).toFixed(1)} unit="Mbps" accent="brand" icon={Zap} />
        <KpiTile label="Recordings" value={recordingCount} accent="red" icon={Disc} />
        <KpiTile label="Viewers" value={totalViewers} accent="signal" icon={Users} />
        <KpiTile label="Alerts" value={alertCount} accent={alertCount > 0 ? 'amber' : 'emerald'} icon={BellRing} />
      </div>

      {/* Body */}
      <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Live streams grid */}
        <div className="lg:col-span-2 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-gray-300">Live Streams</h2>
          {streams.length === 0 ? (
            <Card className="p-10 text-center text-gray-400 text-sm">No streams connected</Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {streams.map(stream => (
                <StreamHealthTile
                  key={stream.path || stream.name}
                  stream={stream}
                  isDown={downSet.has(stream.path || stream.name)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Alerts + events sidebar */}
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Alerts</h2>
            {alertCount === 0 ? (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06]">
                <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-emerald-400">All systems normal</div>
                  <div className="text-xs text-gray-500 mt-0.5">No streams down, no rules firing.</div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {[...downSet].map(path => (
                  <div key={`down-${path}`} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/25 bg-red-500/[0.06]">
                    <StatusDot tone="critical" pulse size={7} />
                    <span className="text-xs text-gray-200 truncate">{path} <span className="text-gray-500">is down</span></span>
                  </div>
                ))}
                {firingRules.map(rule => (
                  <div key={`rule-${rule.id}`} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.06]">
                    <StatusDot tone="warning" pulse size={7} />
                    <span className="text-xs text-gray-200 truncate">
                      <span className="font-medium">{rule.stream_path}</span>{' '}
                      <span className="text-gray-500">
                        {METRIC_LABEL[rule.metric]} {OPERATOR_LABEL[rule.operator]} {rule.threshold}{METRIC_UNIT[rule.metric]}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3">Recent Events</h2>
            <Card className="overflow-hidden">
              {events.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">No events yet</p>
              ) : (
                <div className="divide-y divide-surface-700">
                  {events.map(ev => (
                    <div key={ev.id} className="px-4 py-2.5 flex gap-3 items-start">
                      <span className="mt-1">
                        <StatusDot tone={ev.type?.includes('disconnect') ? 'critical' : ev.type?.includes('alert') ? 'warning' : 'good'} size={7} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-300 truncate">{ev.stream_path || '—'}</p>
                        <p className="text-[11px] text-gray-500 truncate">{ev.message || ev.type}</p>
                      </div>
                      <span className="text-[10px] text-gray-500 whitespace-nowrap shrink-0 mt-0.5">{timeAgo(ev.created_at)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
