import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '../../store/auth'

// ── Icons ─────────────────────────────────────────────────────────────────────

function IconDashboard({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function IconStreams({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <polygon fill="currentColor" stroke="none" points="8.5,7 14,10 8.5,13" />
    </svg>
  )
}

function IconRouter({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6h16M2 10h16M2 14h16" />
      <path d="M13 3l3 3-3 3" />
      <path d="M7 11l-3 3 3 3" />
    </svg>
  )
}

function IconRecordings({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <circle cx="10" cy="10" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconStats({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3,15 7,9 10,12 14,6 17,8" />
      <line x1="3" y1="17" x2="17" y2="17" />
    </svg>
  )
}

function IconSettings({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
    </svg>
  )
}

function IconLogout({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      <path d="M10 11l3-3-3-3M13 8H6" />
    </svg>
  )
}

function IconChevronDown({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4.5l3.5 3.5 3.5-3.5" />
    </svg>
  )
}

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

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { path: '/dashboard',  label: 'Dashboard',  Icon: IconDashboard },
  { path: '/streams',    label: 'Streams',    Icon: IconStreams },
  { path: '/router',     label: 'Router',     Icon: IconRouter },
  { path: '/recordings', label: 'Recordings', Icon: IconRecordings },
  { path: '/stats',      label: 'Statistics', Icon: IconStats },
]

const PAGE_TITLES = {
  '/dashboard':  'Dashboard',
  '/streams':    'Streams',
  '/router':     'Router',
  '/recordings': 'Recordings',
  '/stats':      'Statistics',
  '/settings':   'Settings',
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
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: '8px 10px',
          background: open ? 'rgba(99,102,241,0.10)' : 'transparent',
          border: '1px solid',
          borderColor: open ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)',
          borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          if (!open) {
            e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)'
          }
        }}
        onMouseLeave={e => {
          if (!open) {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
          }
        }}
      >
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 700, color: '#fff', letterSpacing: '0.05em',
        }}>
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.username || 'User'}
          </div>
          {user?.role && (
            <div style={{ fontSize: 10.5, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 1 }}>
              {user.role}
            </div>
          )}
        </div>
        <span style={{ color: '#475569', flexShrink: 0 }}><IconChevronDown /></span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, right: 0,
          background: 'rgba(10,10,20,0.96)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 -16px 40px rgba(0,0,0,0.5)',
          zIndex: 200,
        }} role="menu">
          <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 11, color: '#475569', marginBottom: 2 }}>Signed in as</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{user?.username || '—'}</div>
          </div>
          <button
            onClick={() => { setOpen(false); onLogout() }}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '10px 12px',
              background: 'none', border: 'none', color: '#f87171',
              fontSize: 13, cursor: 'pointer', transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}
            role="menuitem"
          >
            <IconLogout />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// ── Layout ────────────────────────────────────────────────────────────────────

const S = {
  app: {
    display: 'flex', height: '100vh', overflow: 'hidden',
    background: '#07070d',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
  },
  sidebar: {
    width: 220, flexShrink: 0,
    background: 'linear-gradient(180deg, #0c0c18 0%, #0a0a15 100%)',
    borderRight: '1px solid rgba(255,255,255,0.055)',
    display: 'flex', flexDirection: 'column',
    zIndex: 100,
    boxShadow: '4px 0 24px rgba(0,0,0,0.3)',
  },
  sidebarTop: {
    padding: '20px 16px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  brand: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '4px 2px',
  },
  brandText: {
    fontSize: 16, fontWeight: 800, letterSpacing: '-0.03em',
    background: 'linear-gradient(90deg, #a5b4fc 0%, #c4b5fd 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
  },
  nav: {
    flex: 1, padding: '10px 10px',
    display: 'flex', flexDirection: 'column', gap: 2,
    overflowY: 'auto',
  },
  sidebarBottom: {
    padding: '12px 10px',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  statusRow: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px', borderRadius: 8,
    background: 'rgba(255,255,255,0.03)',
  },
  main: {
    flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  header: {
    height: 52, flexShrink: 0,
    background: 'rgba(7,7,13,0.85)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderBottom: '1px solid rgba(255,255,255,0.055)',
    display: 'flex', alignItems: 'center',
    padding: '0 24px', gap: 12,
    zIndex: 50,
  },
  content: {
    flex: 1, overflow: 'auto',
  },
}

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const apiOnline = useApiHealth()

  const pageTitle = Object.entries(PAGE_TITLES).find(([p]) =>
    location.pathname.startsWith(p)
  )?.[1] ?? 'ArenaHub'

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const dot = apiOnline === null ? '#475569' : apiOnline ? '#22c55e' : '#ef4444'
  const dotLabel = apiOnline === null ? 'Connecting' : apiOnline ? 'Online' : 'Offline'

  return (
    <div style={S.app}>
      {/* ── Sidebar ── */}
      <nav aria-label="Main navigation" style={S.sidebar}>

        {/* Brand */}
        <div style={S.sidebarTop}>
          <div style={S.brand}>
            <LogoMark size={26} />
            <span style={S.brandText}>ArenaHub</span>
          </div>
        </div>

        {/* Nav items */}
        <div style={S.nav}>
          {NAV_ITEMS.map(({ path, label, Icon }) => (
            <NavLink
              key={path}
              to={path}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 12px', borderRadius: 9,
                color: isActive ? '#a5b4fc' : '#64748b',
                background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                textDecoration: 'none',
                fontSize: 13.5, fontWeight: isActive ? 600 : 500,
                letterSpacing: '-0.01em',
                transition: 'all 0.13s',
                borderLeft: isActive ? '2px solid #6366f1' : '2px solid transparent',
                marginLeft: isActive ? 0 : 0,
              })}
              onMouseEnter={e => {
                if (!e.currentTarget.getAttribute('aria-current')) {
                  e.currentTarget.style.color = '#94a3b8'
                  e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                }
              }}
              onMouseLeave={e => {
                if (!e.currentTarget.getAttribute('aria-current')) {
                  e.currentTarget.style.color = '#64748b'
                  e.currentTarget.style.background = 'transparent'
                }
              }}
            >
              <Icon size={17} />
              <span>{label}</span>
            </NavLink>
          ))}

          {/* Divider before Settings */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)', margin: '6px 2px' }} />

          <NavLink
            to="/settings"
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 9,
              color: isActive ? '#a5b4fc' : '#64748b',
              background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
              textDecoration: 'none',
              fontSize: 13.5, fontWeight: isActive ? 600 : 500,
              letterSpacing: '-0.01em',
              transition: 'all 0.13s',
              borderLeft: isActive ? '2px solid #6366f1' : '2px solid transparent',
            })}
            onMouseEnter={e => {
              if (!e.currentTarget.getAttribute('aria-current')) {
                e.currentTarget.style.color = '#94a3b8'
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
              }
            }}
            onMouseLeave={e => {
              if (!e.currentTarget.getAttribute('aria-current')) {
                e.currentTarget.style.color = '#64748b'
                e.currentTarget.style.background = 'transparent'
              }
            }}
          >
            <IconSettings size={17} />
            <span>Settings</span>
          </NavLink>
        </div>

        {/* Bottom: status + user */}
        <div style={S.sidebarBottom}>
          {/* API status */}
          <div style={S.statusRow}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0,
              boxShadow: apiOnline ? `0 0 6px ${dot}` : 'none',
            }} />
            <span style={{ fontSize: 11.5, color: '#475569', fontWeight: 500 }}>API {dotLabel}</span>
          </div>

          {/* User */}
          <UserDropdown user={user} onLogout={handleLogout} />
        </div>
      </nav>

      {/* ── Main ── */}
      <div style={S.main}>
        {/* Header */}
        <header style={S.header}>
          <h1 style={{
            margin: 0, flex: 1,
            fontSize: 15, fontWeight: 700,
            color: '#e8eaf0', letterSpacing: '-0.02em',
          }}>
            {pageTitle}
          </h1>
          <div style={{
            fontSize: 11.5, fontWeight: 500, color: '#334155',
            letterSpacing: '0.03em', textTransform: 'uppercase',
          }}>
            ArenaHub
          </div>
        </header>

        {/* Content */}
        <main style={S.content}>
          <Outlet />
        </main>
      </div>

      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
