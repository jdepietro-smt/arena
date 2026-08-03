import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getStreams, getAlertStatus, getAlertRules,
  createAlertRule, toggleAlertRule, deleteAlertRule,
  getRedundancyStatus, getRedundancyGateways,
  createRedundancyGateway, toggleRedundancyGateway, deleteRedundancyGateway,
} from '../api/client'
import { toast } from '../store/toast'
import { scheduleDelete, usePendingDeleteIds } from '../store/pendingDelete'

// Status palette — validated for CVD-safety and dark-surface contrast
// (dataviz skill's fixed status palette, never themed/reused for series color).
const STATUS = {
  good:     { hex: '#0ca30c', bg: 'rgba(12,163,12,0.12)',  label: 'Healthy' },
  warning:  { hex: '#fab219', bg: 'rgba(250,178,25,0.14)', label: 'Degraded' },
  critical: { hex: '#d03b3b', bg: 'rgba(208,59,59,0.14)',  label: 'Down' },
}

const METRIC_LABEL = { bitrate: 'Bitrate', rtt: 'RTT', packet_loss: 'Packet loss' }
const METRIC_UNIT = { bitrate: 'kbps', rtt: 'ms', packet_loss: '%' }
const OPERATOR_LABEL = { lt: '<', gt: '>' }

// Indicative thresholds for coloring the raw metric badges on each stream
// card — separate from user-defined AlertRules, just a quick visual read.
function metricTone(metric, value) {
  if (value == null) return 'muted'
  if (metric === 'packet_loss') return value > 5 ? 'critical' : value > 1 ? 'warning' : 'good'
  if (metric === 'rtt') return value > 300 ? 'critical' : value > 150 ? 'warning' : 'good'
  return 'good'
}

function StatusDot({ tone, pulse = false }) {
  const color = STATUS[tone]?.hex ?? '#64748b'
  return (
    <span
      className={pulse ? 'animate-pulse' : ''}
      style={{
        display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
        background: color, boxShadow: `0 0 8px ${color}`, flexShrink: 0,
      }}
    />
  )
}

function SummaryBanner({ downCount, firingCount }) {
  if (downCount === 0 && firingCount === 0) {
    return (
      <div className="flex items-center gap-3 px-5 py-4 rounded-xl border" style={{
        background: 'linear-gradient(90deg, rgba(12,163,12,0.10), rgba(12,163,12,0.03))',
        borderColor: 'rgba(12,163,12,0.25)',
      }}>
        <StatusDot tone="good" />
        <div>
          <div className="text-sm font-semibold" style={{ color: STATUS.good.hex }}>All systems normal</div>
          <div className="text-xs text-gray-500 mt-0.5">Every tracked stream is up and within threshold.</div>
        </div>
      </div>
    )
  }
  const tone = downCount > 0 ? 'critical' : 'warning'
  const s = STATUS[tone]
  return (
    <div className="flex items-center gap-3 px-5 py-4 rounded-xl border" style={{
      background: `linear-gradient(90deg, ${s.bg}, transparent)`,
      borderColor: `${s.hex}40`,
    }}>
      <StatusDot tone={tone} pulse />
      <div>
        <div className="text-sm font-semibold" style={{ color: s.hex }}>
          {downCount > 0
            ? `${downCount} stream${downCount === 1 ? '' : 's'} down`
            : `${firingCount} alert${firingCount === 1 ? '' : 's'} firing`}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {downCount > 0 && firingCount > 0
            ? `${firingCount} additional threshold breach${firingCount === 1 ? '' : 'es'} also active.`
            : downCount > 0
              ? 'Connectivity lost — see the stream grid below.'
              : 'One or more alert rules are currently breaching their threshold.'}
        </div>
      </div>
    </div>
  )
}

function MetricBadge({ metric, value }) {
  const tone = metricTone(metric, value)
  const color = tone === 'muted' ? '#64748b' : STATUS[tone].hex
  const display = value == null ? '—'
    : metric === 'packet_loss' ? value.toFixed(2)
    : Math.round(value)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider">{METRIC_LABEL[metric]}</span>
      <span className="text-sm font-medium font-mono" style={{ color }}>
        {display}{value != null && <span className="text-gray-600 ml-0.5 text-xs">{METRIC_UNIT[metric]}</span>}
      </span>
    </div>
  )
}

function StreamHealthCard({ path, name, live, downStreams }) {
  const isDown = downStreams.has(path)
  const tone = isDown ? 'critical' : 'good'
  return (
    <div
      className="rounded-xl p-4 border transition-colors"
      style={{
        background: '#14141f',
        borderColor: isDown ? 'rgba(208,59,59,0.4)' : '#28283c',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-gray-100 truncate">{name || path}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusDot tone={tone} pulse={isDown} />
          <span className="text-xs font-semibold" style={{ color: STATUS[tone].hex }}>{STATUS[tone].label}</span>
        </div>
      </div>
      {live ? (
        <div className="grid grid-cols-3 gap-3">
          <MetricBadge metric="bitrate" value={live.bitrate_kbps} />
          <MetricBadge metric="rtt" value={live.rtt_ms} />
          <MetricBadge metric="packet_loss" value={live.packet_loss_pct} />
        </div>
      ) : (
        <div className="text-xs text-gray-600">No live telemetry — mediamtx no longer lists this path.</div>
      )}
    </div>
  )
}

function AddRuleForm({ streams, onSubmit, submitting, error }) {
  const [streamPath, setStreamPath] = useState('')
  const [metric, setMetric] = useState('bitrate')
  const [operator, setOperator] = useState('lt')
  const [threshold, setThreshold] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!streamPath || !threshold) return
    onSubmit({ stream_path: streamPath, metric, operator, threshold: Number(threshold), action: 'webhook' })
    setThreshold('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 p-3 bg-surface-750 border border-surface-600 rounded-lg">
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Stream
        <select
          value={streamPath}
          onChange={e => setStreamPath(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500 min-w-[140px]"
        >
          <option value="">Select…</option>
          {streams.map(s => (
            <option key={s.path || s.name} value={s.path || s.name}>{s.name || s.path}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Metric
        <select value={metric} onChange={e => setMetric(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500">
          <option value="bitrate">Bitrate</option>
          <option value="rtt">RTT</option>
          <option value="packet_loss">Packet loss</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Condition
        <select value={operator} onChange={e => setOperator(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500">
          <option value="lt">Falls below</option>
          <option value="gt">Rises above</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Threshold
        <input
          type="number" step="any" placeholder={METRIC_UNIT[metric]}
          value={threshold} onChange={e => setThreshold(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-sm text-white w-24 focus:outline-none focus:border-brand-500"
        />
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-brand-500/40 bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Adding…' : 'Add rule'}
      </button>
      {error && <span className="text-xs text-red-400 w-full">{error}</span>}
    </form>
  )
}

function RuleRow({ rule, firing, onToggle, onDelete, toggling, deleting }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-surface-600 bg-surface-750">
      <StatusDot tone={firing ? 'warning' : rule.is_active ? 'good' : 'muted'} pulse={firing} />
      <span className="text-sm text-gray-200 truncate flex-1">
        <span className="font-medium">{rule.stream_path}</span>
        <span className="text-gray-500"> — {METRIC_LABEL[rule.metric]} {OPERATOR_LABEL[rule.operator]} {rule.threshold}{METRIC_UNIT[rule.metric]}</span>
      </span>
      {firing && (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: STATUS.warning.bg, color: STATUS.warning.hex }}>
          FIRING
        </span>
      )}
      <button
        onClick={() => onToggle(rule.id)}
        disabled={toggling}
        className={`shrink-0 px-2 py-1 rounded text-xs font-semibold border transition-colors disabled:opacity-50 ${
          rule.is_active
            ? 'border-emerald-500/40 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25'
            : 'border-[#333355] text-gray-500 hover:text-gray-300'
        }`}
      >
        {rule.is_active ? 'Enabled' : 'Disabled'}
      </button>
      <button
        onClick={() => onDelete(rule.id)}
        disabled={deleting}
        className="shrink-0 px-2 py-1 rounded text-xs font-semibold border border-red-500/30 text-red-400/70 hover:text-red-400 hover:border-red-500/50 disabled:opacity-50 transition-colors"
      >
        ✕
      </button>
    </div>
  )
}

// A gateway is "protected" only when it's dual-path AND both legs are up —
// a single-path gateway (or a dual-path one running on just one leg) still
// has output, just no protection against that one leg failing.
function gatewayTone(stats) {
  if (!stats) return 'critical'                          // unreachable
  if (!stats.output_connected) return 'critical'          // no output at all
  if (stats.dual_path && !(stats.path1_up && stats.path2_up)) return 'warning'
  return 'good'
}

function PathBadge({ label, up }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-medium" style={{ color: up ? STATUS.good.hex : STATUS.critical.hex }}>
        {up ? 'Up' : 'Down'}
      </span>
    </div>
  )
}

function GatewayCard({ gateway }) {
  const stats = gateway.stats
  const tone = gatewayTone(stats)
  const toneLabel = !stats ? 'Unreachable' : tone === 'good' ? 'Protected' : tone === 'warning' ? 'Degraded' : 'Down'
  return (
    <div
      className="rounded-xl p-4 border transition-colors"
      style={{
        background: '#14141f',
        borderColor: tone === 'critical' ? 'rgba(208,59,59,0.4)' : tone === 'warning' ? 'rgba(250,178,25,0.4)' : '#28283c',
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="min-w-0">
          <span className="text-sm font-medium text-gray-100 truncate block">{gateway.name}</span>
          {gateway.stream_path && <span className="text-xs text-gray-600">{gateway.stream_path}</span>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <StatusDot tone={tone} pulse={tone !== 'good'} />
          <span className="text-xs font-semibold" style={{ color: STATUS[tone]?.hex ?? '#64748b' }}>{toneLabel}</span>
        </div>
      </div>
      {stats ? (
        <div className="grid grid-cols-3 gap-3">
          <PathBadge label="Path 1" up={!!stats.path1_up} />
          <PathBadge label="Path 2" up={stats.dual_path ? !!stats.path2_up : null} />
          <PathBadge label="Output" up={!!stats.output_connected} />
        </div>
      ) : (
        <div className="text-xs text-gray-600">No response from {gateway.stats_url} — is sdi_receive running?</div>
      )}
    </div>
  )
}

function AddGatewayForm({ streams, onSubmit, submitting, error }) {
  const [name, setName] = useState('')
  const [statsUrl, setStatsUrl] = useState('')
  const [streamPath, setStreamPath] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || !statsUrl.trim()) return
    onSubmit({ name: name.trim(), stats_url: statsUrl.trim(), stream_path: streamPath || null })
    setName(''); setStatsUrl(''); setStreamPath('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 p-3 bg-surface-750 border border-surface-600 rounded-lg">
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Name
        <input
          type="text" placeholder="Truck 1" value={name} onChange={e => setName(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-sm text-white w-32 focus:outline-none focus:border-brand-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Stats URL
        <input
          type="text" placeholder="http://10.0.1.5:6400/" value={statsUrl} onChange={e => setStatsUrl(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-sm text-white w-52 focus:outline-none focus:border-brand-500"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-gray-500">
        Stream (optional)
        <select
          value={streamPath}
          onChange={e => setStreamPath(e.target.value)}
          className="bg-surface-800 border border-surface-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-brand-500 min-w-[140px]"
        >
          <option value="">None</option>
          {streams.map(s => (
            <option key={s.path || s.name} value={s.path || s.name}>{s.name || s.path}</option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={submitting}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-brand-500/40 bg-brand-600/20 text-brand-300 hover:bg-brand-600/30 disabled:opacity-50 transition-colors"
      >
        {submitting ? 'Adding…' : 'Add gateway'}
      </button>
      {error && <span className="text-xs text-red-400 w-full">{error}</span>}
    </form>
  )
}

function GatewayRow({ gateway, onToggle, onDelete, toggling, deleting }) {
  const tone = gatewayTone(gateway.stats)
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-surface-600 bg-surface-750">
      <StatusDot tone={gateway.is_active ? tone : 'muted'} pulse={gateway.is_active && tone !== 'good'} />
      <span className="text-sm text-gray-200 truncate flex-1">
        <span className="font-medium">{gateway.name}</span>
        <span className="text-gray-500"> — {gateway.stats_url}</span>
        {gateway.stream_path && <span className="text-gray-600"> ({gateway.stream_path})</span>}
      </span>
      <button
        onClick={() => onToggle(gateway.id)}
        disabled={toggling}
        className={`shrink-0 px-2 py-1 rounded text-xs font-semibold border transition-colors disabled:opacity-50 ${
          gateway.is_active
            ? 'border-emerald-500/40 bg-emerald-600/15 text-emerald-300 hover:bg-emerald-600/25'
            : 'border-[#333355] text-gray-500 hover:text-gray-300'
        }`}
      >
        {gateway.is_active ? 'Enabled' : 'Disabled'}
      </button>
      <button
        onClick={() => onDelete(gateway.id)}
        disabled={deleting}
        className="shrink-0 px-2 py-1 rounded text-xs font-semibold border border-red-500/30 text-red-400/70 hover:text-red-400 hover:border-red-500/50 disabled:opacity-50 transition-colors"
      >
        ✕
      </button>
    </div>
  )
}

export default function AlertsPage() {
  const qc = useQueryClient()
  const [formError, setFormError] = useState(null)
  const [gatewayFormError, setGatewayFormError] = useState(null)

  const pendingDeleteIds = usePendingDeleteIds()

  const { data: streams = [], isError: streamsError } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    refetchInterval: 5000,
  })

  const { data: alertStatus = { down_streams: [], firing_rule_ids: [] } } = useQuery({
    queryKey: ['alert-status'],
    queryFn: getAlertStatus,
    refetchInterval: 5000,
  })

  const { data: allRules = [], isError: rulesError } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: getAlertRules,
    refetchInterval: 5000,
  })
  const rules = allRules.filter(r => !pendingDeleteIds.has(`rule-${r.id}`))

  const createMut = useMutation({
    mutationFn: createAlertRule,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alert-rules'] })
      setFormError(null)
      toast.success('Alert rule added')
    },
    onError: (err) => setFormError(err.response?.data?.detail || err.message || 'Failed to create rule'),
  })
  const toggleMut = useMutation({
    mutationFn: toggleAlertRule,
    onSuccess: (rule) => {
      qc.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(rule?.is_active ? 'Rule enabled' : 'Rule disabled')
    },
    onError: (err) => toast.error(err?.response?.data?.detail || 'Failed to update rule'),
  })
  function handleDeleteRule(rule) {
    scheduleDelete({
      id: `rule-${rule.id}`,
      label: 'Alert rule',
      onDelete: async () => {
        await deleteAlertRule(rule.id)
        qc.invalidateQueries({ queryKey: ['alert-rules'] })
      },
      onError: (err) => toast.error(err?.response?.data?.detail || 'Failed to delete rule'),
    })
  }

  const { data: allGateways = [], isError: gatewaysError } = useQuery({
    queryKey: ['redundancy-gateways'],
    queryFn: getRedundancyGateways,
    refetchInterval: 5000,
  })
  const gateways = allGateways.filter(g => !pendingDeleteIds.has(`gateway-${g.id}`))

  const { data: redundancyStatus = { gateways: [] } } = useQuery({
    queryKey: ['redundancy-status'],
    queryFn: getRedundancyStatus,
    refetchInterval: 5000,
  })

  const createGatewayMut = useMutation({
    mutationFn: createRedundancyGateway,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['redundancy-gateways'] })
      setGatewayFormError(null)
      toast.success('Redundancy gateway added')
    },
    onError: (err) => setGatewayFormError(err.response?.data?.detail || err.message || 'Failed to add gateway'),
  })
  const toggleGatewayMut = useMutation({
    mutationFn: toggleRedundancyGateway,
    onSuccess: (gateway) => {
      qc.invalidateQueries({ queryKey: ['redundancy-gateways'] })
      toast.success(gateway?.is_active ? 'Gateway enabled' : 'Gateway disabled')
    },
    onError: (err) => toast.error(err?.response?.data?.detail || 'Failed to update gateway'),
  })
  function handleDeleteGateway(gateway) {
    scheduleDelete({
      id: `gateway-${gateway.id}`,
      label: 'Redundancy gateway',
      onDelete: async () => {
        await deleteRedundancyGateway(gateway.id)
        qc.invalidateQueries({ queryKey: ['redundancy-gateways'] })
      },
      onError: (err) => toast.error(err?.response?.data?.detail || 'Failed to delete gateway'),
    })
  }

  // The CRUD list (/redundancy) and the polled status (/redundancy/status)
  // are separate endpoints — merge status.stats onto each gateway by id so
  // the cards have one shape to render.
  const statsById = new Map(redundancyStatus.gateways.map(g => [g.id, g.stats]))
  const gatewaysWithStats = gateways.map(g => ({ ...g, stats: statsById.get(g.id) }))

  const downStreams = new Set(alertStatus.down_streams)
  const firingRuleIds = new Set(alertStatus.firing_rule_ids)

  // Union of currently-live paths and paths the alert manager still
  // considers down (mediamtx may have already stopped listing a path
  // entirely once it's gone — this keeps it visible as "Down" instead of
  // just disappearing from the grid).
  const liveByPath = new Map(streams.map(s => [s.path || s.name, s]))
  const allPaths = new Set([...liveByPath.keys(), ...downStreams])

  return (
    <div className="p-6 min-h-screen bg-surface-900">
      <div className="mb-5">
        <h1 className="text-white text-xl font-medium">Alerts</h1>
        <p className="text-gray-500 text-sm mt-0.5">Connectivity and threshold monitoring — 10s evaluation, 5s refresh</p>
      </div>

      <div className="mb-6">
        <SummaryBanner downCount={downStreams.size} firingCount={firingRuleIds.size} />
      </div>

      <div className="mb-6">
        <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Stream health</h2>
        {streamsError && (
          <div className="text-center py-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl mb-3">
            Could not load streams. Retrying…
          </div>
        )}
        {allPaths.size === 0 ? (
          <div className="text-center py-10 text-gray-600 text-sm bg-surface-800 border border-surface-600 rounded-xl">
            No streams tracked yet.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {[...allPaths].sort().map(path => (
              <StreamHealthCard
                key={path}
                path={path}
                name={liveByPath.get(path)?.name}
                live={liveByPath.get(path)}
                downStreams={downStreams}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Alert rules</h2>
        <div className="mb-3">
          <AddRuleForm
            streams={streams}
            onSubmit={(d) => createMut.mutate(d)}
            submitting={createMut.isPending}
            error={formError}
          />
        </div>
        {rulesError && (
          <div className="text-center py-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl mb-3">
            Could not load alert rules. Retrying…
          </div>
        )}
        {!rulesError && rules.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-sm bg-surface-800 border border-surface-600 rounded-xl">
            No alert rules configured — connectivity is still monitored for every stream by default.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map(rule => (
              <RuleRow
                key={rule.id}
                rule={rule}
                firing={firingRuleIds.has(rule.id)}
                onToggle={(id) => toggleMut.mutate(id)}
                onDelete={() => handleDeleteRule(rule)}
                toggling={toggleMut.isPending}
                deleting={false}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <h2 className="text-xs uppercase tracking-wider text-gray-500 font-semibold mb-3">Redundancy gateways</h2>
        <p className="text-gray-600 text-xs mb-3">
          SMPTE 2022-7 protection-switch monitoring — register an sdi_receive instance's --stats-port to watch path1/path2/output health.
        </p>
        {gatewaysWithStats.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-3">
            {gatewaysWithStats.map(gw => <GatewayCard key={gw.id} gateway={gw} />)}
          </div>
        )}
        <div className="mb-3">
          <AddGatewayForm
            streams={streams}
            onSubmit={(d) => createGatewayMut.mutate(d)}
            submitting={createGatewayMut.isPending}
            error={gatewayFormError}
          />
        </div>
        {gatewaysError && (
          <div className="text-center py-4 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl mb-3">
            Could not load redundancy gateways. Retrying…
          </div>
        )}
        {!gatewaysError && gatewaysWithStats.length === 0 ? (
          <div className="text-center py-8 text-gray-600 text-sm bg-surface-800 border border-surface-600 rounded-xl">
            No redundancy gateways registered — sdi_receive dual-path setups run unmonitored until one is added here.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {gatewaysWithStats.map(gw => (
              <GatewayRow
                key={gw.id}
                gateway={gw}
                onToggle={(id) => toggleGatewayMut.mutate(id)}
                onDelete={() => handleDeleteGateway(gw)}
                toggling={toggleGatewayMut.isPending}
                deleting={false}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
