import { Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import StreamsPage from './pages/StreamsPage'
import RouterPage from './pages/RouterPage'
import RecordingsPage from './pages/RecordingsPage'
import StatsPage from './pages/StatsPage'
import SettingsPage from './pages/SettingsPage'
import PlayerPage from './pages/PlayerPage'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', background: '#0a0a0f', color: '#f87171', minHeight: '100vh' }}>
          <h2 style={{ fontSize: 18, marginBottom: 16 }}>Application Error</h2>
          <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#111118', padding: 16, borderRadius: 8, border: '1px solid #222233' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

function ProtectedRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="dashboard"   element={<DashboardPage />} />
          <Route path="streams"     element={<StreamsPage />} />
          <Route path="router"      element={<RouterPage />} />
          <Route path="recordings"  element={<RecordingsPage />} />
          <Route path="stats"       element={<StatsPage />} />
          <Route path="settings"    element={<SettingsPage />} />
        </Route>
        <Route path="/watch/:streamName" element={<PlayerPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
