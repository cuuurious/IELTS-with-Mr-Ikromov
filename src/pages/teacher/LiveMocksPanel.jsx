import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import ConfirmModal from '../../components/ConfirmModal'

/*
 * ================================================================
 * LIVE MOCKS — the teacher's control room for Full Mock sittings
 * ================================================================
 * Added 2026-09-29 (migration_62). Jasur: "i want to be able to delete
 * the old mocks... pause a mock for any student... skip some sections...
 * basically i want to add new things to admin dashboard which is mine,
 * everything should be controllable." Options he picked: live monitor,
 * extra time & end-section-now, void & allow retake, retake limit.
 *
 * One row per sitting (full_mock_attempts). For a sitting still in
 * progress it shows where the student is right now — which section,
 * time left, how many answers are in, tab switches, when their screen
 * last saved — and every control:
 *
 *   Pause / Resume      freezes the clock (and Listening audio) on the
 *                       student's screen; resume gives back exactly the
 *                       time that was left, even days later.
 *   +5 min / +10 min    extra time on the section running right now.
 *   End <section> now   grades what they've answered so far (last
 *                       autosave) and moves them to the next section.
 *   Skip <section>      same button when they haven't started that
 *                       section yet (still on its instructions screen).
 *   Void & retake       deletes the sitting (it won't count anywhere)
 *                       and sends them a fresh code for the same mock.
 *   Delete              removes the sitting and all its answers — e.g.
 *                       your own test runs.
 *
 * All of these go through teacher-only database functions
 * (teacher_pause_full_mock etc.) — the student's screen picks each change
 * up within about 5 seconds on its own.
 * ================================================================
 */

const STAGES = ['listening', 'reading', 'writing']
const STAGE_LABEL = { listening: 'Listening', reading: 'Reading', writing: 'Writing', done: 'Finished' }
const FILTERS = [
  { key: 'live', label: 'In progress' },
  { key: 'finished', label: 'Finished' },
  { key: 'all', label: 'All sittings' },
]

function formatLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return h > 0 ? `${h}:${mmss}` : mmss
}

function formatAgo(iso, now) {
  if (!iso) return '—'
  const diff = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

function countWords(text) {
  const t = (text || '').trim()
  return t ? t.split(/\s+/).length : 0
}

export default function LiveMocksPanel({ students, fullMockSets, onReissueCode, onDataChanged }) {
  const [filter, setFilter] = useState('live')
  const [sittings, setSittings] = useState([])
  const [rlAttempts, setRlAttempts] = useState([])
  const [writingAttempts, setWritingAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [notice, setNotice] = useState(null) // { tone, text }
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const studentById = useMemo(() => {
    const map = {}
    ;(students || []).forEach((s) => {
      map[s.id] = s
    })
    return map
  }, [students])

  const setById = useMemo(() => {
    const map = {}
    ;(fullMockSets || []).forEach((s) => {
      map[s.id] = s
    })
    return map
  }, [fullMockSets])

  // 2026-10-06 review:
  //  - request token: a slow load started under the previous filter could
  //    land after the new one and overwrite it — only the newest load may
  //    write state now;
  //  - the 10 s poll read select('*') of every live attempt (whole
  //    draft_answers jsonb, essays…) — now only the columns shown here
  //    (answers only, not notes/audio state; essays are still needed for
  //    the word counts);
  //  - polling pauses while this browser tab is hidden and refreshes as
  //    soon as it's visible again.
  const loadTokenRef = useRef(0)

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current
    let query = supabase
      .from('full_mock_attempts')
      .select('id, set_id, student_id, stage, sections, paused_at, started_at, completed_at')
      .order('started_at', { ascending: false })
      .limit(200)
    if (filter === 'live') query = query.neq('stage', 'done')
    if (filter === 'finished') query = query.eq('stage', 'done')

    const { data: rows, error } = await query
    if (token !== loadTokenRef.current) return
    if (error) {
      setLoadError(error.message || 'Could not load sittings.')
      setLoading(false)
      return
    }

    const liveStudentIds = [...new Set((rows || []).filter((r) => r.stage !== 'done').map((r) => r.student_id))]

    let rl = []
    let w = []
    if (liveStudentIds.length > 0) {
      const [rlRes, wRes] = await Promise.all([
        supabase
          .from('mock_attempts')
          .select('id, user_id, exam_id, started_at, deadline_at, paused_at, tab_switch_count, last_seen_at, answers:draft_answers->answers')
          .in('user_id', liveStudentIds)
          .is('submitted_at', null),
        supabase
          .from('writing_mock_attempts')
          .select('id, student_id, exam_id, started_at, deadline_at, paused_at, tab_switch_count, last_seen_at, task1_text, task2_text')
          .in('student_id', liveStudentIds)
          .is('submitted_at', null),
      ])
      if (token !== loadTokenRef.current) return
      rl = rlRes.data || []
      w = wRes.data || []
    }

    setSittings(rows || [])
    setRlAttempts(rl)
    setWritingAttempts(w)
    setLoadError('')
    setLoading(false)
  }, [filter])

  useEffect(() => {
    setLoading(true)
    load()
    const id = setInterval(() => {
      if (!document.hidden) load()
    }, 10_000)
    const onVisible = () => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // The section attempt running right now for a sitting (same rule as the
  // database's own _full_mock_live_section): the newest unsubmitted
  // attempt for this student on the exam that matches the current stage.
  const liveSectionFor = (sitting) => {
    const set = setById[sitting.set_id]
    if (!set || sitting.stage === 'done') return null
    if (sitting.stage === 'writing') {
      const row = writingAttempts
        .filter((a) => a.student_id === sitting.student_id && a.exam_id === set.writing_exam_id)
        .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0]
      return row ? { kind: 'writing', row } : null
    }
    const examId = sitting.stage === 'listening' ? set.listening_exam_id : set.reading_exam_id
    const row = rlAttempts
      .filter((a) => a.user_id === sitting.student_id && a.exam_id === examId)
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))[0]
    return row ? { kind: 'rl', row } : null
  }

  const run = async (sitting, fn, successText) => {
    setBusyId(sitting.id)
    setNotice(null)
    try {
      await fn()
      if (successText) setNotice({ tone: 'sage', text: successText })
      await load()
      // Results / Student Progress live in the parent and must drop (or
      // pick up) whatever this action just changed.
      onDataChanged?.()
    } catch (err) {
      console.error('Live mock action failed:', err)
      setNotice({ tone: 'coral', text: err?.message || 'That did not work — please try again.' })
    } finally {
      setBusyId(null)
    }
  }

  const rpc = async (name, params) => {
    const { data, error } = await supabase.rpc(name, params)
    if (error) throw error
    return data
  }

  const nameOf = (sitting) => {
    const s = studentById[sitting.student_id]
    return s?.full_name || s?.username || 'Student'
  }

  const pause = (sitting) =>
    run(sitting, () => rpc('teacher_pause_full_mock', { p_full_id: sitting.id }), `Paused ${nameOf(sitting)}'s mock.`)

  const resume = (sitting) =>
    run(sitting, () => rpc('teacher_resume_full_mock', { p_full_id: sitting.id }), `Resumed ${nameOf(sitting)}'s mock.`)

  const addTime = (sitting, minutes) =>
    run(
      sitting,
      () => rpc('teacher_add_time_full_mock', { p_full_id: sitting.id, p_minutes: minutes }),
      `Added ${minutes} minutes for ${nameOf(sitting)}.`
    )

  const advance = (sitting, started) => {
    const label = STAGE_LABEL[sitting.stage]
    setConfirmDialog({
      title: started ? `End ${label} now for ${nameOf(sitting)}?` : `Skip ${label} for ${nameOf(sitting)}?`,
      message: started
        ? `Their ${label} answers are marked as they were at the last autosave (at most ~15 seconds ago), and they move straight on to the next section. This can't be undone.`
        : `They haven't started ${label} yet. It will be skipped — nothing is marked for it — and they move to the next section.`,
      confirmLabel: started ? `End ${label}` : `Skip ${label}`,
      tone: 'coral',
      onConfirm: () =>
        run(
          sitting,
          async () => {
            const next = await rpc('teacher_advance_full_mock', { p_full_id: sitting.id })
            setNotice({
              tone: 'sage',
              text:
                next === 'done'
                  ? `${nameOf(sitting)}'s mock is now finished.`
                  : `${nameOf(sitting)} moved on to ${STAGE_LABEL[next]}.`,
            })
          },
          null
        ),
    })
  }

  const remove = (sitting) => {
    const set = setById[sitting.set_id]
    setConfirmDialog({
      title: `Delete this sitting?`,
      message: `${nameOf(sitting)} — ${set?.title || 'Full Mock'}, started ${new Date(sitting.started_at).toLocaleString()}. Every answer, score and essay from it is removed and it stops counting anywhere (results, progress, retake limit). If they're sitting it right now, their screen is closed. This can't be undone.`,
      confirmLabel: 'Delete sitting',
      tone: 'coral',
      onConfirm: () =>
        run(sitting, () => rpc('teacher_delete_full_mock_attempt', { p_full_id: sitting.id }), 'Sitting deleted.'),
    })
  }

  const voidAndRetake = (sitting) => {
    const set = setById[sitting.set_id]
    setConfirmDialog({
      title: `Void & give ${nameOf(sitting)} a retake?`,
      message: `This sitting of ${set?.title || 'the mock'} is deleted (it won't count anywhere), and a fresh code for the same mock and the same sections is issued and sent to them over Telegram.`,
      confirmLabel: 'Void & send new code',
      tone: 'coral',
      onConfirm: () =>
        run(
          sitting,
          async () => {
            await rpc('teacher_delete_full_mock_attempt', { p_full_id: sitting.id })
            const result = await onReissueCode(sitting.student_id, sitting.set_id, sitting.sections || STAGES)
            setNotice({
              tone: result?.sent ? 'sage' : 'brass',
              text: result?.sent
                ? `Voided. New code ${result.code} sent to ${nameOf(sitting)} on Telegram.`
                : `Voided. New code ${result?.code || ''} issued — ${result?.reason || 'it could not be sent on Telegram'}, so share it with them another way.`,
            })
          },
          null
        ),
    })
  }

  const issueRetake = (sitting) => {
    const set = setById[sitting.set_id]
    setConfirmDialog({
      title: `Give ${nameOf(sitting)} another sitting?`,
      message: `Issues a new code for ${set?.title || 'this mock'} (same sections) and sends it over Telegram. This finished sitting is kept.`,
      confirmLabel: 'Issue code',
      onConfirm: () =>
        run(
          sitting,
          async () => {
            const result = await onReissueCode(sitting.student_id, sitting.set_id, sitting.sections || STAGES)
            setNotice({
              tone: result?.sent ? 'sage' : 'brass',
              text: result?.sent
                ? `New code ${result.code} sent to ${nameOf(sitting)} on Telegram.`
                : `New code ${result?.code || ''} issued — ${result?.reason || 'it could not be sent on Telegram'}, so share it with them another way.`,
            })
          },
          null
        ),
    })
  }

  const liveCount = sittings.filter((s) => s.stage !== 'done').length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-paper">Live Mocks</h2>
          <p className="text-sm text-mist mt-1 max-w-2xl">
            Every Full Mock sitting — who's in one right now, which section, and how much time they
            have. Pause, add time, end or skip a section, give a retake, or delete a sitting. Changes
            reach the student's screen within a few seconds.
          </p>
        </div>
        <div className="flex rounded-full border border-line bg-panel-2 p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`focus-ring rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                filter === f.key ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
              }`}
            >
              {f.label}
              {f.key === 'live' && filter === 'live' && liveCount > 0 ? ` (${liveCount})` : ''}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-xl border px-4 py-2.5 text-sm ${
            notice.tone === 'coral'
              ? 'border-coral/30 bg-coral/10 text-coral'
              : notice.tone === 'brass'
                ? 'border-brass/30 bg-brass/10 text-brass'
                : 'border-sage/30 bg-sage/10 text-sage'
          }`}
        >
          {notice.text}
        </div>
      )}

      {loadError && <p className="text-sm text-coral">{loadError}</p>}

      {loading ? (
        <p className="text-sm text-mist">Loading…</p>
      ) : sittings.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-panel/80 px-6 py-12 text-center text-sm text-mist">
          {filter === 'live' ? 'Nobody is sitting a mock right now.' : 'No sittings here yet.'}
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-panel overflow-hidden">
          {sittings.map((sitting) => {
            const set = setById[sitting.set_id]
            const sections = Array.isArray(sitting.sections) && sitting.sections.length ? sitting.sections : STAGES
            const live = liveSectionFor(sitting)
            const done = sitting.stage === 'done'
            const paused = Boolean(sitting.paused_at)
            const busy = busyId === sitting.id

            let timeLeft = null
            if (live?.row?.deadline_at) {
              const ref = live.row.paused_at ? new Date(live.row.paused_at).getTime() : now
              timeLeft = new Date(live.row.deadline_at).getTime() - ref
            }

            let progress = null
            if (live?.kind === 'rl') {
              const answers = live.row.answers || {}
              const answered = Object.values(answers).filter((v) => String(v || '').trim() !== '').length
              progress = `${answered} answered`
            } else if (live?.kind === 'writing') {
              progress = `Task 1: ${countWords(live.row.task1_text)}w · Task 2: ${countWords(live.row.task2_text)}w`
            }

            const status = done
              ? { text: `Finished ${sitting.completed_at ? new Date(sitting.completed_at).toLocaleString() : ''}`, cls: 'text-mist border-line bg-panel-2' }
              : paused
                ? { text: 'Paused', cls: 'text-amber border-amber/40 bg-amber/10' }
                : live
                  ? { text: `In ${STAGE_LABEL[sitting.stage]}`, cls: 'text-sage border-sage/30 bg-sage/10' }
                  : { text: `At ${STAGE_LABEL[sitting.stage]} instructions`, cls: 'text-brass border-brass/30 bg-brass/10' }

            const sectionState = (key) => {
              if (!sections.includes(key)) return 'skipped'
              if (done) return sitting[`${key}_attempt_id`] ? 'done' : 'skipped'
              const order = STAGES.indexOf(key)
              const cur = STAGES.indexOf(sitting.stage)
              if (order < cur) return sitting[`${key}_attempt_id`] ? 'done' : 'skipped'
              if (order === cur) return 'current'
              return 'todo'
            }

            return (
              <div key={sitting.id} className="border-b border-line last:border-b-0 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-paper truncate">{nameOf(sitting)}</p>
                    <p className="text-xs text-mist mt-0.5 truncate">
                      {set?.title || 'Full Mock'} · started {new Date(sitting.started_at).toLocaleString()}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {STAGES.map((key) => {
                        const st = sectionState(key)
                        return (
                          <span
                            key={key}
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                              st === 'current'
                                ? 'border-brass/50 bg-brass/15 text-brass'
                                : st === 'done'
                                  ? 'border-sage/30 bg-sage/10 text-sage'
                                  : st === 'skipped'
                                    ? 'border-line text-mist/60 line-through'
                                    : 'border-line text-mist'
                            }`}
                          >
                            {st === 'done' ? '✓ ' : ''}
                            {STAGE_LABEL[key]}
                          </span>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1 text-right">
                    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${status.cls}`}>
                      {status.text}
                    </span>
                    {timeLeft !== null && (
                      <span className={`font-mono text-lg tabular-nums ${timeLeft < 5 * 60_000 ? 'text-coral' : 'text-paper'}`}>
                        {formatLeft(timeLeft)} left
                      </span>
                    )}
                    {live && (
                      <span className="text-[11px] text-mist">
                        {progress} · {live.row.tab_switch_count || 0} tab switch
                        {(live.row.tab_switch_count || 0) === 1 ? '' : 'es'} · saved{' '}
                        {formatAgo(live.row.last_seen_at, now)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!done && (
                    <>
                      {paused ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => resume(sitting)}
                          className="focus-ring rounded-full bg-brass text-onbrass px-3.5 py-1.5 text-xs font-bold shadow-sm hover:bg-brass-dim disabled:opacity-50"
                        >
                          ▶ Resume
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => pause(sitting)}
                          className="focus-ring rounded-full border border-amber/40 text-amber px-3.5 py-1.5 text-xs font-bold hover:bg-amber/10 disabled:opacity-50"
                        >
                          ⏸ Pause
                        </button>
                      )}
                      {live && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => addTime(sitting, 5)}
                            className="focus-ring rounded-full border border-line text-mist px-3 py-1.5 text-xs font-semibold hover:border-brass hover:text-brass disabled:opacity-50"
                          >
                            +5 min
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => addTime(sitting, 10)}
                            className="focus-ring rounded-full border border-line text-mist px-3 py-1.5 text-xs font-semibold hover:border-brass hover:text-brass disabled:opacity-50"
                          >
                            +10 min
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => advance(sitting, Boolean(live))}
                        className="focus-ring rounded-full border border-line text-mist px-3 py-1.5 text-xs font-semibold hover:border-coral hover:text-coral disabled:opacity-50"
                      >
                        {live ? `End ${STAGE_LABEL[sitting.stage]} now` : `Skip ${STAGE_LABEL[sitting.stage]}`}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => voidAndRetake(sitting)}
                        className="focus-ring rounded-full border border-line text-mist px-3 py-1.5 text-xs font-semibold hover:border-coral hover:text-coral disabled:opacity-50"
                      >
                        Void & retake
                      </button>
                    </>
                  )}
                  {done && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => issueRetake(sitting)}
                      className="focus-ring rounded-full border border-line text-mist px-3 py-1.5 text-xs font-semibold hover:border-brass hover:text-brass disabled:opacity-50"
                    >
                      Give another sitting
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(sitting)}
                    className="focus-ring rounded-full border border-coral/30 text-coral px-3 py-1.5 text-xs font-semibold hover:bg-coral/10 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const action = confirmDialog?.onConfirm
          setConfirmDialog(null)
          action?.()
        }}
      />
    </div>
  )
}
