import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import FullMockRunner from './FullMockRunner'

/*
 * ================================================================
 * MOCK CHECK-IN
 * ================================================================
 * Shipped 2026-09-26 (migration_45). Jasur, verbatim: "this confirming
 * window has to be the same as well, maybe we could add a window to
 * login with their full name and a special password or code or smth
 * to login and start close to real ielts style that password or code
 * will be made up by a teacher and assigned to a particular mock
 * session, they will login and see that window where they will see
 * instrutcions and hear them as well and confirm there."
 *
 * Confirmed scope (AskUserQuestion, same day): one code per student
 * per attempt (never shared across a group/session), and this
 * REPLACES free self-practice access entirely. Since migration_37
 * already made "Full Mock" the only way a student sits Listening,
 * Reading or Writing at all, gating this one entry point
 * (MockTestCenter.jsx's "Take a Test" tab) covers all three modules —
 * MockTestCenter now renders THIS component instead of <FullMockRunner>
 * directly. Nobody reaches a mock without a teacher-issued code first,
 * mimicking a real IELTS candidate check-in.
 *
 * The real access control is Postgres RLS on mock_access_codes
 * (student_id = auth.uid()) — a student can never even see, let alone
 * consume, another student's code row. That makes the full-name field
 * below cosmetic/ceremonial (an audit trail of what they typed, stored
 * in entered_full_name), not an auth check — same as the real exam's
 * own check-in, which also just asks for a name against an ID the
 * invigilator already issued.
 *
 * Styled to match the official IELTS familiarisation site
 * (cdielts.gelielts.com), researched 2026-09-26: white card, black
 * headline, gray secondary text, a black pill primary button — a
 * deliberate break from the app's own dark brass "ticket" theme used
 * everywhere else, because the whole point (Jasur, earlier in this
 * project) is "they have to feel that it is like a real exam not just
 * a website they use every day." FullMockRunner.jsx's own instructions
 * + confirm gate was restyled the same way, same day, for the same
 * reason — the two screens are meant to feel like one continuous flow.
 * ================================================================
 */

function normalizeCode(raw) {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export default function MockCheckIn({ selfId }) {
  const [fullName, setFullName] = useState('')
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const [checkedInSet, setCheckedInSet] = useState(null) // a full_mock_sets row, once the code checks out

  const resetForNextCode = () => {
    setCheckedInSet(null)
    setFullName('')
    setCode('')
    setError('')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (checking) return

    const trimmedName = fullName.trim()
    const normalizedCode = normalizeCode(code)

    if (!trimmedName) {
      setError('Enter your full name as your teacher has it.')
      return
    }
    if (!normalizedCode) {
      setError('Enter the code your teacher gave you.')
      return
    }

    setChecking(true)
    setError('')

    try {
      const { data: row, error: lookupError } = await supabase
        .from('mock_access_codes')
        .select('*')
        .eq('code', normalizedCode)
        .eq('student_id', selfId)
        .maybeSingle()

      if (lookupError) throw lookupError

      // RLS already scopes this select to student_id = auth.uid(), so a
      // typo, a code meant for a different student, or one that was
      // never issued all land here the same way — a plain "not found"
      // never reveals which of those it actually was.
      if (!row) {
        setError("That code isn't valid for your account — double-check it with your teacher.")
        return
      }
      if (row.revoked) {
        setError('This code has been cancelled by your teacher. Ask them for a new one.')
        return
      }
      if (row.used_at) {
        setError('This code has already been used to start a mock. Ask your teacher for a new one if you need to retake it.')
        return
      }

      // Bug fix 2026-09-26: look up the Full Mock set BEFORE marking the
      // code used, not after. This used to run the other way around — if
      // the set had been deleted/deactivated, or this query just hit a
      // network blip, the code was already permanently burned with
      // nothing to show for it (used_at set, but checkedInSet never got
      // populated), and the only fix was a teacher issuing a brand new
      // code. Validating everything first means a failure here costs the
      // student nothing — they can just try again with the same code.
      const { data: setRow, error: setLookupError } = await supabase
        .from('full_mock_sets')
        .select('*')
        .eq('id', row.full_mock_set_id)
        .single()

      if (setLookupError) throw setLookupError

      if (!setRow) {
        setError('This code points to a mock that no longer exists — ask your teacher for a new one.')
        return
      }

      const { data: updatedRow, error: updateError } = await supabase
        .from('mock_access_codes')
        .update({ used_at: new Date().toISOString(), entered_full_name: trimmedName })
        .eq('id', row.id)
        .select('*')
        .maybeSingle()

      if (updateError) throw updateError

      // The update policy's "using" clause re-checks used_at is null and
      // revoked = false against the row as it is right now, not as it
      // was in the lookup above — so a code someone else raced to use
      // (or a teacher just revoked) in that gap comes back with no rows
      // updated instead of an error. Treat that the same as "no longer
      // usable" rather than assuming success.
      if (!updatedRow) {
        setError('This code was just used or cancelled — ask your teacher for a new one.')
        return
      }

      setCheckedInSet(setRow)
    } catch (err) {
      console.error('Mock check-in failed:', err)
      setError(err?.message || 'Something went wrong — please try again.')
    } finally {
      setChecking(false)
    }
  }

  if (checkedInSet) {
    return (
      <FullMockRunner selfId={selfId} restrictedSet={checkedInSet} onExitRestricted={resetForNextCode} />
    )
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl border border-slate-200 bg-white text-slate-900 p-6 sm:p-10 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-red-600" aria-hidden />
        <span className="text-[11px] uppercase tracking-[0.18em] text-red-600 font-semibold">
          Candidate check-in
        </span>
      </div>

      <h2 className="mt-2 text-2xl font-bold text-slate-900">Start your mock</h2>
      <p className="mt-1.5 text-sm text-slate-500">
        Enter your full name and the code your teacher gave you for this mock.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Full name
          </span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="As your teacher has it"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            autoComplete="name"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Access code
          </span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. K3F-9QT"
            className="rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-mono tracking-widest text-slate-900 placeholder:text-slate-400 placeholder:font-sans placeholder:tracking-normal focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            autoComplete="off"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={checking}
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {checking ? 'Checking…' : (
            <>
              Continue <span aria-hidden>→</span>
            </>
          )}
        </button>
      </form>

      <p className="mt-6 text-[11px] text-slate-400">
        Don't have a code? Ask your teacher — every mock attempt now needs one, just like checking
        in for the real test.
      </p>
    </div>
  )
}
