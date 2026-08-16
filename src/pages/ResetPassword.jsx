import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'

export default function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true)
      }
    })

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')

    if (password.length < 6) {
      return setError('Password must be at least 6 characters.')
    }

    if (password !== confirm) {
      return setError("Passwords don't match.")
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password,
    })

    if (updateError) {
      return setError(updateError.message)
    }

    setMessage('Password updated. You can sign in with your new password.')

    setTimeout(() => navigate('/login'), 1200)
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
        </div>

        {!ready ? (
          <div className="ticket rounded-lg p-6 text-sm text-mist">
            Open this page from the password-reset email link. If the link has expired, request a new one.
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
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password"
              className="focus-ring bg-panel-2 border border-line rounded-md px-3 py-2"
              required
            />

            <input
              type="password"
              minLength="6"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
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
              className="focus-ring bg-brass text-onbrass font-medium rounded-md py-2.5"
            >
              Update password
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