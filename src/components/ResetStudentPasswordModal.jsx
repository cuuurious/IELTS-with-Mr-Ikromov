import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../lib/supabaseClient'

/*
 * Most students register with a username only — there's no real
 * email address behind their account for "Forgot password" to send
 * anything to. This is the direct alternative: a teacher sets a new
 * password for the student right here, no email involved, then
 * shares it with the student however is easiest (in person, chat,
 * WhatsApp, etc).
 */

// A short, easy-to-read-aloud-or-type word list. Paired with three
// random digits this is comfortably over Supabase's 6-character
// minimum and much easier for a teacher to relay than a random
// string of symbols.
const WORDS = [
  'sunny', 'river', 'tiger', 'cloud', 'maple',
  'coral', 'amber', 'ocean', 'pearl', 'comet',
  'lemon', 'ivory', 'plaza', 'echo', 'delta',
  'brave', 'happy', 'quiet', 'swift', 'bloom',
]

function generatePassword() {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)]
  const digits = Math.floor(100 + Math.random() * 900)
  return `${word}${digits}`
}

export default function ResetStudentPasswordModal({
  student,
  onClose,
}) {
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  // Start with a ready-made suggestion every time the modal opens for
  // a (new) student, so the common case is just "Reset password" →
  // done, without the teacher having to think one up.
  useEffect(() => {
    if (student) {
      setPassword(generatePassword())
      setError('')
      setResult(null)
      setCopied(false)
    }
  }, [student])

  if (!student) return null

  const copyPassword = async (value) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Copy failed:', err)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setSaving(true)

    try {
      const { data, error: fnError } =
        await supabase.functions.invoke(
          'reset-student-password',
          {
            body: {
              studentId: student.id,
              newPassword: password,
            },
          }
        )

      if (fnError) {
        let message = fnError.message
        try {
          const body = await fnError.context?.json?.()
          if (body?.error) message = body.error
        } catch {
          // Ignore — fall back to fnError.message.
        }
        throw new Error(message)
      }

      if (data?.error) throw new Error(data.error)

      setResult(password)
    } catch (err) {
      setError(
        err.message ||
          "Couldn't reset this student's password."
      )
    } finally {
      setSaving(false)
    }
  }

  const modal = (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reset student password"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-4 rounded-3xl border border-line bg-panel p-6 shadow-2xl"
      >
        {!result ? (
          <form
            onSubmit={submit}
            className="flex flex-col gap-3"
          >
            <div>
              <div className="font-display text-lg text-paper">
                Reset password
              </div>
              <p className="mt-1 text-sm text-paper-dim">
                Set a new password for{' '}
                <strong className="text-paper">
                  {student.full_name}
                </strong>
                , then share it with them yourself — no
                email is sent.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                placeholder="New password (min. 6 characters)"
                className="focus-ring flex-1 rounded-md border border-line bg-panel-2 px-3 py-2 font-mono text-sm text-paper outline-none transition focus:border-brass/60"
                minLength={6}
                required
              />

              <button
                type="button"
                onClick={() =>
                  setPassword(generatePassword())
                }
                className="focus-ring shrink-0 rounded-md border border-line px-3 py-2 text-sm text-mist transition hover:border-brass hover:text-brass"
              >
                🎲 New
              </button>
            </div>

            {error && (
              <p className="text-sm text-coral">
                {error}
              </p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="focus-ring rounded-md border border-line px-4 py-2 text-sm text-mist transition-colors hover:border-brass hover:text-brass"
              >
                Cancel
              </button>

              <button
                type="submit"
                disabled={saving}
                className="focus-ring rounded-md bg-brass px-4 py-2 text-sm font-medium text-onbrass transition-colors hover:bg-brass-dim disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving
                  ? 'Saving…'
                  : 'Reset password'}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <div className="font-display text-lg text-paper">
                Password reset ✅
              </div>
              <p className="mt-1 text-sm text-paper-dim">
                Share this new password with{' '}
                <strong className="text-paper">
                  {student.full_name}
                </strong>{' '}
                — they can log in with it right away.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2">
              <span className="flex-1 select-all font-mono text-base text-paper">
                {result}
              </span>

              <button
                type="button"
                onClick={() => copyPassword(result)}
                className="focus-ring shrink-0 rounded-md border border-line px-3 py-1.5 text-xs font-medium text-mist transition hover:border-brass hover:text-brass"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="focus-ring mt-1 rounded-md bg-brass px-4 py-2 text-sm font-medium text-onbrass transition-colors hover:bg-brass-dim"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}