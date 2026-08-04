import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings as SettingsIcon, Radio, Download } from 'lucide-react'
import { getUsers, createUser, updateUser, deleteUser, getAuditLog, getLoginAttempts, clearLoginLockout } from '../api/client'
import { useAuthStore } from '../store/auth'
import api from '../api/client'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'
import Tabs from '../components/ui/Tabs'
import Button from '../components/ui/Button'
import StatusDot from '../components/ui/StatusDot'
import { toast } from '../store/toast'
import { scheduleDelete, usePendingDeleteIds } from '../store/pendingDelete'
import { getErrorMessage } from '../utils/errors'
import { downloadCsv } from '../utils/csv'

const TABS = [
  { value: 'server', label: 'Server' },
  { value: 'users', label: 'Users' },
  { value: 'recording', label: 'Recording' },
  { value: 'audit', label: 'Audit Log' },
  { value: 'about', label: 'About' },
]

const ACTION_LABEL = {
  'user.create': 'Created user',
  'user.update': 'Updated user',
  'user.delete': 'Deleted user',
  'route.create': 'Created route',
  'route.delete': 'Deleted route',
  'alert_rule.create': 'Created alert rule',
  'alert_rule.delete': 'Deleted alert rule',
  'webhook.test': 'Sent test webhook alert',
  'login_lockout.clear': 'Cleared login lockout',
}

function formatAuditTimestamp(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const ROLES = ['admin', 'operator', 'viewer']

const defaultUserForm = { username: '', email: '', password: '', role: 'operator' }

const inputClass = 'bg-surface-900 border border-surface-500 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500 placeholder-gray-600'

function FieldRow({ label, value, muted }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-surface-600 last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-medium font-mono ${muted ? 'text-gray-500' : 'text-gray-100'}`}>{value || '—'}</span>
    </div>
  )
}

function AddUserModal({ onClose, onSubmit, loading }) {
  const [form, setForm] = useState(defaultUserForm)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <Modal open onClose={onClose} maxWidth="max-w-sm">
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-base">Add user</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSubmit(form) }} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Username</label>
            <input
              className={inputClass}
              placeholder="operator1"
              value={form.username}
              onChange={e => set('username', e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Email</label>
            <input
              type="email"
              className={inputClass}
              placeholder="operator1@arena.local"
              value={form.email}
              onChange={e => set('email', e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Password</label>
            <input
              type="password"
              className={inputClass}
              placeholder="Minimum 8 characters"
              value={form.password}
              onChange={e => set('password', e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Role</label>
            <select className={inputClass} value={form.role} onChange={e => set('role', e.target.value)}>
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create user'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

function EditUserModal({ user, onClose, onSubmit, loading, isSelf }) {
  const [role, setRole] = useState(user.role)
  const [isActive, setIsActive] = useState(user.is_active !== false)
  const [password, setPassword] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    const body = { role, is_active: isActive }
    if (password) body.password = password
    onSubmit(body)
  }

  return (
    <Modal open onClose={onClose} maxWidth="max-w-sm">
      <div className="p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-base">Edit {user.username}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Role</label>
            <select
              className={inputClass}
              value={role}
              onChange={e => setRole(e.target.value)}
              disabled={isSelf}
            >
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
            {isSelf && <p className="text-[11px] text-gray-500">You can't change your own role.</p>}
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">Active</label>
            <button
              type="button"
              disabled={isSelf}
              onClick={() => setIsActive(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors disabled:opacity-40 ${isActive ? 'bg-brand-500' : 'bg-surface-600'}`}
              aria-pressed={isActive}
              aria-label="Active"
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : ''}`} />
            </button>
          </div>
          {isSelf && <p className="text-[11px] text-gray-500 -mt-2">You can't deactivate your own account.</p>}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">New password (optional)</label>
            <input
              type="password"
              className={inputClass}
              placeholder="Leave blank to keep current password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
            />
          </div>
          <div className="flex gap-2 justify-end mt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={loading}>
              {loading ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  )
}

// --- Tabs ---

function AlertWebhookCard({ configured }) {
  const [result, setResult] = useState(null) // { ok, message } | null

  const mutation = useMutation({
    mutationFn: () => api.post('/settings/test-webhook'),
    onSuccess: () => setResult({ ok: true, message: 'Test alert sent successfully.' }),
    onError: (err) => setResult({ ok: false, message: getErrorMessage(err, 'Test alert failed.') }),
  })

  return (
    <Card className="p-4">
      <h3 className="text-white text-sm font-semibold mb-1">Alert webhook</h3>
      <p className="text-gray-500 text-xs mb-4">Where stream-down and threshold-breach alerts get posted</p>
      <FieldRow
        label="Status"
        value={configured ? 'Configured' : 'Not configured'}
        muted={!configured}
      />
      <div className="flex items-center gap-3 mt-3">
        <Button
          variant="ghost" size="sm"
          disabled={!configured || mutation.isPending}
          onClick={() => { setResult(null); mutation.mutate() }}
        >
          {mutation.isPending ? 'Sending…' : 'Send test alert'}
        </Button>
        {result && (
          <span className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>{result.message}</span>
        )}
      </div>
      {!configured && (
        <p className="text-gray-500 text-xs mt-2">Set ALERT_WEBHOOK_URL in the server's .env to enable alert delivery.</p>
      )}
    </Card>
  )
}

function formatLockoutRemaining(seconds) {
  const mins = Math.ceil(seconds / 60)
  return `${mins} min${mins === 1 ? '' : 's'}`
}

function LoginAttemptsCard() {
  const qc = useQueryClient()

  const { data: attempts = [] } = useQuery({
    queryKey: ['login-attempts'],
    queryFn: getLoginAttempts,
    refetchInterval: 10000,
  })

  const clearMut = useMutation({
    mutationFn: clearLoginLockout,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['login-attempts'] })
      toast.success('Lockout cleared')
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Failed to clear lockout')),
  })

  if (attempts.length === 0) return null

  return (
    <Card className="p-4">
      <h3 className="text-white text-sm font-semibold mb-1">Login attempts</h3>
      <p className="text-gray-500 text-xs mb-4">IPs with recent failed logins — 5 failures in 15 minutes locks out for 15 minutes</p>
      <div className="flex flex-col gap-2">
        {attempts.map(a => (
          <div key={a.ip} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-900 border border-surface-600">
            <div className="flex items-center gap-2 min-w-0">
              <StatusDot tone={a.locked ? 'critical' : 'warning'} pulse={a.locked} size={7} />
              <span className="text-sm font-mono text-gray-200 truncate">{a.ip}</span>
              <span className="text-xs text-gray-500">
                {a.attempt_count} attempt{a.attempt_count === 1 ? '' : 's'}
                {a.locked && ` · locked, unlocks in ${formatLockoutRemaining(a.seconds_remaining)}`}
              </span>
            </div>
            {a.locked && (
              <Button
                variant="ghost" size="sm"
                disabled={clearMut.isPending}
                onClick={() => clearMut.mutate(a.ip)}
              >
                Unlock
              </Button>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

function ServerTab() {
  const { data: config } = useQuery({
    queryKey: ['server-config'],
    queryFn: () => api.get('/settings/server').then(r => r.data).catch(() => ({})),
  })

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="text-white text-sm font-semibold mb-1">Server configuration</h3>
        <p className="text-gray-500 text-xs mb-4">Read from environment / backend config</p>
        <FieldRow label="Server IP" value={config?.server_ip || window.location.hostname} />
        <FieldRow label="mediamtx API URL" value={config?.mediamtx_api_url} />
        <FieldRow label="SRT listen port" value={config?.srt_port} />
        <FieldRow label="HLS base URL" value={config?.hls_base_url} />
      </Card>
      <AlertWebhookCard configured={!!config?.webhook_configured} />
      <LoginAttemptsCard />
      <Card className="p-4">
        <h3 className="text-white text-sm font-semibold mb-1">TURN server</h3>
        <p className="text-gray-500 text-xs mb-4">WebRTC relay configuration</p>
        <FieldRow label="TURN host" value={config?.turn_host} muted={!config?.turn_host} />
        <FieldRow label="TURN port" value={config?.turn_port} muted={!config?.turn_port} />
        <FieldRow label="TURN username" value={config?.turn_username} muted={!config?.turn_username} />
        <FieldRow label="Status" value={config?.turn_enabled ? 'Enabled' : 'Disabled'} muted={!config?.turn_enabled} />
      </Card>
    </div>
  )
}

function UsersTab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const pendingDeleteIds = usePendingDeleteIds()
  const currentUsername = useAuthStore(s => s.user?.username)

  const { data: allUsers = [], isLoading, isError } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })
  const users = allUsers.filter(u => !pendingDeleteIds.has(u.id))

  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowAdd(false)
      toast.success('User created')
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Failed to create user')),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, body }) => updateUser(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setEditingUser(null)
      toast.success('User updated')
    },
    onError: (err) => toast.error(getErrorMessage(err, 'Failed to update user')),
  })

  function handleDelete(user) {
    scheduleDelete({
      id: user.id,
      label: 'User',
      onDelete: async () => {
        await deleteUser(user.id)
        qc.invalidateQueries({ queryKey: ['users'] })
      },
      onError: (err) => toast.error(getErrorMessage(err, 'Failed to remove user')),
    })
  }

  const roleTone = (role) => {
    if (role === 'admin') return 'critical'
    if (role === 'operator') return 'info'
    return 'muted'
  }

  return (
    <div>
      {showAdd && (
        <AddUserModal
          loading={createMut.isPending}
          onClose={() => setShowAdd(false)}
          onSubmit={(form) => createMut.mutate(form)}
        />
      )}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          isSelf={editingUser.username === currentUsername}
          loading={updateMut.isPending}
          onClose={() => setEditingUser(null)}
          onSubmit={(body) => updateMut.mutate({ id: editingUser.id, body })}
        />
      )}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-600 flex items-center justify-between">
          <div>
            <h3 className="text-white text-sm font-semibold">Users</h3>
            <p className="text-gray-500 text-xs mt-0.5">{users.length} account{users.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs text-brand-400 hover:text-brand-300 border border-brand-500/30 hover:border-brand-500/60 px-3 py-1.5 rounded-lg transition-colors"
          >
            + Add user
          </button>
        </div>
        {isError && (
          <div className="text-center py-6 text-sm text-red-400 bg-red-500/10 border-b border-red-500/20">
            Could not load users. Retrying…
          </div>
        )}
        {isLoading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}
        {!isLoading && !isError && users.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">No users found</div>
        )}
        <div className="divide-y divide-surface-600">
          {users.map(user => (
            <div key={user.id} className="flex flex-wrap items-center justify-between gap-y-2 gap-x-3 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-full bg-brand-500/15 flex items-center justify-center text-xs font-semibold text-brand-400 shrink-0">
                  {(user.username || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-gray-100 font-medium truncate">{user.username}</div>
                  <div className="text-xs text-gray-500 truncate">{user.email || 'No email'}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {user.last_login ? `Last login ${formatAuditTimestamp(user.last_login)}` : 'Never logged in'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge tone={roleTone(user.role)}>{user.role}</Badge>
                <Badge tone={user.is_active !== false ? 'good' : 'muted'}>
                  {user.is_active !== false ? 'Active' : 'Inactive'}
                </Badge>
                <button
                  onClick={() => setEditingUser(user)}
                  className="text-xs text-gray-400 hover:text-white border border-surface-500 hover:border-surface-400 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(user)}
                  className="text-xs text-red-400/60 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function RecordingTab() {
  const [dir, setDir] = useState('/recordings')
  const [maxGb, setMaxGb] = useState(500)
  const [autoDelete, setAutoDelete] = useState(false)
  const [saved, setSaved] = useState(false)

  const { data: recConfig } = useQuery({
    queryKey: ['recording-config'],
    queryFn: () => api.get('/settings/recording').then(r => r.data).catch(() => ({})),
  })

  // TanStack Query v5 removed onSuccess/onError from useQuery (only
  // useMutation still has them) — this used to be a useQuery onSuccess
  // callback that silently never fired, so the field always showed the
  // component's local default instead of the real saved value.
  useEffect(() => {
    if (!recConfig) return
    if (recConfig.output_dir) setDir(recConfig.output_dir)
    if (recConfig.max_storage_gb) setMaxGb(recConfig.max_storage_gb)
    if (recConfig.auto_delete != null) setAutoDelete(recConfig.auto_delete)
  }, [recConfig])

  const handleSave = async () => {
    try {
      await api.put('/settings/recording', { output_dir: dir, max_storage_gb: maxGb, auto_delete: autoDelete })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to save recording settings'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <h3 className="text-white text-sm font-semibold mb-4">Storage settings</h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Default output directory</label>
            <input
              className={`${inputClass} font-mono`}
              value={dir}
              onChange={e => setDir(e.target.value)}
              placeholder="/recordings"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">
              Max storage limit: <span className="text-white font-mono font-semibold">{maxGb} GB</span>
            </label>
            <input
              type="range"
              min={10}
              max={2000}
              step={10}
              value={maxGb}
              onChange={e => setMaxGb(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>10 GB</span><span>2 TB</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-t border-surface-600">
            <div>
              <div className="text-sm text-gray-200">Auto-delete oldest</div>
              <div className="text-xs text-gray-500 mt-0.5">Delete oldest recordings when storage limit is reached</div>
            </div>
            <button
              onClick={() => setAutoDelete(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoDelete ? 'bg-brand-500' : 'bg-surface-600'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoDelete ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <Button variant="primary" onClick={handleSave}>Save settings</Button>
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
        </div>
      </Card>
    </div>
  )
}

function AuditLogTab() {
  const { data: entries = [], isLoading, isError, error } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => getAuditLog(200),
    refetchInterval: 15000,
  })

  const forbidden = error?.response?.status === 403

  function exportCsv() {
    downloadCsv(
      `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
      ['When', 'Who', 'Action', 'Target', 'Detail'],
      entries.map(e => [e.created_at, e.username, ACTION_LABEL[e.action] || e.action, e.target || '', e.detail || '']),
    )
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-surface-600 flex items-center justify-between">
        <div>
          <h3 className="text-white text-sm font-semibold">Audit Log</h3>
          <p className="text-gray-500 text-xs mt-0.5">Who created or deleted what — users, routes, and alert rules</p>
        </div>
        {entries.length > 0 && (
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            <Download size={13} /> Export CSV
          </Button>
        )}
      </div>
      {isLoading ? (
        <div className="p-6 text-center text-sm text-gray-500">Loading…</div>
      ) : isError ? (
        <div className="p-6 text-center text-sm text-red-400">
          {forbidden ? 'Admin access required to view the audit log.' : 'Could not load the audit log.'}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-10 text-center text-gray-400 text-sm">No audit entries yet</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-600 bg-surface-750">
                {['When', 'Who', 'Action', 'Target', 'Detail'].map(c => (
                  <th key={c} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td className="px-4 py-2.5 text-xs text-gray-500 font-mono whitespace-nowrap">{formatAuditTimestamp(entry.created_at)}</td>
                  <td className="px-4 py-2.5 text-gray-200 font-medium whitespace-nowrap">{entry.username}</td>
                  <td className="px-4 py-2.5 text-gray-300 whitespace-nowrap">{ACTION_LABEL[entry.action] || entry.action}</td>
                  <td className="px-4 py-2.5 text-gray-300 truncate max-w-[220px]">{entry.target || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs truncate max-w-[260px]">{entry.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function AboutTab() {
  const { data: info } = useQuery({
    queryKey: ['about'],
    queryFn: () => api.get('/settings/about').then(r => r.data).catch(() => ({})),
  })

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-6 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-500/20 to-signal-500/20 ring-1 ring-brand-500/30 flex items-center justify-center">
            <Radio size={22} className="text-brand-400" />
          </div>
          <div>
            <div className="text-white text-lg font-bold">Arena</div>
            <div className="text-gray-500 text-xs">Broadcast stream management</div>
          </div>
        </div>
        <p className="text-gray-400 text-sm text-center max-w-md">
          End-to-end SDI ingestion, SRT transport, and stream routing for professional broadcast workflows.
        </p>
      </Card>
      <Card className="p-4">
        <h3 className="text-white text-sm font-semibold mb-1">Version information</h3>
        <p className="text-gray-500 text-xs mb-4">Build and dependency details</p>
        <FieldRow label="Arena version" value={info?.version || '0.1.0'} />
        <FieldRow label="mediamtx version" value={info?.mediamtx_version} muted={!info?.mediamtx_version} />
        <FieldRow label="GStreamer version" value={info?.gstreamer_version} muted={!info?.gstreamer_version} />
        <FieldRow label="FFmpeg version" value={info?.ffmpeg_version} muted={!info?.ffmpeg_version} />
        <FieldRow label="Build date" value={info?.build_date} muted={!info?.build_date} />
        <FieldRow label="Commit" value={info?.commit ? info.commit.slice(0, 8) : null} muted={!info?.commit} />
      </Card>
      <Card className="p-4">
        <h3 className="text-white text-sm font-semibold mb-3">Resources</h3>
        <div className="flex flex-col gap-2">
          {[
            ['Documentation', 'https://github.com/your-org/arena/docs'],
            ['SRT protocol spec', 'https://www.haivision.com/resources/white-paper/srt-open-source-transport-protocol/'],
            ['AJA NTV2 SDK', 'https://github.com/aja-video/libajantv2'],
            ['mediamtx', 'https://github.com/bluenviron/mediamtx'],
          ].map(([label, url]) => (
            <a
              key={label}
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-brand-400 hover:text-brand-300 flex items-center gap-1.5"
            >
              {label}
              <span className="text-xs text-brand-500/50">↗</span>
            </a>
          ))}
        </div>
      </Card>
    </div>
  )
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('server')

  return (
    <div className="relative p-6 min-h-screen bg-surface-900 max-w-3xl">
      <div
        className="absolute top-0 left-1/3 w-[400px] h-[240px] blur-[100px] opacity-[0.06] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #818cf8, transparent 70%)' }}
      />
      <div className="relative flex items-center gap-3 mb-6">
        <SettingsIcon size={24} className="text-brand-400" />
        <div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Settings</h1>
          <p className="text-gray-500 text-sm mt-0.5">System configuration and administration</p>
        </div>
      </div>
      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} className="relative mb-6" />
      <div className="relative">
        {activeTab === 'server' && <ServerTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'recording' && <RecordingTab />}
        {activeTab === 'audit' && <AuditLogTab />}
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  )
}
