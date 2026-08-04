import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Search, Activity, LayoutGrid, Radio, LayoutPanelTop, Waypoints,
  CirclePlay, BarChart3, BellRing, Settings, Smartphone, ArrowRight,
} from 'lucide-react'
import { getStreams } from '../api/client'

// Global Cmd/Ctrl+K jump-to-anything — every page plus every live stream's
// stats view, filtered as you type. Own small page list rather than sharing
// Layout's NAV_ITEMS: Layout's list is scoped to what belongs in the
// sidebar (no Settings/Companion in the main group); this one is scoped to
// "everywhere you could want to jump", which is a different set.
const PAGES = [
  { path: '/overview',    label: 'Overview',       Icon: Activity },
  { path: '/dashboard',   label: 'Dashboard',      Icon: LayoutGrid },
  { path: '/streams',     label: 'Streams',        Icon: Radio },
  { path: '/multiviewer', label: 'Multiviewer',    Icon: LayoutPanelTop },
  { path: '/router',      label: 'Router',         Icon: Waypoints },
  { path: '/recordings',  label: 'Recordings',     Icon: CirclePlay },
  { path: '/stats',       label: 'Statistics',     Icon: BarChart3 },
  { path: '/alerts',      label: 'Alerts',         Icon: BellRing },
  { path: '/settings',    label: 'Settings',       Icon: Settings },
  { path: '/companion',   label: 'Companion view', Icon: Smartphone },
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  const { data: streams = [] } = useQuery({
    queryKey: ['streams'],
    queryFn: getStreams,
    enabled: open,
  })

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pageResults = PAGES
      .filter(p => !q || p.label.toLowerCase().includes(q))
      .map(p => ({ kind: 'page', key: p.path, label: p.label, Icon: p.Icon, go: () => navigate(p.path) }))
    const streamResults = streams
      .filter(s => !q || (s.name || s.path || '').toLowerCase().includes(q))
      .map(s => ({
        kind: 'stream',
        key: `stream-${s.path || s.name}`,
        label: s.name || s.path,
        Icon: Radio,
        go: () => navigate(`/stats?stream=${encodeURIComponent(s.path || s.name)}`),
      }))
    return [...pageResults, ...streamResults]
  }, [query, streams, navigate])

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(v => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      // Let the modal mount before focusing — a same-tick focus can lose
      // the race with the Cmd/Ctrl+K keydown that's still bubbling.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  function select(result) {
    if (!result) return
    result.go()
    setOpen(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(results[activeIndex])
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg mx-4 bg-surface-800 border border-surface-600 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-surface-600">
          <Search size={16} className="text-gray-500 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to a page or stream…"
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 focus:outline-none"
            aria-label="Search pages and streams"
          />
          <kbd className="text-[10px] text-gray-500 border border-surface-600 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-[320px] overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">No matches</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.key}
                onClick={() => select(r)}
                onMouseEnter={() => setActiveIndex(i)}
                className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors ${
                  i === activeIndex ? 'bg-brand-500/15 text-white' : 'text-gray-300 hover:bg-surface-750'
                }`}
              >
                <r.Icon size={15} className={i === activeIndex ? 'text-brand-400' : 'text-gray-500'} />
                <span className="flex-1 text-sm truncate">{r.label}</span>
                {r.kind === 'stream' && <span className="text-[10px] text-gray-500 uppercase tracking-wider shrink-0">Stream</span>}
                {i === activeIndex && <ArrowRight size={13} className="text-brand-400 shrink-0" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
