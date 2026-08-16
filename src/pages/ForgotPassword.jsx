import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      await sendPasswordReset(username)
      setMessage(
        'If that account has a recovery email, a password reset link has been sent to it.'
      )
    } catch (err) {
      setError(err.message)
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

          <h1 className="font-display text-2xl">
            Reset your password
          </h1>

          <p className="text-mist text-sm mt-1">
            Enter your username and we’ll send the reset link to the recovery email on your account.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="ticket rounded-lg p-6 flex flex-col gap-4"
        >
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
            className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2"
            required
          />

          {message && (
            <p className="text-sage text-sm">
              {message}
            </p>
          )}

          {error && (
            <p className="text-coral text-sm">
              {error}
            </p>
          )}

          <button
            disabled={loading}
            className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2.5 disabled:opacity-50"
          >
            {loading ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="text-center text-sm text-mist mt-5">
          <Link
            to="/login"
            className="text-brass hover:underline"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}