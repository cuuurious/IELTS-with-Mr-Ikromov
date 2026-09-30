import { Component, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoadingScreen from './components/LoadingScreen'
import Login from './pages/Login'
import PendingApproval from './pages/PendingApproval'
import { lazyWithReload } from './lib/lazyWithReload'

// SPEED (2026-09-30): each dashboard is now its own download instead of
// one ~1 MB file with everything in it. A student never downloads the
// teacher's Mock Center (the single biggest piece of code), a teacher
// never downloads the student screens, and nobody downloads the
// examiner dashboards unless they are an examiner.
const StudentDashboard = lazyWithReload(() => import('./pages/student/StudentDashboard'))
const TeacherDashboard = lazyWithReload(() => import('./pages/teacher/TeacherDashboard'))
const SpeakingExaminerDashboard = lazyWithReload(() => import('./pages/examiner/SpeakingExaminerDashboard'))
const WritingExaminerDashboard = lazyWithReload(() => import('./pages/examiner/WritingExaminerDashboard'))
const ForgotPassword = lazyWithReload(() => import('./pages/ForgotPassword'))
const ResetPassword = lazyWithReload(() => import('./pages/ResetPassword'))
const Register = lazyWithReload(() => import('./pages/Register'))

function Gate() {
  const {
    session,
    profile,
    loading,
    profileLoading,
    authError,
    refreshProfile,
  } = useAuth()

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

  // AuthContext now always gives up after 15 seconds instead of
  // hanging forever on a stuck network request (see AuthContext.jsx),
  // but giving up still has to land somewhere other than silently
  // rendering a broken dashboard. If there's a session but loading it
  // just failed and there's still no profile, show a real "something
  // went wrong" screen with a way to try again — this is the fix for
  // the freeze that used to survive a refresh, a private window, and
  // even a different browser: same request, same failure, every time,
  // with no way back in before this existed.
  if (session && authError && !profile) {
    return (
      <LoadingScreen
        label={authError}
        onRetry={refreshProfile}
      />
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (!profile || profile.status !== 'approved') {
    return <PendingApproval />
  }

  // Four roles now exist (see migration_29): teacher, speaking_examiner,
  // writing_examiner, and everything else (student). Examiners are
  // deliberately NOT teachers, so they need their own branch here —
  // before this, both examiner roles fell through the ": " default
  // straight into StudentDashboard, which is exactly the bug Jasur
  // hit logging in as a freshly-created examiner account.
  const Dashboard =
    profile.role === 'teacher'
      ? TeacherDashboard
      : profile.role === 'speaking_examiner'
        ? SpeakingExaminerDashboard
        : profile.role === 'writing_examiner'
          ? WritingExaminerDashboard
          : StudentDashboard

  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        <Dashboard />
      </Suspense>
    </ChunkErrorBoundary>
  )
}

// If a dashboard's download fails even after lazyWithReload's one
// automatic reload (e.g. the internet dropped), show a clear "try
// again" screen instead of a blank page.
class ChunkErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('Could not load this part of the app:', error)
  }

  render() {
    if (this.state.failed) {
      return (
        <LoadingScreen
          label="Couldn't load this page — please check your internet connection."
          onRetry={() => window.location.reload()}
          retryLabel="Reload"
        />
      )
    }
    return this.props.children
  }
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
        <Suspense fallback={<LoadingScreen />}>
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
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}