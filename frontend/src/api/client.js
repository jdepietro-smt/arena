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
export const getRecordings  = () => api.get('/recordings').then(r => r.data)
export const deleteRecording = (id) => api.delete(`/recordings/${id}`)
export const downloadUrl    = (id) => `/api/recordings/${id}/download`

// --- Stats ---
export const getStats        = (p) => api.get(`/stats/${p}`).then(r => r.data)
export const getStatsHistory = (p, s) => api.get(`/stats/${p}/history`, { params: { seconds: s } }).then(r => r.data)
export const getStatsSummary = () => api.get('/stats/summary').then(r => r.data)

// --- Auth ---
export const login = (username, password) => {
  const form = new URLSearchParams()
  form.append('username', username)
  form.append('password', password)
  return api.post('/auth/token', form, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).then(r => r.data)
}
export const getMe = () => api.get('/auth/me').then(r => r.data)

// --- Users ---
export const getUsers  = () => api.get('/users').then(r => r.data)
export const createUser = (d) => api.post('/users', d).then(r => r.data)
export const updateUser = (id, d) => api.put(`/users/${id}`, d).then(r => r.data)
export const deleteUser = (id) => api.delete(`/users/${id}`)
