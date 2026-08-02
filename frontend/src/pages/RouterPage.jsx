import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Waypoints } from 'lucide-react'
import {
  getStreams,
  getRoutes,
  createRoute,
  activateRoute,
  deactivateRoute,
  deleteRoute,
} from '../api/client'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'

const DEST_TYPES = ['SRT Out', 'HLS Re-stream', 'RTMP Out']

const defaultForm = {
  name: '',
  source: '',
  destType: 'SRT Out',
  destUrl: '',
}

const inputClass = 'bg-surface-900 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 placeholder-gray-600'

function NewRouteModal({ streams, onClose, onSubmit, loading }) {
  const [form, setForm] = useState(defaultForm)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-base">New route</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Route name</label>
            <input
              className={inputClass}
              placeholder="Studio A → CDN"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Source stream</label>
            <select className={inputClass} value={form.source} onChange={e => set('source', e.target.value)} required>
              <option value="">Select a stream…</option>
              {streams.map(s => (
                <option key={s.path || s.name} value={s.path || s.name}>{s.name || s.path}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Destination type</label>
            <select className={inputClass} value={form.destType} onChange={e => set('destType', e.target.value)}>
              {DEST_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Destination URL</label>
            <input
              className={inputClass}
              placeholder="srt://10.0.0.1:9000"
              value={form.destUrl}
              onChange={e => set('destUrl', e.target.value)}
              required
            />
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create route'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

function AddDestModal({ onClose, onAdd }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  return (
    <Modal open onClose={onClose} maxWidth="max-w-sm">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold text-base">Add destination</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="flex flex-col gap-3">
          <input className={inputClass} placeholder="Label (e.g. CDN Primary)" value={label} onChange={e => setLabel(e.target.value)} />
          <input className={inputClass} placeholder="srt://host:port" value={url} onChange={e => setUrl(e.target.value)} />
          <div className="flex gap-2 justify-end mt-1">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => { if (label && url) { onAdd({ label, url }); onClose() } }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function RouterPage() {
  const qc = useQueryClient()
  const [showNewRoute, setShowNewRoute] = useState(false)
  const [showAddDest, setShowAddDest] = useState(false)
  const [destinations, setDestinations] = useState([
    { label: 'SRT Primary', url: 'srt://10.0.0.1:9000' },
    { label: 'HLS CDN', url: 'https://cdn.example.com/hls' },
    { label: 'RTMP Backup', url: 'rtmp://backup.example.com/live' },
  ])
  // matrix[sourcePath][destIndex] = true/false
  const [matrix, setMatrix] = useState({})

  const { data: streams = [] } = useQuery({ queryKey: ['streams'], queryFn: getStreams, refetchInterval: 5000 })
  const { data: routes = [] } = useQuery({ queryKey: ['routes'], queryFn: getRoutes, refetchInterval: 3000 })

  const createMut = useMutation({
    mutationFn: async (form) => {
      const route = await createRoute({
        name: form.name,
        source_path: form.source,
        dest_type: form.destType,
        dest_url: form.destUrl,
      })
      await activateRoute(route.id)
      return route
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['routes'] }); setShowNewRoute(false) },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, active }) => active ? deactivateRoute(id) : activateRoute(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routes'] }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => deleteRoute(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routes'] }),
  })

  const toggleCell = (sourcePath, destIdx) => {
    setMatrix(m => ({
      ...m,
      [sourcePath]: { ...(m[sourcePath] || {}), [destIdx]: !(m[sourcePath]?.[destIdx]) },
    }))
  }

  const isRouted = (sourcePath, destIdx) => !!matrix[sourcePath]?.[destIdx]

  return (
    <div className="relative p-6 min-h-screen bg-surface-900">
      <div
        className="absolute top-0 left-1/3 w-[450px] h-[260px] blur-[100px] opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #818cf8, transparent 70%)' }}
      />

      {showNewRoute && (
        <NewRouteModal
          streams={streams}
          loading={createMut.isPending}
          onClose={() => setShowNewRoute(false)}
          onSubmit={(form) => createMut.mutate(form)}
        />
      )}
      {showAddDest && (
        <AddDestModal
          onClose={() => setShowAddDest(false)}
          onAdd={(d) => setDestinations(ds => [...ds, d])}
        />
      )}

      {/* Header */}
      <div className="relative flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Waypoints size={24} className="text-brand-400" />
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Signal Router</h1>
            <p className="text-gray-500 text-sm mt-0.5">Route live streams to any number of destinations</p>
          </div>
        </div>
        <Button variant="primary" onClick={() => setShowNewRoute(true)}>
          <Plus size={16} /> New route
        </Button>
      </div>

      {/* Main layout */}
      <div className="relative flex gap-4 items-start">

        {/* Routing Matrix — 60% */}
        <Card className="overflow-hidden flex-[0_0_60%]">
          <div className="px-4 py-3 border-b border-surface-600">
            <h2 className="text-white text-sm font-semibold">Routing matrix</h2>
            <p className="text-gray-500 text-xs mt-0.5">Click a cell to toggle routing</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-surface-600">
                  <th className="text-left px-4 py-3 text-gray-400 font-normal text-xs uppercase tracking-wider w-44">
                    Source / Dest
                  </th>
                  {destinations.map((d, i) => (
                    <th key={i} className="px-3 py-3 text-center text-gray-400 font-normal text-xs min-w-[110px]">
                      <div className="text-gray-300 font-medium">{d.label}</div>
                      <div className="text-gray-600 text-[10px] mt-0.5 truncate max-w-[100px] mx-auto">{d.url}</div>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-center w-12">
                    <button
                      onClick={() => setShowAddDest(true)}
                      title="Add destination"
                      className="w-7 h-7 rounded-lg border border-dashed border-surface-500 text-brand-400 hover:border-brand-500 hover:bg-brand-500/10 transition-colors text-base leading-none flex items-center justify-center mx-auto"
                    >
                      <Plus size={15} />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {streams.length === 0 && (
                  <tr>
                    <td colSpan={destinations.length + 2} className="text-center py-10 text-gray-600 text-sm">
                      No active streams
                    </td>
                  </tr>
                )}
                {streams.map((stream, si) => {
                  const path = stream.path || stream.name
                  return (
                    <tr key={path} className={si % 2 === 1 ? 'bg-white/[0.02]' : ''}>
                      <td className="px-4 py-3 text-gray-200 text-sm font-medium border-r border-surface-600">
                        <div>{stream.name || path}</div>
                        {stream.codec && <div className="text-gray-600 text-xs">{stream.codec}</div>}
                      </td>
                      {destinations.map((_, di) => {
                        const routed = isRouted(path, di)
                        return (
                          <td key={di} className="px-3 py-3 text-center">
                            <button
                              onClick={() => toggleCell(path, di)}
                              className={`w-8 h-8 rounded-lg border transition-all ${
                                routed
                                  ? 'bg-emerald-500/20 border-emerald-500/60 hover:bg-emerald-500/30'
                                  : 'bg-transparent border-surface-600 hover:border-surface-500 hover:bg-white/5'
                              }`}
                              title={routed ? 'Click to unroute' : 'Click to route'}
                            >
                              {routed && <span className="text-emerald-400 text-xs font-bold">✓</span>}
                            </button>
                          </td>
                        )
                      })}
                      <td />
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Active Routes — 40% */}
        <Card className="overflow-hidden flex-[0_0_calc(40%-1rem)]">
          <div className="px-4 py-3 border-b border-surface-600 flex items-center justify-between">
            <div>
              <h2 className="text-white text-sm font-semibold">Active routes</h2>
              <p className="text-gray-500 text-xs mt-0.5">{routes.length} configured</p>
            </div>
            <button
              onClick={() => setShowNewRoute(true)}
              className="text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 hover:border-brand-500/60 px-2.5 py-1 rounded-lg transition-colors"
            >
              + Add route
            </button>
          </div>
          <div className="divide-y divide-surface-600">
            {routes.length === 0 && (
              <div className="text-center py-10 text-gray-600 text-sm">No routes configured</div>
            )}
            {routes.map(route => (
              <div key={route.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-gray-100 text-sm font-medium truncate">{route.name}</div>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500 min-w-0">
                      <span className="text-gray-400 truncate max-w-[90px]">{route.source_path || route.source}</span>
                      <span className="text-gray-600 flex-shrink-0">→</span>
                      <span className="text-gray-400 truncate max-w-[90px]">{route.dest_url || route.dest}</span>
                    </div>
                    {route.bitrate_kbps && (
                      <div className="text-xs text-gray-600 font-mono mt-0.5">
                        {(route.bitrate_kbps / 1000).toFixed(1)} Mbps
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <Badge tone={route.active ? 'good' : 'muted'}>{route.active ? 'Active' : 'Inactive'}</Badge>
                    <div className="flex gap-1.5 mt-0.5">
                      <button
                        onClick={() => toggleMut.mutate({ id: route.id, active: route.active })}
                        disabled={toggleMut.isPending}
                        className="text-[10px] text-brand-400 hover:text-brand-300 border border-brand-500/30 hover:border-brand-500/60 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
                      >
                        {route.active ? 'Pause' : 'Activate'}
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm(`Delete route "${route.name}"?`)) {
                            deleteMut.mutate(route.id)
                          }
                        }}
                        className="text-[10px] text-red-400/70 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-2 py-0.5 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
