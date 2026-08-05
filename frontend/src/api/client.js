import axios from 'axios'
import { useAuthStore } from '../store/auth'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use(cfg => {
  const token = useAuthStore.getState().token
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) useAuthStore.getState().logout()
    return Promise.reject(err)
  }
)

export default api

// --- Streams ---
export const getStreams     = () => api.get('/streams').then(r => r.data)
export const getStream      = (p) => api.get(`/streams/${p}`).then(r => r.data)
export const getPreviewUrls = (p) => api.get(`/streams/${p}/preview-url`).then(r => r.data)
export const startRecording = (p) => api.post(`/streams/${p}/start-recording`).then(r => r.data)
export const stopRecording  = (p) => api.post(`/streams/${p}/stop-recording`).then(r => r.data)
export const getPresets     = () => api.get('/streams/presets').then(r => r.data)
export const savePreset     = (d) => api.post('/streams/preset', d).then(r => r.data)
export const deletePreset   = (id) => api.delete(`/streams/presets/${id}`)

// --- Routes ---
export const getRoutes    = () => api.get('/routes').then(r => r.data)
export const createRoute  = (d) => api.post('/routes', d).then(r => r.data)
export const activateRoute = (id) => api.put(`/routes/${id}/activate`).then(r => r.data)
export const deactivateRoute = (id) => api.put(`/routes/${id}/deactivate`).then(r => r.data)
export const deleteRoute  = (id) => api.delete(`/routes/${id}`)

// --- Recordings ---
// download/stream endpoints require the Authorization header, which a plain
// <a href>/<video src> can't send (browsers only attach it via fetch/axios).
// Fetch as a blob through the authenticated client instead, then hand the
// caller an object URL — works for both playback and triggering a save.
export const getRecordings  = () => api.get('/recordings').then(r => r.data)
export const deleteRecording = (id) => api.delete(`/recordings/${id}`)
export const getStorageForecast = () => api.get('/recordings/storage-forecast').then(r => r.data)

// Direct URL (token in query, since <video src> can't send an Authorization
// header) — lets the browser range-request the file instead of blob-fetching
// the whole thing up front, so playback starts immediately and seeking works.
export const getRecordingStreamUrl = (id) =>
  `/api/recordings/${id}/stream?token=${encodeURIComponent(useAuthStore.getState().token)}`
export const getRecordingThumbnailUrl = (id) =>
  `/api/recordings/${id}/thumbnail?token=${encodeURIComponent(useAuthStore.getState().token)}`
export const fetchRecordingBlobUrl = (id, { inline = false } = {}) =>
  api.get(`/recordings/${id}/${inline ? 'stream' : 'download'}`, { responseType: 'blob' })
    .then(r => URL.createObjectURL(r.data))

// --- Multiview ---
export const getMultiviewJobs  = () => api.get('/multiview/jobs').then(r => r.data)
export const stopMultiviewJob  = (jobId) => api.delete(`/multiview/jobs/${jobId}`)
export const getMultiviewJobLog = (jobId) => api.get(`/multiview/jobs/${jobId}/log`).then(r => r.data)

// --- External sources (SRT or YouTube-via-yt-dlp, auto-detected by URL) ---
export const getExternalSources  = () => api.get('/sources').then(r => r.data)
export const addExternalSource   = (name, url) => api.post('/sources', { name, url }).then(r => r.data)
export const removeExternalSource = (name) => api.delete(`/sources/${name}`)

export const getYoutubeCookiesStatus = () => api.get('/sources/youtube-cookies/status').then(r => r.data)
export const uploadYoutubeCookies = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/sources/youtube-cookies', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data)
}
export const removeYoutubeCookies = () => api.delete('/sources/youtube-cookies')

// --- mediamtx path diagnostics (admin) ---
export const getStalePaths = () => api.get('/sources/debug/stale-paths').then(r => r.data)
export const forceRemovePath = (name) => api.post(`/sources/debug/force-remove-path/${encodeURIComponent(name)}`).then(r => r.data)

// --- Stats ---
export const getStats        = (p) => api.get(`/stats/${p}`).then(r => r.data)
export const getStatsHistory = (p, s) => api.get(`/stats/${p}/history`, { params: { seconds: s } }).then(r => r.data)
export const getStatsSummary = () => api.get('/stats/summary').then(r => r.data)
export const getStreamUptimeHistory = (p, days = 30) => api.get(`/stats/${p}/uptime`, { params: { days } }).then(r => r.data)

// --- Events ---
export const getEvents = (limit) => api.get('/events', { params: { limit } }).then(r => r.data)

// --- Alerts ---
export const getAlertStatus  = () => api.get('/alerts/status').then(r => r.data)
export const getAlertRules   = () => api.get('/alerts').then(r => r.data)
export const createAlertRule = (d) => api.post('/alerts', d).then(r => r.data)
export const toggleAlertRule = (id) => api.patch(`/alerts/${id}/toggle`).then(r => r.data)
export const deleteAlertRule = (id) => api.delete(`/alerts/${id}`)

// --- Redundancy gateways (SMPTE 2022-7 sdi_receive monitoring) ---
export const getRedundancyStatus    = () => api.get('/redundancy/status').then(r => r.data)
export const getRedundancyGateways  = () => api.get('/redundancy').then(r => r.data)
export const createRedundancyGateway = (d) => api.post('/redundancy', d).then(r => r.data)
export const toggleRedundancyGateway = (id) => api.patch(`/redundancy/${id}/toggle`).then(r => r.data)
export const deleteRedundancyGateway = (id) => api.delete(`/redundancy/${id}`)

// --- Auth ---
export const login = (username, password) => {
  const form = new URLSearchParams()
  form.append('username', username)
  form.append('password', password)
  return api.post('/auth/token', form, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).then(r => r.data)
}
export const getMe = () => api.get('/auth/me').then(r => r.data)

// --- QC monitoring (frozen-frame / black-video / silent-audio) ---
export const getQcStatus = () => api.get('/qc/status').then(r => r.data)
export const enableQc = (path) => api.post(`/qc/${encodeURIComponent(path)}/enable`).then(r => r.data)
export const disableQc = (path) => api.post(`/qc/${encodeURIComponent(path)}/disable`).then(r => r.data)

// --- Favorites ---
export const getFavorites = () => api.get('/favorites').then(r => r.data)
export const addFavorite = (streamPath) => api.post('/favorites', { stream_path: streamPath }).then(r => r.data)
export const removeFavorite = (streamPath) => api.delete(`/favorites/${encodeURIComponent(streamPath)}`)

// --- Database backups ---
export const getBackupStatus = () => api.get('/settings/backup/status').then(r => r.data)
export const triggerBackup = () => api.post('/settings/backup').then(r => r.data)

// --- Login attempts ---
export const getLoginAttempts = () => api.get('/settings/login-attempts').then(r => r.data)
export const clearLoginLockout = (ip) => api.post(`/settings/login-attempts/${encodeURIComponent(ip)}/clear`).then(r => r.data)

// --- Audit log ---
export const getAuditLog = (limit = 100) => api.get('/audit', { params: { limit } }).then(r => r.data)

// --- Ops assistant ---
export const queryAssistant = (question) => api.post('/assistant/query', { question }).then(r => r.data)

// --- Users ---
export const getUsers  = () => api.get('/users').then(r => r.data)
export const createUser = (d) => api.post('/users', d).then(r => r.data)
export const updateUser = (id, d) => api.put(`/users/${id}`, d).then(r => r.data)
export const deleteUser = (id) => api.delete(`/users/${id}`)
