import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, LogOut } from 'lucide-react'
import { getStreams, getAlertStatus } from '../api/client'
import { useAuthStore } from '../store/auth'
import StatusDot from '../components/ui/StatusDot'

// Deliberately chrome-free — no sidebar, no per-page settings, nothing to
// tap by accident. Meant to be opened on a phone and glanced at while
// walking the venue floor, not used to configure anything. Bigger text,
// bigger touch targets, and only the numbers that matter at a glance.

function metricTone(metric, value) {
  if (value == null) return 'muted'
  if (metric === 'packet_loss') return value > 5 ? 'critical' : value > 1 ? 'warning' : 'good'
  if (metric === 'rtt') return value > 300 ? 'critical' : value > 150 ? 'warning' : 'good'
  return 'good'
}

const TONE_TEXT = { good: 'text-emerald-400', warning: 'text-amber-400', critical: 'text-red-400', muted: 'text-gray-400' }

function StreamRow({ stream, isDown }) {
  const isLive = stream.ready === true
  const tone = isDown ? 'critical' : isLive ? 'good' : 'muted'
  const bitrate = stream.bitrate_kbps != null ? Math.round(stream.bitrate_kbps) : null
  const rtt = stream.rtt_ms != null ? Math.round(stream.rtt_ms) : null
  const loss = stream.packet_loss_pct != null ? +stream.packet_loss_pct.toFixed(1) : null

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-surface-700">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot tone={tone} pulse={isDown} size={12} />
        <span className="text-lg font-semibold text-white truncate">{stream.name || stream.path}</span>
      </div>
      {isLive ? (
        <div className="flex items-center gap-4 shrink-0 font-mono tabular-nums">
          <span className={`text-base ${TONE_TEXT.good}`}>{bitrate ?? '—'}<span className="text-xs text-gray-500 ml-0.5">kbps</span></span>
          <span className={`text-base ${TONE_TEXT[metricTone('rtt', rtt)]}`}>{rtt ?? '—'}<span className="text-xs text-gray-500 ml-0.5">ms</span></span>
          <span className={`text-base ${TONE_TEXT[metricTone('packet_loss', loss)]}`}>{loss ?? '—'}<span className="text-xs text-gray-500 ml-0.5">%</span></span>
        </div>
      ) : (
        <span className="text-sm text-gray-500 shrink-0">Offline</span>
      )}
    </div>
  )
}

export default function CompanionPage() {
  const navigate = useNavigate()
  const logout = useAuthStore(s => s.logout)

  const { data: streams = [] } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 3000,
  })
  const { data: alertStatus = { down_streams: [], firing_rule_ids: [], predicted_risks: {} } } = useQuery({
    queryKey: ['alert-status'],
    queryFn: getAlertStatus,
    refetchInterval: 5000,
  })

  const downSet = new Set(alertStatus.down_streams)
  const alertCount = downSet.size + (alertStatus.firing_rule_ids?.length || 0)
  const riskCount = Object.keys(alertStatus.predicted_risks || {}).length

  return (
    <div className="min-h-screen bg-surface-950 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-surface-700 bg-surface-900">
        <div className="flex items-center gap-2">
          <StatusDot tone="good" pulse size={9} />
          <span className="text-sm font-bold text-white tracking-tight">ArenaHub Companion</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2"
            aria-label="Open full dashboard"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={() => { logout(); navigate('/login') }}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-red-400 px-2 py-1.5 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-400 focus-visible:outline-offset-2"
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {alertCount > 0 && (
        <div className="px-4 py-3 bg-red-500/15 border-b border-red-500/30 text-center">
          <span className="text-sm font-bold text-red-300">
            {alertCount} issue{alertCount === 1 ? '' : 's'} need attention
          </span>
        </div>
      )}
      {alertCount === 0 && riskCount > 0 && (
        <div className="px-4 py-3 bg-amber-500/15 border-b border-amber-500/30 text-center">
          <span className="text-sm font-bold text-amber-300">
            {riskCount} stream{riskCount === 1 ? '' : 's'} trending toward trouble
          </span>
        </div>
      )}
      {alertCount === 0 && riskCount === 0 && (
        <div className="px-4 py-3 bg-emerald-500/10 border-b border-emerald-500/25 text-center">
          <span className="text-sm font-semibold text-emerald-400">All systems normal</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {streams.length === 0 ? (
          <div className="flex-1 flex items-center justify-center py-20 text-gray-500 text-sm">
            No streams connected
          </div>
        ) : (
          streams.map(stream => (
            <StreamRow
              key={stream.path || stream.name}
              stream={stream}
              isDown={downSet.has(stream.path || stream.name)}
            />
          ))
        )}
      </div>
    </div>
  )
}
