import { useState, useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, User, AlertCircle, Loader2 } from 'lucide-react'
import { login } from '../api/client'
import { useAuthStore } from '../store/auth'

function LogoMark({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none">
      <rect width="36" height="36" rx="9" fill="#6366f1" />
      <rect x="8" y="12" width="2.5" height="12" rx="1.25" fill="white" />
      <polygon fill="white" points="14,10.5 26,18 14,25.5" />
    </svg>
  )
}

function Field({ id, label, icon: Icon, ...inputProps }) {
  return (
    <div className="mb-3.5">
      <label
        htmlFor={id}
        className="block text-[11.5px] font-bold uppercase tracking-wider text-gray-500 mb-1.5"
      >
        {label}
      </label>
      <div className="group flex items-center gap-2.5 h-11 px-3.5 rounded-lg bg-surface-900 border border-surface-600 transition-colors focus-within:border-brand-500 focus-within:shadow-[0_0_0_3px_rgba(99,102,241,0.18)]">
        <Icon size={16} className="shrink-0 text-gray-600 transition-colors group-focus-within:text-brand-400" />
        <input
          id={id}
          className="flex-1 bg-transparent border-none outline-none text-gray-200 text-sm placeholder:text-gray-700"
          {...inputProps}
        />
      </div>
    </div>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)
  const token = useAuthStore((s) => s.token)

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const usernameId = useId()
  const passwordId = useId()

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
      const tok = data.access_token
      const user = data.user ?? { username: username.trim() }
      setAuth(tok, user)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (err?.response?.status === 401) {
        setError('Invalid username or password.')
      } else if (err?.response?.status === 429) {
        setError(typeof detail === 'string' ? detail : 'Too many attempts. Try again shortly.')
      } else if (typeof detail === 'string') {
        setError(detail)
      } else {
        setError('Could not reach the server. Check your connection.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-5 bg-surface-900 bg-grid">
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(circle at 50% 0%, rgba(99,102,241,0.10) 0%, transparent 55%)' }}
      />

      <div className="relative z-10 w-full max-w-[400px]">
        <div className="bg-gradient-to-br from-[#151520] to-surface-800 border border-surface-600 rounded-2xl px-9 py-10 shadow-[0_24px_64px_rgba(0,0,0,0.55),0_0_0_1px_rgba(99,102,241,0.06)]">
          <div className="text-center mb-9">
            <div className="flex justify-center mb-4.5">
              <LogoMark size={48} />
            </div>
            <h1 className="m-0 mb-1.5 text-[22px] font-extrabold tracking-tight text-gray-100 text-balance">
              Arena
            </h1>
            <p className="m-0 text-[13px] text-gray-600 uppercase tracking-wider font-semibold">
              Professional Stream Management
            </p>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 mb-5 px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-[13px] leading-relaxed">
              <AlertCircle size={16} className="shrink-0 mt-px" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <Field
              id={usernameId}
              label="Username"
              icon={User}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="your-username"
              disabled={loading}
              required
            />

            <div className="mb-7">
              <Field
                id={passwordId}
                label="Password"
                icon={Lock}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`flex items-center justify-center gap-2 w-full h-11 rounded-lg text-white text-sm font-bold tracking-tight transition-all ${
                loading
                  ? 'bg-brand-500/50 cursor-not-allowed'
                  : 'bg-gradient-to-br from-brand-500 to-violet-600 shadow-[0_4px_20px_rgba(99,102,241,0.35)] hover:opacity-90 hover:-translate-y-px active:translate-y-0'
              }`}
            >
              {loading ? <><Loader2 size={18} className="animate-spin" /> Signing in…</> : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center mt-5 text-xs text-gray-700 tracking-wide">
          Arena — SDI Stream Management
        </p>
      </div>
    </div>
  )
}
