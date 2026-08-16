import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn({ username, password })
      navigate('/app')
    } catch (err) {
      setError(
        err.message === 'Invalid login credentials'
          ? 'Wrong username or password.'
          : err.message
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink text-paper flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img
            src="/ielts.png"
            alt="IELTS with Mr Ikromov"
            className="w-16 h-16 mx-auto rounded-2xl mb-3"
          />

          <h1 className="font-display text-2xl">IELTS with Mr Ikromov</h1>

          <p className="text-mist text-sm mt-1">
            Sign in to your candidate or examiner desk.
          </p>
        </div>

        <form onSubmit={submit} className="ticket rounded-lg p-6 flex flex-col gap-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Username
            </label>

            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="focus-ring w-full mt-1 bg-panel-2 border border-line rounded-md px-3 py-2 text-paper"
              placeholder="e.g. aziz_08"
              required
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Password
            </label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="focus-ring w-full mt-1 bg-panel-2 border border-line rounded-md px-3 py-2 text-paper"
              required
            />
          </div>

          {error && <p className="text-coral text-sm">{error}</p>}

          <button
            disabled={loading}
            className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2.5 hover:bg-brass-dim transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="text-center mt-4">
          <Link
            to="/forgot-password"
            className="text-sm text-brass hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <p className="text-center text-sm text-mist mt-5">
          New here?{' '}
          <Link
            to="/register"
            className="text-brass hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}