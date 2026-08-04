import { Outlet, Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import {
  Activity, LayoutGrid, Radio, LayoutPanelTop, Waypoints, CirclePlay,
  BarChart3, BellRing, Settings, LogOut, ChevronDown, Menu, X, Smartphone,
} from 'lucide-react'
import { useAuthStore } from '../../store/auth'
import StatusDot from '../ui/StatusDot'

// Lazy — pulls in api/client.js (axios + every endpoint), which every page
// already loads on its own dynamic-import chunk. Importing it eagerly here
// would drag that whole module into the main entry bundle just for a
// floating widget most sessions never open.
const AssistantWidget = lazy(() => import('../AssistantWidget'))
const CommandPalette = lazy(() => import('../CommandPalette'))

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { path: '/overview',    label: 'Overview',    Icon: Activity },
  { path: '/dashboard',   label: 'Dashboard',   Icon: LayoutGrid },
  { path: '/streams',     label: 'Streams',     Icon: Radio },
  { path: '/multiviewer', label: 'Multiviewer', Icon: LayoutPanelTop },
  { path: '/router',      label: 'Router',      Icon: Waypoints },
  { path: '/recordings',  label: 'Recordings',  Icon: CirclePlay },
  { path: '/stats',       label: 'Statistics',  Icon: BarChart3 },
  { path: '/alerts',      label: 'Alerts',      Icon: BellRing },
]

const PAGE_TITLES = {
  '/overview':    'Overview',
  '/dashboard':   'Dashboard',
  '/streams':     'Streams',
  '/multiviewer': 'Multiviewer',
  '/router':      'Router',
  '/recordings':  'Recordings',
  '/stats':       'Statistics',
  '/alerts':      'Alerts',
  '/settings':    'Settings',
}

// ── Logo ──────────────────────────────────────────────────────────────────────

function LogoMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" fill="none">
      <rect width="26" height="26" rx="7" fill="url(#logoGrad)" />
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="26" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <polygon fill="white" fillOpacity="0.95" points="10,8 19,13 10,18" />
      <line x1="6" y1="8" x2="6" y2="18" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeOpacity="0.95" />
    </svg>
  )
}

// ── Health hook ───────────────────────────────────────────────────────────────

function useApiHealth() {
  const [online, setOnline] = useState(null)
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(3000) })
        if (!cancelled) setOnline(res.ok)
      } catch {
        if (!cancelled) setOnline(false)
      }
    }
    check()
    const id = setInterval(check, 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])
  return online
}

// ── Nav link ──────────────────────────────────────────────────────────────────

function NavItem({ path, label, Icon, onNavigate }) {
  return (
    <NavLink
      to={path}
      onClick={onNavigate}
      className={({ isActive }) =>
        `group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] tracking-tight transition-all border-l-2 ${
          isActive
            ? 'text-brand-200 bg-gradient-to-r from-brand-500/15 to-transparent border-brand-400 font-semibold shadow-[inset_0_0_20px_-8px_rgba(129,140,248,0.5)]'
            : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/[0.04] font-medium'
        }`
      }
    >
      <Icon size={17} strokeWidth={1.75} />
      <span>{label}</span>
    </NavLink>
  )
}

// ── User dropdown ─────────────────────────────────────────────────────────────

function UserDropdown({ user, onLogout }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const initials = user
    ? (user.full_name || user.username || 'U').slice(0, 2).toUpperCase()
    : 'U'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg border transition-colors ${
          open
            ? 'bg-brand-500/10 border-brand-500/30'
            : 'bg-transparent border-white/[0.06] hover:bg-white/[0.04] hover:border-white/10'
        }`}
      >
        <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center text-[11px] font-bold text-white tracking-wide bg-gradient-to-br from-brand-400 to-violet-500">
          {initials}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="text-[12.5px] font-semibold text-gray-200 truncate">
            {user?.username || 'User'}
          </div>
          {user?.role && (
            <div className="text-[10.5px] text-brand-400 uppercase tracking-wider mt-px">
              {user.role}
            </div>
          )}
        </div>
        <ChevronDown size={13} className="text-gray-400 shrink-0" />
      </button>

      {open && (
        <div
          className="absolute bottom-[calc(100%+8px)] left-0 right-0 bg-[rgba(10,10,20,0.96)] backdrop-blur-xl border border-white/[0.08] rounded-xl overflow-hidden shadow-[0_-16px_40px_rgba(0,0,0,0.5)] z-[200]"
          role="menu"
        >
          <div className="px-3 py-2.5 border-b border-white/[0.06]">
            <div className="text-[11px] text-gray-400 mb-0.5">Signed in as</div>
            <div className="text-[13px] font-semibold text-gray-200">{user?.username || '—'}</div>
          </div>
          <Link
            to="/companion"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 w-full px-3 py-2.5 bg-transparent hover:bg-white/[0.04] text-gray-300 text-[13px] transition-colors"
            role="menuitem"
          >
            <Smartphone size={15} />
            Companion view
          </Link>
          <button
            onClick={() => { setOpen(false); onLogout() }}
            className="flex items-center gap-2 w-full px-3 py-2.5 bg-transparent hover:bg-red-500/10 text-red-400 text-[13px] transition-colors"
            role="menuitem"
          >
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const apiOnline = useApiHealth()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const pageTitle = Object.entries(PAGE_TITLES).find(([p]) =>
    location.pathname.startsWith(p)
  )?.[1] ?? 'ArenaHub'

  function handleLogout() {
    logout()
    navigate('/login')
  }

  // Below md (768px) the 220px sidebar would leave under 160px for content
  // — genuinely unusable, not just cramped. Below that width it's an
  // off-canvas drawer instead: hidden by default, slides in over the page
  // rather than squeezing it.
  useEffect(() => setMobileNavOpen(false), [location.pathname])

  const healthTone = apiOnline === null ? 'muted' : apiOnline ? 'good' : 'critical'
  const healthLabel = apiOnline === null ? 'Connecting' : apiOnline ? 'Online' : 'Offline'

  return (
    <div className="flex h-screen overflow-hidden bg-surface-950">
      {/* Skip link — invisible until focused, so keyboard users get one Tab
          to reach page content instead of tabbing through the entire
          sidebar nav on every single page load/navigation. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[300] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-brand-600 focus:text-white focus:text-sm focus:font-semibold focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Mobile backdrop — closes the drawer on tap-outside */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-[150] md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar ── */}
      <nav
        aria-label="Main navigation"
        className={`fixed inset-y-0 left-0 w-[220px] shrink-0 flex flex-col z-[200] bg-gradient-to-b from-[#0c0c18] to-[#0a0a15] border-r border-white/[0.055] shadow-[4px_0_24px_rgba(0,0,0,0.3)] transition-transform duration-200 md:static md:z-[100] md:translate-x-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >

        {/* Brand */}
        <div className="flex items-center justify-between px-4 pt-6 pb-5 border-b border-white/5">
          <div className="flex items-center gap-2.5 px-0.5">
            <LogoMark size={30} />
            <span className="text-[18px] font-extrabold tracking-tight bg-gradient-to-r from-indigo-300 via-violet-300 to-signal-400 bg-clip-text text-transparent">
              ArenaHub
            </span>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="md:hidden text-gray-500 hover:text-white"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav items */}
        <div className="flex-1 flex flex-col gap-0.5 px-2.5 py-2.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => (
            <NavItem key={item.path} {...item} onNavigate={() => setMobileNavOpen(false)} />
          ))}

          <div className="h-px bg-white/5 my-1.5 mx-0.5" />

          <NavItem path="/settings" label="Settings" Icon={Settings} onNavigate={() => setMobileNavOpen(false)} />
        </div>

        {/* Bottom: status + user */}
        <div className="px-2.5 py-3 border-t border-white/5 flex flex-col gap-2.5">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.03]">
            <StatusDot tone={healthTone} pulse={apiOnline === true} size={7} />
            <span className="text-[11.5px] font-medium text-gray-400">API {healthLabel}</span>
          </div>
          <UserDropdown user={user} onLogout={handleLogout} />
        </div>
      </nav>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="relative h-[72px] shrink-0 flex items-center gap-3 px-4 sm:px-7 z-50 bg-[rgba(5,5,8,0.75)] backdrop-blur-xl border-b border-white/[0.06] overflow-hidden">
          {/* Ambient accent glow, keyed to the page you're on — quiet, not a hero */}
          <div className="absolute -top-16 left-8 w-64 h-32 bg-brand-500/10 blur-3xl rounded-full pointer-events-none" />
          <button
            onClick={() => setMobileNavOpen(true)}
            className="relative md:hidden text-gray-400 hover:text-white shrink-0"
            aria-label="Open navigation"
          >
            <Menu size={22} />
          </button>
          <h1 className="relative flex-1 min-w-0 m-0 text-xl sm:text-[26px] font-extrabold tracking-tight bg-gradient-to-r from-gray-50 to-gray-400 bg-clip-text text-transparent text-balance truncate">
            {pageTitle}
          </h1>
          <div className="relative hidden md:flex items-center gap-1.5 text-[11px] text-gray-500 shrink-0">
            <kbd className="border border-surface-600 rounded px-1.5 py-0.5 font-mono">⌘K</kbd>
            <span>to jump anywhere</span>
          </div>
          <div className="relative hidden sm:block text-[11px] font-semibold text-gray-400 uppercase tracking-[0.15em] shrink-0">
            ArenaHub
          </div>
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      <Suspense fallback={null}>
        <AssistantWidget />
      </Suspense>
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </div>
  )
}
