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

function ProtectedRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  if (!token) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
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
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
