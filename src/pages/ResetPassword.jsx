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
    <div className="min-h-screen bg-[#f4f7ff] text-[#17213f] relative overflow-hidden">

      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">

        <div className="absolute -top-44 -right-36 w-[520px] h-[520px] rounded-full bg-[#7567f8]/15 blur-3xl" />

        <div className="absolute -bottom-48 -left-40 w-[520px] h-[520px] rounded-full bg-[#49d6d0]/15 blur-3xl" />

        <div className="absolute top-[20%] left-[10%] w-24 h-24 rounded-[24px] bg-[#7567f8]/10 rotate-12" />

        <div className="absolute bottom-[18%] right-[10%] w-28 h-28 rounded-[26px] bg-[#ff817c]/10 -rotate-12" />

        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(rgba(90,100,160,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(90,100,160,.08) 1px, transparent 1px)',
            backgroundSize: '52px 52px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 px-5 sm:px-8 lg:px-12 pt-5">
        <div className="flex items-center gap-3">
          <img
            src="/ielts.png"
            alt="IELTS with Mr Ikromov"
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover shadow-lg shadow-[#17213f]/10"
          />

          <div>
            <div className="font-display text-lg sm:text-xl font-semibold">
              IELTS with Mr Ikromov
            </div>

            <div className="text-xs sm:text-sm text-[#71809d]">
              Candidate & examiner portal
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="relative z-10 min-h-[calc(100vh-92px)] flex items-center justify-center px-5 py-8">

        <div className="w-full max-w-[470px]">

          {/* Intro */}
          <div className="text-center mb-7">

            <div className="inline-flex items-center gap-2 rounded-full border border-[#7567f8]/20 bg-white/70 px-4 py-2 text-[11px] uppercase tracking-[0.18em] font-semibold text-[#6659e8] shadow-sm">
              <span className="w-2 h-2 rounded-full bg-[#7567f8]" />
              Secure recovery
            </div>

            <h1 className="font-display text-4xl sm:text-5xl text-[#17213f] mt-5">
              Choose a new password
            </h1>

            <p className="text-[#71809d] mt-3 leading-6 max-w-[410px] mx-auto">
              Create a new password and get back to your
              IELTS preparation.
            </p>

          </div>

          {checking ? (

            <div className="rounded-[28px] border border-[#dfe4ef] bg-[#fffdfa]/95 backdrop-blur-xl shadow-[0_30px_80px_rgba(35,48,87,0.14)] p-9 text-center">

              <div className="w-12 h-12 rounded-2xl bg-[#eef0ff] text-[#675cf1] flex items-center justify-center mx-auto mb-4 animate-pulse">
                •••
              </div>

              <p className="text-sm text-[#71809d]">
                Checking your reset link…
              </p>

            </div>

          ) : !ready ? (

            <div className="rounded-[28px] border border-[#dfe4ef] bg-[#fffdfa]/95 backdrop-blur-xl shadow-[0_30px_80px_rgba(35,48,87,0.14)] overflow-hidden">

              <div className="p-7 sm:p-9 text-center">

                <div className="w-14 h-14 rounded-2xl bg-[#fff1f0] text-[#e35c5e] flex items-center justify-center mx-auto text-xl">
                  !
                </div>

                <h2 className="font-display text-2xl text-[#17213f] mt-5">
                  Link unavailable
                </h2>

                <p className="text-sm leading-6 text-[#71809d] mt-2">
                  This password-reset link is invalid or
                  has expired.
                </p>

                <Link
                  to="/forgot-password"
                  className="inline-flex items-center justify-center h-12 px-6 mt-6 rounded-xl bg-[#675cf1] text-white text-sm font-semibold shadow-lg shadow-[#675cf1]/20 hover:-translate-y-0.5 transition"
                >
                  Request a new link
                </Link>

              </div>

              <div className="border-t border-[#e7e9ef] bg-[#f7f8fb] px-7 py-4 text-center">
                <Link
                  to="/login"
                  className="text-sm font-semibold text-[#5f58e8] hover:underline"
                >
                  ← Back to sign in
                </Link>
              </div>

            </div>

          ) : (

            <form
              onSubmit={submit}
              className="rounded-[28px] border border-[#dfe4ef] bg-[#fffdfa]/95 backdrop-blur-xl shadow-[0_30px_80px_rgba(35,48,87,0.14)] overflow-hidden"
            >

              <div className="p-7 sm:p-9">

                <div className="flex items-center gap-4 mb-7">

                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#675cf1] to-[#4bcfd0] text-white flex items-center justify-center text-xl shadow-lg shadow-[#675cf1]/20">
                    ✓
                  </div>

                  <div>
                    <h2 className="font-semibold text-[#253252]">
                      Create a new password
                    </h2>

                    <p className="text-sm text-[#8793aa]">
                      Use at least 6 characters.
                    </p>
                  </div>

                </div>

                <div className="space-y-5">

                  <div>
                    <label className="block text-sm font-semibold text-[#253252] mb-2">
                      New password
                    </label>

                    <input
                      type="password"
                      minLength="6"
                      value={password}
                      onChange={(e) =>
                        setPassword(e.target.value)
                      }
                      placeholder="Enter a new password"
                      autoComplete="new-password"
                      className="w-full h-14 rounded-2xl border border-[#d5dbe8] bg-[#f9fafc] px-4 text-[#17213f] placeholder:text-[#a8b3c5] outline-none transition focus:border-[#7567f8] focus:ring-4 focus:ring-[#7567f8]/10"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-[#253252] mb-2">
                      Confirm password
                    </label>

                    <input
                      type="password"
                      minLength="6"
                      value={confirm}
                      onChange={(e) =>
                        setConfirm(e.target.value)
                      }
                      placeholder="Enter it again"
                      autoComplete="new-password"
                      className="w-full h-14 rounded-2xl border border-[#d5dbe8] bg-[#f9fafc] px-4 text-[#17213f] placeholder:text-[#a8b3c5] outline-none transition focus:border-[#7567f8] focus:ring-4 focus:ring-[#7567f8]/10"
                      required
                    />
                  </div>

                  {message && (
                    <div className="rounded-2xl border border-[#4bcfba]/30 bg-[#ecfbf8] px-4 py-3">
                      <p className="text-sm text-[#258c7b]">
                        {message}
                      </p>
                    </div>
                  )}

                  {error && (
                    <div className="rounded-2xl border border-[#ff817c]/30 bg-[#fff1f0] px-4 py-3">
                      <p className="text-sm text-[#d94e50]">
                        {error}
                      </p>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full h-14 rounded-2xl bg-gradient-to-r from-[#675cf1] to-[#5549df] text-white font-semibold shadow-[0_12px_30px_rgba(103,92,241,0.25)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(103,92,241,0.32)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving
                      ? 'Updating…'
                      : 'Update password'}
                  </button>

                </div>

              </div>

              <div className="border-t border-[#e7e9ef] bg-[#f7f8fb] px-7 sm:px-9 py-5 text-center">
                <Link
                  to="/login"
                  className="text-sm font-semibold text-[#5f58e8] hover:underline"
                >
                  ← Back to sign in
                </Link>
              </div>

            </form>

          )}

        </div>
      </main>
    </div>
  )
}