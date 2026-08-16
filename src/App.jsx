import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Register from './pages/Register'
import PendingApproval from './pages/PendingApproval'
import StudentDashboard from './pages/student/StudentDashboard'
import TeacherDashboard from './pages/teacher/TeacherDashboard'

function Gate() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-ink flex items-center justify-center text-mist font-mono">
        Loading…
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />
  if (!profile || profile.status !== 'approved') return <PendingApproval />
  return profile.role === 'teacher' ? <TeacherDashboard /> : <StudentDashboard />
}

function PublicOnly({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (session) return <Navigate to="/app" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
          <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
          <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/app" element={<Gate />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
