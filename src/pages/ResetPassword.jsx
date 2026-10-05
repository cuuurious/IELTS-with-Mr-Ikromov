import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import AuthShell, { AuthField, AuthNotice, authInputClass, authPrimaryButtonClass } from '../components/AuthShell'

export default function ResetPassword() {
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(true)

  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true

    const {
      data: subscriptionData,
    } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return

        if (
          event === 'PASSWORD_RECOVERY' ||
          (event === 'SIGNED_IN' && session)
        ) {
          setReady(true)
          setChecking(false)
        }
      }
    )

    supabase.auth.getSession().then(
      ({ data, error }) => {
        if (!mounted) return

        if (error) {
          console.error(
            'Could not check recovery session:',
            error
          )

          setError(error.message)
          setChecking(false)
          return
        }

        if (data?.session) {
          setReady(true)
        }

        setChecking(false)
      }
    )

    return () => {
      mounted = false
      subscriptionData.subscription.unsubscribe()
    }
  }, [])

  const submit = async (e) => {
    e.preventDefault()

    setError('')
    setMessage('')

    if (password.length < 6) {
      setError(
        'Password must be at least 6 characters.'
      )
      return
    }

    if (password !== confirm) {
      setError(
        "Passwords don't match."
      )
      return
    }

    setSaving(true)

    try {
      const {
        data: sessionData,
      } = await supabase.auth.getSession()

      if (!sessionData?.session) {
        throw new Error(
          'Your reset link is no longer valid. Please request a new password reset link.'
        )
      }

      const {
        error: updateError,
      } =
        await supabase.auth.updateUser({
          password,
        })

      if (updateError) {
        throw updateError
      }

      setMessage(
        'Password updated successfully. Redirecting to sign in…'
      )

      await supabase.auth.signOut()

      setTimeout(() => {
        navigate('/login', {
          replace: true,
        })
      }, 1500)
    } catch (err) {
      console.error(
        'Password update failed:',
        err
      )

      setError(
        err?.message ||
          'Could not update your password.'
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <AuthShell
      title="Choose a new password."
      subtitle="Use at least 6 characters. You'll sign in with it next time."
      cardTitle={checking ? 'Checking your link' : !ready ? 'Link unavailable' : 'New password'}
      cardSubtitle={
        checking
          ? 'One moment…'
          : !ready
            ? 'This reset link is invalid or has expired.'
            : 'Type it twice so we know it is right.'
      }
      footer={
        <Link to="/login" className="focus-ring rounded font-semibold text-paper hover:underline">
          Back to sign in
        </Link>
      }
    >
      {checking ? (
        <div className="flex items-center gap-3 py-2 text-sm text-mist">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-paper" aria-hidden="true" />
          Checking your reset link…
        </div>
      ) : !ready ? (
        <div className="flex flex-col gap-4">
          {error && <AuthNotice>{error}</AuthNotice>}
          <Link to="/forgot-password" className={authPrimaryButtonClass}>
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <AuthField label="New password">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={authInputClass}
              placeholder="At least 6 characters"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </AuthField>

          <AuthField label="Confirm password">
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={authInputClass}
              placeholder="Type it again"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </AuthField>

          {message && <AuthNotice tone="success">{message}</AuthNotice>}
          {error && <AuthNotice>{error}</AuthNotice>}

          <button type="submit" disabled={saving} className={authPrimaryButtonClass}>
            {saving ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
