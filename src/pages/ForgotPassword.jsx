import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AuthShell, { AuthField, AuthNotice, authInputClass, authPrimaryButtonClass } from '../components/AuthShell'

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
    <AuthShell
      title="Forgot your password? It happens."
      subtitle="Enter the email you gave when you signed up and we'll send you a link to choose a new password."
      cardTitle="Reset your password"
      cardSubtitle="We'll email you a reset link."
      footer={
        <Link to="/login" className="focus-ring rounded font-semibold text-paper hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <AuthField label="Email" hint="Check your spam folder if the email doesn't arrive in a few minutes.">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </AuthField>

        {message && <AuthNotice tone="success">{message}</AuthNotice>}
        {error && <AuthNotice>{error}</AuthNotice>}

        <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
    </AuthShell>
  )
}
