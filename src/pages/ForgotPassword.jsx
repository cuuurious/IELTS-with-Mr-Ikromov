import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()

  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()

    setLoading(true)
    setError('')
    setMessage('')

    try {
      await sendPasswordReset(email)

      setMessage(
        'If this email belongs to an account, a password reset link has been sent. Please check your inbox and spam folder.'
      )
    } catch (err) {
      console.error('Password reset request failed:', err)

      setError(
        err?.message ||
          'Could not send the password reset email.'
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

          <h1 className="font-display text-2xl">
            Reset your password
          </h1>

          <p className="text-mist text-sm mt-1">
            Enter the recovery email connected to your account.
            We&apos;ll send you a secure password reset link.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="ticket rounded-lg p-6 flex flex-col gap-4"
        >
          <div>
            <label className="text-xs uppercase tracking-wide text-mist font-mono">
              Recovery email
            </label>

            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              autoComplete="email"
              className="focus-ring w-full mt-1 bg-panel-2 border border-line rounded-md px-3 py-2"
              required
            />
          </div>

          {message && (
            <div className="rounded-md border border-sage/40 bg-sage/10 px-3 py-2">
              <p className="text-sage text-sm">
                {message}
              </p>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-coral/40 bg-coral/10 px-3 py-2">
              <p className="text-coral text-sm">
                {error}
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
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