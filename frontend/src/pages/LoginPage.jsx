import { useState, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../api/client'
import { useAuthStore } from '../store/auth'

// ── Inline icon: stream symbol ────────────────────────────────────────────────

function LogoMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="9" fill="#6366f1" />
      <rect x="8" y="12" width="2.5" height="12" rx="1.25" fill="white" />
      <polygon fill="white" points="14,10.5 26,18 14,25.5" />
    </svg>
  )
}

function IconLock({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="7" width="10" height="8" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  )
}

function IconUser({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M2.5 14c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" />
    </svg>
  )
}

function IconAlert({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="5" x2="8" y2="9" />
      <circle cx="8" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      style={{ animation: 'spin 0.75s linear infinite' }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
      <path d="M9 2a7 7 0 0 1 7 7" stroke="white" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

// ── LoginPage ─────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const token = useAuthStore((s) => s.token)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [userFocus, setUserFocus] = useState(false)
  const [passFocus, setPassFocus] = useState(false)

  const usernameId = useId()
  const passwordId = useId()

  // Already authenticated — redirect immediately
  if (token) {
    navigate('/dashboard', { replace: true })
    return null
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Enter your username and password.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await login(username.trim(), password)
      // data = { access_token, token_type, user } (or similar from FastAPI)
      const tok = data.access_token
      const user = data.user ?? { username: username.trim() }
      setAuth(tok, user)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 401) {
        setError('Invalid username or password.')
      } else if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError('Could not reach the server. Check your connection.')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Shared input field styles ──────────────────────────────────────────────

  function fieldWrap(focused) {
    return {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      background: '#0a0a0f',
      border: `1px solid ${focused ? '#6366f1' : '#222233'}`,
      borderRadius: 8,
      padding: '0 14px',
      height: 44,
      transition: 'border-color 0.15s, box-shadow 0.15s',
      boxShadow: focused ? '0 0 0 3px rgba(99,102,241,0.18)' : 'none',
    }
  }

  const inputStyle = {
    flex: 1,
    background: 'none',
    border: 'none',
    outline: 'none',
    color: '#e2e8f0',
    fontSize: 14,
    fontFamily: 'inherit',
    padding: '0',
  }

  const iconColor = '#475569'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        // Subtle grid texture
        backgroundImage:
          'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.08) 0%, transparent 55%)',
      }}
    >
      {/* Faint grid lines behind everything */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(34,34,51,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(34,34,51,0.4) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 400 }}>
        {/* ── Card ── */}
        <div
          style={{
            background: 'linear-gradient(160deg, #151520 0%, #111118 100%)',
            border: '1px solid #222233',
            borderRadius: 16,
            padding: '40px 36px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.55), 0 0 0 1px rgba(99,102,241,0.06)',
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <LogoMark size={48} />
            </div>
            <h1
              style={{
                margin: '0 0 6px',
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: '#f1f5f9',
                textWrap: 'balance',
              }}
            >
              Arena
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: '#475569',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              Professional Stream Management
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div
              role="alert"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                background: 'rgba(239,68,68,0.10)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 8,
                padding: '10px 13px',
                marginBottom: 20,
                color: '#fca5a5',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 1 }}><IconAlert /></span>
              <span>{error}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: 14 }}>
              <label
                htmlFor={usernameId}
                style={{
                  display: 'block',
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: '#64748b',
                  marginBottom: 7,
                }}
              >
                Username
              </label>
              <div style={fieldWrap(userFocus)}>
                <span style={{ color: userFocus ? '#6366f1' : iconColor, transition: 'color 0.15s', flexShrink: 0 }}>
                  <IconUser />
                </span>
                <input
                  id={usernameId}
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setUserFocus(true)}
                  onBlur={() => setUserFocus(false)}
                  style={inputStyle}
                  placeholder="your-username"
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <div style={{ marginBottom: 28 }}>
              <label
                htmlFor={passwordId}
                style={{
                  display: 'block',
                  fontSize: 11.5,
                  fontWeight: 700,
                  letterSpacing: '0.07em',
                  textTransform: 'uppercase',
                  color: '#64748b',
                  marginBottom: 7,
                }}
              >
                Password
              </label>
              <div style={fieldWrap(passFocus)}>
                <span style={{ color: passFocus ? '#6366f1' : iconColor, transition: 'color 0.15s', flexShrink: 0 }}>
                  <IconLock />
                </span>
                <input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setPassFocus(true)}
                  onBlur={() => setPassFocus(false)}
                  style={inputStyle}
                  placeholder="••••••••"
                  disabled={loading}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 9,
                width: '100%',
                height: 44,
                background: loading
                  ? 'rgba(99,102,241,0.5)'
                  : 'linear-gradient(135deg, #6366f1 0%, #7c3aed 100%)',
                border: 'none',
                borderRadius: 8,
                color: 'white',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'opacity 0.15s, transform 0.1s, box-shadow 0.15s',
                boxShadow: loading ? 'none' : '0 4px 20px rgba(99,102,241,0.35)',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                if (!loading) {
                  e.currentTarget.style.opacity = '0.92'
                  e.currentTarget.style.transform = 'translateY(-1px)'
                }
              }}
              onMouseLeave={e => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
              onMouseDown={e => {
                if (!loading) e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              {loading ? <><Spinner /> Signing in…</> : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Footer note */}
        <p
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontSize: 12,
            color: '#334155',
            letterSpacing: '0.02em',
          }}
        >
          Arena — SDI Stream Management
        </p>
      </div>
    </div>
  )
}
