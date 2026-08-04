import { Component, Suspense, lazy } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import ToastStack from './components/ui/Toast'

// Route-level code splitting — each page becomes its own chunk, downloaded
// on first navigation instead of all at once in the initial bundle.
const LoginPage = lazy(() => import('./pages/LoginPage'))
const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const StreamsPage = lazy(() => import('./pages/StreamsPage'))
const MultiviewerPage = lazy(() => import('./pages/MultiviewerPage'))
const RouterPage = lazy(() => import('./pages/RouterPage'))
const RecordingsPage = lazy(() => import('./pages/RecordingsPage'))
const StatsPage = lazy(() => import('./pages/StatsPage'))
const AlertsPage = lazy(() => import('./pages/AlertsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const PlayerPage = lazy(() => import('./pages/PlayerPage'))
const MultiviewWatchPage = lazy(() => import('./pages/MultiviewWatchPage'))
const CompanionPage = lazy(() => import('./pages/CompanionPage'))

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-900">
      <div className="h-8 w-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
    </div>
  )
}

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
      <Suspense fallback={<RouteFallback />}>
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
          <Route path="overview"    element={<OverviewPage />} />
          <Route path="dashboard"   element={<DashboardPage />} />
          <Route path="streams"     element={<StreamsPage />} />
          <Route path="multiviewer" element={<MultiviewerPage />} />
          <Route path="router"      element={<RouterPage />} />
          <Route path="recordings"  element={<RecordingsPage />} />
          <Route path="stats"       element={<StatsPage />} />
          <Route path="alerts"      element={<AlertsPage />} />
          <Route path="settings"    element={<SettingsPage />} />
        </Route>
        <Route path="/watch/:streamName" element={<PlayerPage />} />
        <Route path="/multiview" element={<MultiviewWatchPage />} />
        <Route
          path="/companion"
          element={
            <ProtectedRoute>
              <CompanionPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      </Suspense>
      <ToastStack />
    </BrowserRouter>
    </ErrorBoundary>
  )
}
