import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { getStreams, getStatsHistory } from '../api/client'
import Card from '../components/ui/Card'
import TimeSeriesChart from '../components/charts/TimeSeriesChart'
import BarChartMini from '../components/charts/BarChartMini'

function formatDuration(seconds) {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

function TrendArrow({ current, previous }) {
  if (previous == null || current == null) return null
  const up = current > previous
  const same = current === previous
  if (same) return <span className="text-gray-500 text-xs">—</span>
  return (
    <span className={`text-xs font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>
      {up ? '▲' : '▼'}
    </span>
  )
}

function MetricCard({ label, value, unit, previous, color = 'brand' }) {
  const colorMap = {
    brand:   'text-brand-300',
    emerald: 'text-emerald-300',
    amber:   'text-amber-300',
    signal:  'text-signal-300',
  }
  return (
    <Card className="p-4 flex flex-col gap-2">
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="flex items-end gap-2">
        <span className={`font-mono text-3xl font-bold tabular-nums ${colorMap[color]}`}>{value ?? '—'}</span>
        {unit && <span className="text-sm text-gray-500 mb-0.5">{unit}</span>}
        <div className="mb-1 ml-auto"><TrendArrow current={value} previous={previous} /></div>
      </div>
    </Card>
  )
}

export default function StatsPage() {
  const [selectedStream, setSelectedStream] = useState('')

  const { data: streams = [], isError: streamsError } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 5000,
  })

  // TanStack Query v5 removed onSuccess from useQuery (only useMutation
  // still has it) — this used to be a useQuery onSuccess callback that
  // silently never fired, so the stream dropdown never auto-selected the
  // first available stream on load.
  useEffect(() => {
    if (streams.length > 0 && !selectedStream) {
      setSelectedStream(streams[0].path || streams[0].name)
    }
  }, [streams, selectedStream])

  const { data: history = [] } = useQuery({
    queryKey: ['stats', selectedStream],
    queryFn: () => getStatsHistory(selectedStream, 60),
    enabled: !!selectedStream,
    refetchInterval: 2000,
  })

  // Build chart data — one point per second, last 60s
  const chartData = useMemo(() => {
    if (!history.length) return []
    return history.map((pt, i) => ({
      t: -(history.length - 1 - i),
      bitrate: pt.bitrate_kbps != null ? +(pt.bitrate_kbps / 1000).toFixed(2) : null,
      rtt: pt.rtt_ms != null ? Math.round(pt.rtt_ms) : null,
      loss: pt.packet_loss_pct != null ? +pt.packet_loss_pct.toFixed(2) : null,
    }))
  }, [history])

  // Latest and previous-30s snapshots
  const latest = history[history.length - 1] || {}
  const prev30 = history[Math.max(0, history.length - 16)] || {}

  const bitrateNow = latest.bitrate_kbps != null ? +(latest.bitrate_kbps / 1000).toFixed(2) : null
  const bitratePrev = prev30.bitrate_kbps != null ? +(prev30.bitrate_kbps / 1000).toFixed(2) : null
  const rttNow = latest.rtt_ms != null ? Math.round(latest.rtt_ms) : null
  const rttPrev = prev30.rtt_ms != null ? Math.round(prev30.rtt_ms) : null
  const lossNow = latest.packet_loss_pct != null ? +latest.packet_loss_pct.toFixed(2) : null
  const lossPrev = prev30.packet_loss_pct != null ? +prev30.packet_loss_pct.toFixed(2) : null
  const viewers = latest.viewers ?? null
  const viewersPrev = prev30.viewers ?? null

  const stream = streams.find(s => (s.path || s.name) === selectedStream)

  return (
    <div className="relative p-6 min-h-screen bg-surface-900">
      <div
        className="absolute top-0 right-1/4 w-[450px] h-[260px] blur-[100px] opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #22d3ee, transparent 70%)' }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-signal-400" />
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Live Monitoring</h1>
            <p className="text-gray-500 text-sm mt-0.5">Real-time stream telemetry — 2s refresh</p>
          </div>
        </div>
        <select
          className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 min-w-[200px]"
          value={selectedStream}
          onChange={e => setSelectedStream(e.target.value)}
        >
          <option value="">Select a stream…</option>
          {streams.map(s => (
            <option key={s.path || s.name} value={s.path || s.name}>{s.name || s.path}</option>
          ))}
        </select>
      </div>

      {streamsError && (
        <div className="relative text-center py-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg mb-4">
          Could not load streams. Retrying…
        </div>
      )}

      {/* Metric cards */}
      <div className="relative grid grid-cols-4 gap-3 mb-4">
        <MetricCard label="Bitrate" value={bitrateNow} previous={bitratePrev} unit="Mbps" color="brand" />
        <MetricCard label="RTT" value={rttNow} previous={rttPrev} unit="ms" color="signal" />
        <MetricCard label="Packet loss" value={lossNow} previous={lossPrev} unit="%" color="amber" />
        <MetricCard label="Viewers" value={viewers} previous={viewersPrev} color="emerald" />
      </div>

      {/* Bitrate and RTT — two single-axis charts, not one dual-axis chart:
          different scales (Mbps vs ms) compress and mislead against a
          shared frame. */}
      <div className="relative grid grid-cols-2 gap-4 mb-4">
        <Card className="p-4">
          <h2 className="text-white text-sm font-semibold mb-1">Bitrate — 60s window</h2>
          <p className="text-gray-500 text-xs mb-3">Mbps</p>
          <TimeSeriesChart
            data={chartData.map(d => ({ x: d.t, y: d.bitrate }))}
            height={200}
            color="#818cf8"
            variant="area"
            unit=" Mbps"
          />
        </Card>
        <Card className="p-4">
          <h2 className="text-white text-sm font-semibold mb-1">RTT — 60s window</h2>
          <p className="text-gray-500 text-xs mb-3">ms</p>
          <TimeSeriesChart
            data={chartData.map(d => ({ x: d.t, y: d.rtt }))}
            height={200}
            color="#22d3ee"
            variant="line"
            unit=" ms"
          />
        </Card>
      </div>

      {/* Packet loss bar chart */}
      <Card className="relative p-4 mb-4">
        <h2 className="text-white text-sm font-semibold mb-4">Packet loss — 60s window</h2>
        <BarChartMini
          data={chartData.map(d => ({ x: d.t, y: d.loss }))}
          height={120}
          color="#fbbf24"
          unit="%"
        />
      </Card>

      {/* Bottom row: Connection details + Events */}
      <div className="relative grid grid-cols-2 gap-4">
        {/* Connection details */}
        <Card className="p-4">
          <h2 className="text-white text-sm font-semibold mb-3">Connection details</h2>
          {!stream ? (
            <p className="text-gray-600 text-sm">No stream selected</p>
          ) : (
            <div className="flex flex-col gap-2">
              {[
                ['Stream', stream.name || stream.path],
                ['Source IP', stream.source_ip || stream.publisher?.ip || '—'],
                ['Codec', stream.codec || (latest.codec) || '—'],
                ['Resolution', stream.width && stream.height ? `${stream.width}×${stream.height}` : (latest.resolution || '—')],
                ['Duration', formatDuration(stream.uptime ?? latest.uptime)],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-gray-200 font-medium font-mono">{v}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Events log */}
        <Card className="p-4">
          <h2 className="text-white text-sm font-semibold mb-3">Events</h2>
          <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
            {(latest.events || []).length === 0 && (
              <p className="text-gray-600 text-sm">No recent events</p>
            )}
            {(latest.events || []).map((ev, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-gray-600 flex-shrink-0 font-mono">
                  {new Date(ev.ts).toLocaleTimeString()}
                </span>
                <span className={`flex-shrink-0 ${
                  ev.level === 'error' ? 'text-red-400' :
                  ev.level === 'warn' ? 'text-amber-400' : 'text-gray-400'
                }`}>
                  {ev.level?.toUpperCase() || 'INFO'}
                </span>
                <span className="text-gray-300">{ev.message}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
