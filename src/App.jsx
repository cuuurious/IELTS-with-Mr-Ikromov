import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoadingScreen from './components/LoadingScreen'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Register from './pages/Register'
import PendingApproval from './pages/PendingApproval'
import StudentDashboard from './pages/student/StudentDashboard'
import TeacherDashboard from './pages/teacher/TeacherDashboard'

function Gate() {
  const { session, profile, loading, profileLoading } = useAuth()

  // profileLoading covers every profile fetch, not just the first one
  // (tab refocus, a silent token refresh — Supabase re-validates the
  // session every time the tab regains focus, which fires this same
  // "fetching the profile" state again). It's only meant to prevent
  // "waiting for approval" flashing for an approved account while the
  // very first fetch is still in flight.
  //
  // The `!profile` check below is what keeps that fix from also
  // firing on every later background refresh: once a profile has
  // already loaded once, LoadingScreen must never show again for it,
  // because rendering LoadingScreen here unmounts the entire
  // dashboard underneath it. Without `!profile`, switching tabs and
  // coming back would blank the whole app to a loading screen and
  // rebuild it from scratch every time — closing any open modal
  // (including a student's in-progress Writing Mock Test) and
  // resetting scroll position, exactly like a real page refresh, even
  // though nothing about the session actually changed.
  if (loading || (session && profileLoading && !profile)) {
    return <LoadingScreen />
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!profile || profile.status !== 'approved') {
    return <PendingApproval />
  }

  return profile.role === 'teacher'
    ? <TeacherDashboard />
    : <StudentDashboard />
}

function PublicOnly({ children }) {
  const { session, loading } = useAuth()

  if (loading) return null

  if (session) {
    return <Navigate to="/app" replace />
  }

  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>

          {/* Normal authentication pages */}
          <Route
            path="/login"
            element={
              <PublicOnly>
                <Login />
              </PublicOnly>
            }
          />

          <Route
            path="/register"
            element={
              <PublicOnly>
                <Register />
              </PublicOnly>
            }
          />

          <Route
            path="/forgot-password"
            element={
              <PublicOnly>
                <ForgotPassword />
              </PublicOnly>
            }
          />

          {/* IMPORTANT:
              Recovery route must NOT use PublicOnly.
              Supabase creates a temporary recovery session here.
          */}
          <Route
            path="/reset-password"
            element={<ResetPassword />}
          />

          {/* Main application */}
          <Route
            path="/app"
            element={<Gate />}
          />

          {/* Unknown routes */}
          <Route
            path="*"
            element={<Navigate to="/app" replace />}
          />

        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}