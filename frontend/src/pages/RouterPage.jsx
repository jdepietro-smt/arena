import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getStreams,
  getRoutes,
  createRoute,
  activateRoute,
  deactivateRoute,
  deleteRoute,
} from '../api/client'

const DEST_TYPES = ['SRT Out', 'HLS Re-stream', 'RTMP Out']

const defaultForm = {
  name: '',
  source: '',
  destType: 'SRT Out',
  destUrl: '',
}

function NewRouteModal({ streams, onClose, onSubmit, loading }) {
  const [form, setForm] = useState(defaultForm)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit(form)
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-6 w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-medium text-base">New route</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Route name</label>
            <input
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-600"
              placeholder="Studio A → CDN"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Source stream</label>
            <select
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={form.source}
              onChange={e => set('source', e.target.value)}
              required
            >
              <option value="">Select a stream…</option>
              {streams.map(s => (
                <option key={s.path || s.name} value={s.path || s.name}>
                  {s.name || s.path}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Destination type</label>
            <select
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={form.destType}
              onChange={e => set('destType', e.target.value)}
            >
              {DEST_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Destination URL</label>
            <input
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-600"
              placeholder="srt://10.0.0.1:9000"
              value={form.destUrl}
              onChange={e => set('destUrl', e.target.value)}
              required
            />
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 hover:text-white border border-[#222233] rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
            >
              {loading ? 'Creating…' : 'Create route'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddDestModal({ onClose, onAdd }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-6 w-full max-w-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-medium text-base">Add destination</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <div className="flex flex-col gap-3">
          <input
            className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-600"
            placeholder="Label (e.g. CDN Primary)"
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <input
            className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-600"
            placeholder="srt://host:port"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <div className="flex gap-2 justify-end mt-1">
            <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white border border-[#222233] rounded-lg">
              Cancel
            </button>
            <button
              onClick={() => { if (label && url) { onAdd({ label, url }); onClose() } }}
              className="px-3 py-1.5 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
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
    <div className="p-6 min-h-screen bg-[#0a0a0f]">
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-white text-xl font-medium">Signal router</h1>
          <p className="text-gray-500 text-sm mt-0.5">Route live streams to any number of destinations</p>
        </div>
        <button
          onClick={() => setShowNewRoute(true)}
          className="flex items-center gap-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <span className="text-base leading-none">+</span> New route
        </button>
      </div>

      {/* Main layout */}
      <div className="flex gap-4" style={{ alignItems: 'flex-start' }}>

        {/* Routing Matrix — 60% */}
        <div className="bg-[#111118] border border-[#222233] rounded-xl overflow-hidden" style={{ flex: '0 0 60%' }}>
          <div className="px-4 py-3 border-b border-[#222233]">
            <h2 className="text-white text-sm font-medium">Routing matrix</h2>
            <p className="text-gray-500 text-xs mt-0.5">Click a cell to toggle routing</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-[#222233]">
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
                      className="w-7 h-7 rounded-lg border border-dashed border-[#333355] text-indigo-400 hover:border-indigo-500 hover:bg-indigo-500/10 transition-colors text-base leading-none flex items-center justify-center mx-auto"
                    >
                      +
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
                      <td className="px-4 py-3 text-gray-200 text-sm font-medium border-r border-[#222233]">
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
                                  : 'bg-transparent border-[#222233] hover:border-[#444466] hover:bg-white/5'
                              }`}
                              title={routed ? 'Click to unroute' : 'Click to route'}
                            >
                              {routed && (
                                <span className="text-emerald-400 text-xs font-bold">✓</span>
                              )}
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
        </div>

        {/* Active Routes — 40% */}
        <div className="bg-[#111118] border border-[#222233] rounded-xl overflow-hidden" style={{ flex: '0 0 calc(40% - 1rem)' }}>
          <div className="px-4 py-3 border-b border-[#222233] flex items-center justify-between">
            <div>
              <h2 className="text-white text-sm font-medium">Active routes</h2>
              <p className="text-gray-500 text-xs mt-0.5">{routes.length} configured</p>
            </div>
            <button
              onClick={() => setShowNewRoute(true)}
              className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/60 px-2.5 py-1 rounded-lg transition-colors"
            >
              + Add route
            </button>
          </div>
          <div className="divide-y divide-[#222233]">
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
                      <div className="text-xs text-gray-600 mt-0.5">
                        {(route.bitrate_kbps / 1000).toFixed(1)} Mbps
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                      route.active
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-gray-500/15 text-gray-400'
                    }`}>
                      {route.active ? 'Active' : 'Inactive'}
                    </span>
                    <div className="flex gap-1.5 mt-0.5">
                      <button
                        onClick={() => toggleMut.mutate({ id: route.id, active: route.active })}
                        disabled={toggleMut.isPending}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/60 px-2 py-0.5 rounded transition-colors disabled:opacity-40"
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
        </div>
      </div>
    </div>
  )
}
