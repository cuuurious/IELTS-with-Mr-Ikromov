import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import FullMockRunner from './FullMockRunner'
import MockLibrary from './MockLibrary'

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

// `checkedInSet` (a full_mock_sets row, once a code checks out) is owned
// by MockTestCenter, not held here — see the EXAM LOCKDOWN note there.
// Setting it is what switches MockTestCenter into its locked full-screen
// layout, which remounts this component in a new spot; keeping it up
// there means that remount can't wipe it.
export default function MockCheckIn({ selfId, checkedInSet, onCheckedInSetChange }) {
  const [fullName, setFullName] = useState('')
  const [code, setCode] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')
  const setCheckedInSet = onCheckedInSetChange

  /*
   * ================================================================
   * AVAILABLE MOCKS + REQUEST ACCESS (migration_61)
   * ================================================================
   * Shipped 2026-09-27. Before this, a student could only ever start a
   * mock if a teacher proactively issued them a code — there was no
   * screen where they could see what's available and ask for one
   * themselves. Jasur's own suggestion, after asking why the teacher's
   * Issue Codes picker looked empty: "maybe we have to add smth like
   * request teacher to start mock and then teacher is able to accept
   * one by one or all at the same time??"
   *
   * Every PUBLISHED (is_active) Full Mock set is listed below, regardless
   * of group — full_mock_sets_select's own RLS already exposes every
   * active set to any signed-in student (migration_37), so this is
   * exactly what a student could already see if they queried the table
   * directly; this just gives it a real screen and a button. Requesting
   * inserts a mock_access_requests row; the teacher's Full Mocks tab
   * shows it in a new "Mock requests" queue, and approving it there
   * auto-generates and sends the actual code — this screen never
   * creates a code itself, only asks for one.
   */
  const [fullMockSets, setFullMockSets] = useState([])
  const [myRequests, setMyRequests] = useState([])
  const [myUnusedCodes, setMyUnusedCodes] = useState([])
  const [availableLoading, setAvailableLoading] = useState(true)
  const [requestingSetId, setRequestingSetId] = useState(null)
  const [requestError, setRequestError] = useState('')

  const reloadAvailableMocks = async () => {
    const [{ data: setRows, error: setsError }, { data: requestRows, error: requestsError }, { data: codeRows, error: codesError }] =
      await Promise.all([
        supabase
          .from('full_mock_sets')
          .select('id, title, listening_exam_id, reading_exam_id, writing_exam_id, created_at')
          .eq('is_active', true)
          .order('title', { ascending: true }),
        supabase
          .from('mock_access_requests')
          .select('*')
          .eq('student_id', selfId)
          .order('requested_at', { ascending: false }),
        supabase
          .from('mock_access_codes')
          .select('*')
          .eq('student_id', selfId)
          .is('used_at', null)
          .eq('revoked', false),
      ])

    if (setsError) console.error('Failed to load full mock sets:', setsError)
    if (requestsError) console.error('Failed to load mock access requests:', requestsError)
    if (codesError) console.error('Failed to load access codes:', codesError)

    setFullMockSets(setRows || [])
    setMyRequests(requestRows || [])
    setMyUnusedCodes(codeRows || [])
    setAvailableLoading(false)
  }

  useEffect(() => {
    reloadAvailableMocks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId])

  /*
   * UNFINISHED SITTINGS — "Continue" (2026-09-29, migration_62). A code
   * is single-use, so before teacher pausing existed there was no way
   * back into a sitting once its window was closed. Now a teacher can
   * pause a mock so the student finishes (say) Writing another day — this
   * lists every sitting the student hasn't finished, with a Continue
   * button that re-enters it without a new code. FullMockRunner then
   * resumes exactly where it was (and shows "paused" if it still is).
   */
  const [unfinished, setUnfinished] = useState([]) // [{ attempt, set }]
  const [continueError, setContinueError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data: rows, error: rowsError } = await supabase
        .from('full_mock_attempts')
        .select('*')
        .eq('student_id', selfId)
        .neq('stage', 'done')
        .order('started_at', { ascending: false })

      if (cancelled) return
      if (rowsError) {
        console.error('Failed to load unfinished mocks:', rowsError)
        return
      }
      const setIds = [...new Set((rows || []).map((r) => r.set_id))]
      if (setIds.length === 0) {
        setUnfinished([])
        return
      }
      const { data: setRows } = await supabase.from('full_mock_sets').select('*').in('id', setIds)
      if (cancelled) return
      const setById = {}
      ;(setRows || []).forEach((s) => {
        setById[s.id] = s
      })
      setUnfinished(
        (rows || []).filter((r) => setById[r.set_id]).map((r) => ({ attempt: r, set: setById[r.set_id] }))
      )
    }
    load()
    return () => {
      cancelled = true
    }
  }, [selfId])

  const continueSitting = (set) => {
    setContinueError('')
    if (!set) {
      setContinueError('This mock is no longer available — ask your teacher.')
      return
    }
    setCheckedInSet(set)
  }

  // What to show for one set: an unused/unrevoked code takes priority
  // (they can act on it right now), then a pending request, then their
  // most recent rejected request (if any), then nothing — offer to
  // request. A used-up code from a past attempt falls through here just
  // like "nothing", so requesting a retake works the same as a first try.
  const statusForSet = (setId) => {
    const unusedCode = myUnusedCodes.find((c) => c.full_mock_set_id === setId)
    if (unusedCode) return { kind: 'has-code', code: unusedCode }

    const pending = myRequests.find((r) => r.full_mock_set_id === setId && r.status === 'pending')
    if (pending) return { kind: 'pending', request: pending }

    const lastRejected = myRequests
      .filter((r) => r.full_mock_set_id === setId && r.status === 'rejected')
      .sort((a, b) => new Date(b.requested_at) - new Date(a.requested_at))[0]
    if (lastRejected) return { kind: 'rejected', request: lastRejected }

    return { kind: 'none' }
  }

  const requestAccess = async (setId) => {
    setRequestingSetId(setId)
    setRequestError('')
    try {
      const { error: insertError } = await supabase
        .from('mock_access_requests')
        .insert({ student_id: selfId, full_mock_set_id: setId, status: 'pending' })

      // 23505 = unique_violation — a pending request for this set already
      // exists (e.g. a double-click, or another tab beat this one to it).
      // Not a real failure from the student's point of view: they already
      // have a pending request either way, so just refresh and move on.
      if (insertError && insertError.code !== '23505') throw insertError

      await reloadAvailableMocks()
    } catch (err) {
      console.error('Could not request mock access:', err)
      setRequestError(err?.message || 'Could not send that request — please try again.')
    } finally {
      setRequestingSetId(null)
    }
  }

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
        setError(
          unfinished.some((u) => u.set.id === row.full_mock_set_id)
            ? 'This code has already been used — to carry on with that mock, press Continue above.'
            : 'This code has already been used to start a mock. Ask your teacher for a new one if you need to retake it.'
        )
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

      // Only these two columns (2026-10-06): for students the server now
      // forces used_at := now() (the value sent here is ignored) and
      // rejects a change to any other column.
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

  const STAGE_LABELS = { listening: 'Listening', reading: 'Reading', writing: 'Writing' }

  return (
    // Check-in on the left, the mock library on the right (2026-10-06);
    // stacked on narrow screens.
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
    <div className="flex flex-col gap-6 lg:sticky lg:top-6">
      {unfinished.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white text-slate-900 p-6 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Unfinished mock{unfinished.length === 1 ? '' : 's'}
          </h3>
          {continueError && <p className="mt-2 text-sm text-red-600">{continueError}</p>}
          <div className="mt-3 flex flex-col gap-2.5">
            {unfinished.map(({ attempt, set }) => (
              <div
                key={attempt.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate">{set.title}</p>
                  <p className="text-xs text-slate-500">
                    {attempt.paused_at ? 'Paused by your teacher · ' : ''}
                    Next: {STAGE_LABELS[attempt.stage] || attempt.stage}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => continueSitting(set)}
                  className="shrink-0 rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  Continue →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white text-slate-900 p-6 sm:p-10 shadow-sm">
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
            id="mock-access-code"
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
          Don't have a code yet? Request one for any mock in the library and your teacher will send it once
          they approve.
        </p>
      </div>

    </div>

      <MockLibrary
        selfId={selfId}
        fullMockSets={fullMockSets}
        loading={availableLoading}
        statusForSet={statusForSet}
        unfinishedSetIds={unfinished.map((u) => u.set.id)}
        requestingSetId={requestingSetId}
        requestError={requestError}
        onRequest={requestAccess}
        onUseCode={(value) => {
          setCode(value)
          const input = document.getElementById('mock-access-code')
          input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          input?.focus({ preventScroll: true })
        }}
        onContinue={(setId) => continueSitting(unfinished.find((u) => u.set.id === setId)?.set)}
      />
    </div>
  )
}
