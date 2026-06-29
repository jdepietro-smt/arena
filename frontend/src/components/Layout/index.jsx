import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { useAuthStore } from '../../store/auth'

// ── Inline SVG icons ──────────────────────────────────────────────────────────

function IconDashboard({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="7" height="7" rx="1.5" />
      <rect x="11" y="2" width="7" height="7" rx="1.5" />
      <rect x="2" y="11" width="7" height="7" rx="1.5" />
      <rect x="11" y="11" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function IconStreams({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <polygon fill="currentColor" stroke="none" points="8,7 14,10 8,13" />
    </svg>
  )
}

function IconRouter({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h14" />
      <path d="M3 10h14" />
      <path d="M3 15h14" />
      <path d="M14 2l3 3-3 3" />
      <path d="M6 12l-3 3 3 3" />
    </svg>
  )
}

function IconRecordings({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="8" />
      <circle cx="10" cy="10" r="3.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconStats({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 15l4-5 3 3 4-6 3 2" />
      <line x1="3" y1="18" x2="17" y2="18" />
    </svg>
  )
}

function IconSettings({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="2.5" />
      <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" />
    </svg>
  )
}

function IconArena({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none">
      <rect x="1" y="1" width="20" height="20" rx="5" fill="#6366f1" />
      <polygon fill="white" points="8,7 16,11 8,15" />
      <line x1="5" y1="7" x2="5" y2="15" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function IconChevronDown({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5l4 4 4-4" />
    </svg>
  )
}

function IconLogout({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      <path d="M10 11l3-3-3-3" />
      <line x1="13" y1="8" x2="6" y2="8" />
    </svg>
  )
}

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { path: '/dashboard',  label: 'Dashboard',  Icon: IconDashboard },
  { path: '/streams',    label: 'Streams',    Icon: IconStreams },
  { path: '/router',     label: 'Router',     Icon: IconRouter },
  { path: '/recordings', label: 'Recordings', Icon: IconRecordings },
  { path: '/stats',      label: 'Stats',      Icon: IconStats },
  { path: '/settings',   label: 'Settings',   Icon: IconSettings },
]

// ── Page title map ─────────────────────────────────────────────────────────────

const PAGE_TITLES = {
  '/dashboard':  'Dashboard',
  '/streams':    'Streams',
  '/router':     'Router',
  '/recordings': 'Recordings',
  '/stats':      'Statistics',
  '/settings':   'Settings',
}

// ── Connection status hook ────────────────────────────────────────────────────

function useApiHealth() {
  const [online, setOnline] = useState(null) // null = checking
  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/health', { method: 'GET', signal: AbortSignal.timeout(3000) })
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

// ── Avatar dropdown ───────────────────────────────────────────────────────────

function AvatarDropdown({ user, onLogout }) {
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
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 8px',
          borderRadius: 8,
          color: '#cbd5e1',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(99,102,241,0.12)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '0.05em',
            flexShrink: 0,
          }}
        >
          {initials}
        </div>
        <span style={{ fontSize: 13, fontWeight: 500, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.username || 'User'}
        </span>
        <span style={{ opacity: 0.5 }}><IconChevronDown /></span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            background: '#111118',
            border: '1px solid #222233',
            borderRadius: 10,
            minWidth: 180,
            boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
            overflow: 'hidden',
            zIndex: 200,
          }}
          role="menu"
        >
          <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid #222233' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>Signed in as</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{user?.username || '—'}</div>
            {user?.role && (
              <div style={{ fontSize: 11, color: '#6366f1', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {user.role}
              </div>
            )}
          </div>
          <button
            onClick={() => { setOpen(false); onLogout() }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              color: '#f87171',
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'background 0.12s',
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

export default function Layout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const apiOnline = useApiHealth()

  const pageTitle = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname.startsWith(path)
  )?.[1] ?? 'Arena'

  function handleLogout() {
    logout()
    navigate('/login')
  }

  // Status indicator config
  const statusConfig =
    apiOnline === null
      ? { color: '#94a3b8', label: 'Connecting…' }
      : apiOnline
      ? { color: '#22c55e', label: 'API Online' }
      : { color: '#ef4444', label: 'API Offline' }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0a0a0f' }}>
      {/* ── Sidebar ── */}
      <nav
        aria-label="Main navigation"
        style={{
          width: 64,
          flexShrink: 0,
          background: '#111118',
          borderRight: '1px solid #222233',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 16,
          paddingBottom: 16,
          gap: 4,
          zIndex: 100,
        }}
      >
        {/* Logo mark */}
        <div
          style={{
            marginBottom: 20,
            padding: '8px 0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <IconArena size={28} />
        </div>

        {/* Nav items */}
        {NAV_ITEMS.map(({ path, label, Icon }) => (
          <NavLink
            key={path}
            to={path}
            title={label}
            style={({ isActive }) => ({
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              width: 52,
              padding: '10px 0',
              borderRadius: 10,
              color: isActive ? '#6366f1' : '#475569',
              background: isActive ? 'rgba(99,102,241,0.10)' : 'none',
              textDecoration: 'none',
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              transition: 'color 0.15s, background 0.15s',
              position: 'relative',
              boxShadow: isActive ? 'inset 2px 0 0 #6366f1' : 'none',
            })}
            onMouseEnter={e => {
              if (!e.currentTarget.getAttribute('aria-current')) {
                e.currentTarget.style.color = '#94a3b8'
                e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
              }
            }}
            onMouseLeave={e => {
              // NavLink controls active styles via style prop, safe to reset hover only
              if (!e.currentTarget.classList.contains('active')) {
                e.currentTarget.style.color = ''
                e.currentTarget.style.background = ''
              }
            }}
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* ── Main column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ── Header ── */}
        <header
          style={{
            height: 56,
            flexShrink: 0,
            background: 'rgba(17,17,24,0.92)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid #222233',
            display: 'flex',
            alignItems: 'center',
            padding: '0 24px',
            gap: 16,
            zIndex: 50,
          }}
        >
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginRight: 8 }}>
            <IconArena size={20} />
            <span
              style={{
                fontSize: 15,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                background: 'linear-gradient(90deg, #a5b4fc 0%, #c4b5fd 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Arena
            </span>
          </div>

          {/* Separator */}
          <div style={{ width: 1, height: 20, background: '#222233' }} />

          {/* Page title */}
          <h1
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: '#e2e8f0',
              letterSpacing: '-0.01em',
              flex: 1,
            }}
          >
            {pageTitle}
          </h1>

          {/* Connection status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              padding: '4px 10px',
              borderRadius: 20,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid #222233',
            }}
            title={statusConfig.label}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: statusConfig.color,
                display: 'block',
                boxShadow: apiOnline ? `0 0 6px ${statusConfig.color}` : 'none',
                animation: apiOnline === true ? 'pulse-live 2s infinite' : 'none',
              }}
            />
            <span style={{ fontSize: 11.5, fontWeight: 500, color: '#64748b', letterSpacing: '0.02em' }}>
              {statusConfig.label}
            </span>
          </div>

          {/* Avatar / user menu */}
          <AvatarDropdown user={user} onLogout={handleLogout} />
        </header>

        {/* ── Content ── */}
        <main
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '28px 28px',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
