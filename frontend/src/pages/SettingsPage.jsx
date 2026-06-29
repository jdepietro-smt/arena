import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getUsers, createUser, deleteUser } from '../api/client'
import api from '../api/client'

const TABS = ['Server', 'Users', 'Recording', 'About']

const ROLES = ['admin', 'operator', 'viewer']

const defaultUserForm = { username: '', password: '', role: 'operator' }

function TabButton({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm rounded-lg transition-colors ${
        active
          ? 'bg-indigo-500/15 text-indigo-400 font-medium'
          : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
      }`}
    >
      {label}
    </button>
  )
}

function FieldRow({ label, value, muted }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-[#222233] last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-medium font-mono ${muted ? 'text-gray-500' : 'text-gray-100'}`}>{value || '—'}</span>
    </div>
  )
}

function AddUserModal({ onClose, onSubmit, loading }) {
  const [form, setForm] = useState(defaultUserForm)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-6 w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-medium text-base">Add user</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>
        <form
          onSubmit={e => { e.preventDefault(); onSubmit(form) }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Username</label>
            <input
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-600"
              placeholder="operator1"
              value={form.username}
              onChange={e => set('username', e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Password</label>
            <input
              type="password"
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 placeholder-gray-600"
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
            <select
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={form.role}
              onChange={e => set('role', e.target.value)}
            >
              {ROLES.map(r => <option key={r}>{r}</option>)}
            </select>
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
              {loading ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// --- Tabs ---

function ServerTab() {
  const { data: config } = useQuery({
    queryKey: ['server-config'],
    queryFn: () => api.get('/settings/server').then(r => r.data).catch(() => ({})),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-4">
        <h3 className="text-white text-sm font-medium mb-1">Server configuration</h3>
        <p className="text-gray-500 text-xs mb-4">Read from environment / backend config</p>
        <FieldRow label="Server IP" value={config?.server_ip || window.location.hostname} />
        <FieldRow label="mediamtx API URL" value={config?.mediamtx_api_url} />
        <FieldRow label="SRT listen port" value={config?.srt_port} />
        <FieldRow label="HLS base URL" value={config?.hls_base_url} />
      </div>
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-4">
        <h3 className="text-white text-sm font-medium mb-1">TURN server</h3>
        <p className="text-gray-500 text-xs mb-4">WebRTC relay configuration</p>
        <FieldRow label="TURN host" value={config?.turn_host} muted={!config?.turn_host} />
        <FieldRow label="TURN port" value={config?.turn_port} muted={!config?.turn_port} />
        <FieldRow label="TURN username" value={config?.turn_username} muted={!config?.turn_username} />
        <FieldRow label="Status" value={config?.turn_enabled ? 'Enabled' : 'Disabled'} muted={!config?.turn_enabled} />
      </div>
    </div>
  )
}

function UsersTab() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
  })

  const createMut = useMutation({
    mutationFn: createUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setShowAdd(false) },
  })

  const deleteMut = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const handleDelete = (user) => {
    if (window.confirm(`Remove user "${user.username}"?`)) {
      deleteMut.mutate(user.id)
    }
  }

  const roleColor = (role) => {
    if (role === 'admin') return 'bg-red-500/15 text-red-400'
    if (role === 'operator') return 'bg-indigo-500/15 text-indigo-400'
    return 'bg-gray-500/15 text-gray-400'
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
      <div className="bg-[#111118] border border-[#222233] rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-[#222233] flex items-center justify-between">
          <div>
            <h3 className="text-white text-sm font-medium">Users</h3>
            <p className="text-gray-500 text-xs mt-0.5">{users.length} account{users.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 hover:border-indigo-500/60 px-3 py-1.5 rounded-lg transition-colors"
          >
            + Add user
          </button>
        </div>
        {isLoading && <div className="text-center py-8 text-gray-600 text-sm">Loading…</div>}
        {!isLoading && users.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-sm">No users found</div>
        )}
        <div className="divide-y divide-[#222233]">
          {users.map(user => (
            <div key={user.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-500/15 flex items-center justify-center text-xs font-medium text-indigo-400">
                  {(user.username || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div className="text-sm text-gray-100 font-medium">{user.username}</div>
                  <div className="text-xs text-gray-500">{user.email || 'No email'}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${roleColor(user.role)}`}>
                  {user.role}
                </span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  user.active !== false
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-gray-500/15 text-gray-500'
                }`}>
                  {user.active !== false ? 'Active' : 'Inactive'}
                </span>
                <button
                  onClick={() => handleDelete(user)}
                  className="text-xs text-red-400/60 hover:text-red-400 border border-red-500/20 hover:border-red-500/40 px-2.5 py-1 rounded-lg transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
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
    onSuccess: (d) => {
      if (d.output_dir) setDir(d.output_dir)
      if (d.max_storage_gb) setMaxGb(d.max_storage_gb)
      if (d.auto_delete != null) setAutoDelete(d.auto_delete)
    },
  })

  const handleSave = async () => {
    try {
      await api.put('/settings/recording', { output_dir: dir, max_storage_gb: maxGb, auto_delete: autoDelete })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch {
      // noop — API may not be wired yet
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-4">
        <h3 className="text-white text-sm font-medium mb-4">Storage settings</h3>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">Default output directory</label>
            <input
              className="bg-[#0a0a0f] border border-[#222233] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
              value={dir}
              onChange={e => setDir(e.target.value)}
              placeholder="/recordings"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400">
              Max storage limit: <span className="text-white font-medium">{maxGb} GB</span>
            </label>
            <input
              type="range"
              min={10}
              max={2000}
              step={10}
              value={maxGb}
              onChange={e => setMaxGb(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] text-gray-600">
              <span>10 GB</span><span>2 TB</span>
            </div>
          </div>
          <div className="flex items-center justify-between py-2 border-t border-[#222233]">
            <div>
              <div className="text-sm text-gray-200">Auto-delete oldest</div>
              <div className="text-xs text-gray-500 mt-0.5">Delete oldest recordings when storage limit is reached</div>
            </div>
            <button
              onClick={() => setAutoDelete(v => !v)}
              className={`relative w-10 h-5 rounded-full transition-colors ${autoDelete ? 'bg-indigo-500' : 'bg-[#222233]'}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${autoDelete ? 'translate-x-5' : ''}`}
              />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-medium transition-colors"
          >
            Save settings
          </button>
          {saved && <span className="text-xs text-emerald-400">Saved</span>}
        </div>
      </div>
    </div>
  )
}

function AboutTab() {
  const { data: info } = useQuery({
    queryKey: ['about'],
    queryFn: () => api.get('/settings/about').then(r => r.data).catch(() => ({})),
  })

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-6 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/15 flex items-center justify-center">
            <span className="text-indigo-400 text-2xl font-bold">S</span>
          </div>
          <div>
            <div className="text-white text-lg font-medium">Arena</div>
            <div className="text-gray-500 text-xs">Broadcast stream management</div>
          </div>
        </div>
        <p className="text-gray-400 text-sm text-center max-w-md">
          End-to-end SDI ingestion, SRT transport, and stream routing for professional broadcast workflows.
        </p>
      </div>
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-4">
        <h3 className="text-white text-sm font-medium mb-1">Version information</h3>
        <p className="text-gray-500 text-xs mb-4">Build and dependency details</p>
        <FieldRow label="Arena version" value={info?.version || '0.1.0'} />
        <FieldRow label="mediamtx version" value={info?.mediamtx_version} muted={!info?.mediamtx_version} />
        <FieldRow label="GStreamer version" value={info?.gstreamer_version} muted={!info?.gstreamer_version} />
        <FieldRow label="FFmpeg version" value={info?.ffmpeg_version} muted={!info?.ffmpeg_version} />
        <FieldRow label="Build date" value={info?.build_date} muted={!info?.build_date} />
        <FieldRow label="Commit" value={info?.commit ? info.commit.slice(0, 8) : null} muted={!info?.commit} />
      </div>
      <div className="bg-[#111118] border border-[#222233] rounded-xl p-4">
        <h3 className="text-white text-sm font-medium mb-3">Resources</h3>
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
              className="text-sm text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5"
            >
              {label}
              <span className="text-xs text-indigo-500/50">↗</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('Server')

  return (
    <div className="p-6 min-h-screen bg-[#0a0a0f] max-w-3xl">
      <div className="mb-6">
        <h1 className="text-white text-xl font-medium">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">System configuration and administration</p>
      </div>
      <div className="flex gap-1 mb-6 bg-[#111118] border border-[#222233] rounded-xl p-1 w-fit">
        {TABS.map(tab => (
          <TabButton
            key={tab}
            label={tab}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>
      {activeTab === 'Server' && <ServerTab />}
      {activeTab === 'Users' && <UsersTab />}
      {activeTab === 'Recording' && <RecordingTab />}
      {activeTab === 'About' && <AboutTab />}
    </div>
  )
}
