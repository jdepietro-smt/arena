import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart,
  AreaChart,
  Area,
  Line,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { getStreams, getStatsHistory } from '../api/client'

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

function MetricCard({ label, value, unit, previous, color = 'indigo' }) {
  const colorMap = {
    indigo: 'text-indigo-400',
    emerald: 'text-emerald-400',
    amber: 'text-amber-400',
    sky: 'text-sky-400',
  }
  return (
    <div className="bg-[#111118] border border-[#222233] rounded-xl p-4 flex flex-col gap-2">
      <div className="text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="flex items-end gap-2">
        <span className={`text-2xl font-medium ${colorMap[color]}`}>{value ?? '—'}</span>
        {unit && <span className="text-sm text-gray-500 mb-0.5">{unit}</span>}
        <div className="mb-1 ml-auto">
          <TrendArrow current={value} previous={previous} />
        </div>
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-[#111118] border border-[#222233] rounded-lg px-3 py-2 text-xs shadow-xl">
      <div className="text-gray-400 mb-1">{label}s ago</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span style={{ color: p.color }}>{p.name}:</span>
          <span className="text-white font-medium">{typeof p.value === 'number' ? p.value.toFixed(2) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function StatsPage() {
  const [selectedStream, setSelectedStream] = useState('')

  const { data: streams = [] } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 5000,
    onSuccess: (data) => {
      if (data.length > 0 && !selectedStream) {
        setSelectedStream(data[0].path || data[0].name)
      }
    },
  })

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
    <div className="p-6 min-h-screen bg-[#0a0a0f]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-medium">Live monitoring</h1>
          <p className="text-gray-500 text-sm mt-0.5">Real-time stream telemetry — 2s refresh</p>
        </div>
        <select
          className="bg-[#111118] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 min-w-[200px]"
          value={selectedStream}
          onChange={e => setSelectedStream(e.target.value)}
        >
          <option value="">Select a stream…</option>
          {streams.map(s => (
            <option key={s.path || s.name} value={s.path || s.name}>
              {s.name || s.path}
            </option>
          ))}
        </select>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <MetricCard label="Bitrate" value={bitrateNow} previous={bitratePrev} unit="Mbps" color="indigo" />
        <MetricCard label="RTT" value={rttNow} previous={rttPrev} unit="ms" color="sky" />
        <MetricCard label="Packet loss" value={lossNow} previous={lossPrev} unit="%" color="amber" />
        <MetricCard label="Viewers" value={viewers} previous={viewersPrev} color="emerald" />
      </div>

      {/* Main chart: Bitrate + RTT */}
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-white text-sm font-medium">Bitrate and RTT — 60s window</h2>
            <p className="text-gray-500 text-xs mt-0.5">Area: bitrate (Mbps) · Line: RTT (ms)</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-gray-400">
              <span className="w-3 h-0.5 rounded bg-indigo-500 inline-block" /> Bitrate
            </span>
            <span className="flex items-center gap-1.5 text-gray-400">
              <span className="w-3 h-0.5 rounded bg-sky-400 inline-block" /> RTT
            </span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="bitrateGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#222233" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}s`}
            />
            <YAxis
              yAxisId="left"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}`}
              label={{ value: 'Mbps', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 10, offset: 8 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}`}
              label={{ value: 'ms', angle: 90, position: 'insideRight', fill: '#6b7280', fontSize: 10, offset: 8 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="bitrate"
              name="Bitrate (Mbps)"
              stroke="#6366f1"
              strokeWidth={1.5}
              fill="url(#bitrateGrad)"
              dot={false}
              connectNulls
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="rtt"
              name="RTT (ms)"
              stroke="#38bdf8"
              strokeWidth={1.5}
              dot={false}
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Packet loss bar chart */}
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-4 mb-4">
        <h2 className="text-white text-sm font-medium mb-4">Packet loss — 60s window</h2>
        <ResponsiveContainer width="100%" height={120}>
          <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222233" vertical={false} />
            <XAxis
              dataKey="t"
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}s`}
            />
            <YAxis
              tick={{ fill: '#6b7280', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="loss" name="Loss (%)" fill="#f59e0b" radius={[2, 2, 0, 0]} maxBarSize={8} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bottom row: Connection details + Events */}
      <div className="grid grid-cols-2 gap-4">
        {/* Connection details */}
        <div className="bg-[#111118] border border-[#222233] rounded-xl p-4">
          <h2 className="text-white text-sm font-medium mb-3">Connection details</h2>
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
                  <span className="text-gray-200 font-medium">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Events log */}
        <div className="bg-[#111118] border border-[#222233] rounded-xl p-4">
          <h2 className="text-white text-sm font-medium mb-3">Events</h2>
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
        </div>
      </div>
    </div>
  )
}
