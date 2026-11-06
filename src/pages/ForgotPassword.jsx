import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabaseClient'
import AuthShell, { AuthField, AuthNotice, authInputClass, authPrimaryButtonClass } from '../components/AuthShell'

export default function ForgotPassword() {
  const { sendPasswordReset } = useAuth()

  const [login, setLogin] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // "ma•••@gmail.com": shows where the link went without printing the address.
  const mask = (e) => {
    const [name, host] = String(e).split('@')
    return `${name.slice(0, 2)}•••@${host}`
  }

  const submit = async (e) => {
    e.preventDefault()

    setLoading(true)
    setError('')
    setMessage('')

    try {
      // Find the account the student signs in with (2026-11-06,
      // migration_112): by username or by email, never an empty
      // half-made account.
      const clean = login.trim().toLowerCase()
      let target = clean
      const { data, error: lookupError } = await supabase.rpc('password_reset_target', { p_login: clean })
      if (!lookupError) target = data
      else if (!clean.includes('@')) target = null

      if (!target) {
        setError('We could not find a student account with that username or email. Check the spelling — or ask Mr Ikromov in Telegram to reset your password.')
        return
      }
      if (target === 'no-email') {
        setError('Your account signs in with a username only, so there is no email to send a link to. Ask Mr Ikromov in Telegram — he will set a new password for you.')
        return
      }

      await sendPasswordReset(target)

      setMessage(
        `We sent a reset link to ${mask(target)}. Open the NEWEST email only — every new request cancels the older links. Check your spam folder too.`
      )
    } catch (err) {
      console.error('Password reset request failed:', err)

      const msg = String(err?.message || '')
      setError(
        /only request this after|rate limit/i.test(msg)
          ? 'A link was sent a moment ago. Wait one minute, check your inbox (and spam), then try again if nothing came.'
          : msg || 'Could not send the password reset email.'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title="Forgot your password? It happens."
      subtitle="Type your username (or your email) and we'll email you a link to choose a new password."
      cardTitle="Reset your password"
      cardSubtitle="We'll email you a reset link."
      footer={
        <Link to="/login" className="focus-ring rounded font-semibold text-paper hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <AuthField label="Username or email" hint="The username you sign in with is best. Check your spam folder if the email doesn't arrive in a few minutes.">
          <input
            type="text"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            className={authInputClass}
            placeholder="your username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </AuthField>

        {message && <AuthNotice tone="success">{message}</AuthNotice>}
        {error && <AuthNotice>{error}</AuthNotice>}

        <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
          {loading ? 'Sending…' : 'Send reset link'}
        </button>

        <p className="text-[13px] font-semibold leading-relaxed text-mist">
          No email on your account? Ask Mr Ikromov in Telegram and he will reset it for you.
        </p>
      </form>
    </AuthShell>
  )
}
