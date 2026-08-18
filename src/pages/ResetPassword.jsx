import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

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

    /*
     * Supabase sends PASSWORD_RECOVERY when
     * the user opens a valid recovery link.
     */
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

    /*
     * Also check whether the recovery session
     * already exists.
     */
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

      /*
       * Sign out the recovery session so the user
       * has to log in with the new password.
       */
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
    <div className="min-h-screen bg-ink text-paper flex items-center justify-center px-4">

      <div className="w-full max-w-sm">

        <div className="text-center mb-8">

          <img
            src="/ielts.png"
            alt="IELTS with Mr Ikromov"
            className="w-16 h-16 mx-auto rounded-2xl mb-3"
          />

          <h1 className="font-display text-2xl">
            Choose a new password
          </h1>

          <p className="text-mist text-sm mt-1">
            Create a new password for your
            account.
          </p>

        </div>

        {checking ? (
          <div className="ticket rounded-lg p-6 text-sm text-mist text-center">
            Checking your reset link…
          </div>
        ) : !ready ? (
          <div className="ticket rounded-lg p-6">

            <p className="text-sm text-mist">
              This password-reset link is invalid
              or has expired.
            </p>

            <Link
              to="/forgot-password"
              className="inline-block mt-4 text-sm text-brass hover:underline"
            >
              Request a new reset link
            </Link>

          </div>
        ) : (
          <form
            onSubmit={submit}
            className="ticket rounded-lg p-6 flex flex-col gap-4"
          >

            <input
              type="password"
              minLength="6"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              placeholder="New password"
              autoComplete="new-password"
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2"
              required
            />

            <input
              type="password"
              minLength="6"
              value={confirm}
              onChange={(e) =>
                setConfirm(e.target.value)
              }
              placeholder="Confirm new password"
              autoComplete="new-password"
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2"
              required
            />

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
              disabled={saving}
              className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving
                ? 'Updating…'
                : 'Update password'}
            </button>

          </form>
        )}

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