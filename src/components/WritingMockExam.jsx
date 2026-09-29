import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { MIN_WORDS, countWords, formatClock } from '../lib/writingMock'
import { readSession, writeSession } from '../lib/sessionState'

const AUTOSAVE_MS = 5000

/*
 * ================================================================
 * WRITING MOCK EXAM
 * ================================================================
 * Shipped 2026-09-24 (migration_34). Self-service, sitting right next
 * to MockExams.jsx inside MockTestCenter's "Take a Test" tab — same
 * pattern: pick an exam, sit it, done. No teacher, no group, no
 * homework row involved anywhere.
 *
 * This is a BRAND NEW system — writing_mock_exams / writing_mock_
 * attempts — deliberately separate from the older homeworks.
 * homework_type='writing_mock' + submissions.mock_essay flow
 * (WritingMockTest.jsx), per Jasur's own words: "everything teacher
 * posts is homework be it full or not full writing they are separate"
 * and "only when students take the full mock which will be in a
 * different dashboard not in a homework". Anything a teacher assigns
 * stays AI-graded homework; this is the wholly separate self-service
 * mock that a writing examiner marks by hand, read from a completely
 * different pair of tables the writing examiner queue reads from.
 *
 * Grading is human, not instant — after submit, a writing examiner
 * marks it from WritingExaminerDashboard.jsx, and the band/feedback
 * shows up on the Overview tab of this same Mock Test Center.
 * ================================================================
 */

export function tasksFor(exam) {
  return exam.task1_prompt ? ['task1', 'task2'] : ['task2']
}

export default function WritingMockExam({ selfId }) {
  const [exams, setExams] = useState([])
  const [pastAttempts, setPastAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeAttempt, setActiveAttempt] = useState(null) // { exam, attempt }

  const loadAll = async () => {
    setLoading(true)
    setError('')

    const [
      { data: examRows, error: examsError },
      { data: attemptRows, error: attemptsError },
    ] = await Promise.all([
      supabase
        .from('writing_mock_exams')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('writing_mock_attempts')
        .select('*')
        .eq('student_id', selfId)
        .order('started_at', { ascending: false }),
    ])

    if (examsError) setError(examsError.message || 'Could not load writing mocks.')
    if (attemptsError) console.error('Failed to load writing mock attempts:', attemptsError)

    setExams(examRows || [])
    setPastAttempts(attemptRows || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!selfId) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selfId])

  // An unsubmitted attempt (student minimized or closed the tab
  // mid-test) resumes straight back into the timed window — same
  // convention as WritingMockTest.jsx's "Resume Mock Test".
  const inProgress = pastAttempts.find((a) => !a.submitted_at)

  const startExam = async (exam) => {
    setError('')

    const { data, error: startError } = await supabase
      .from('writing_mock_attempts')
      .insert({ exam_id: exam.id, student_id: selfId })
      .select('*')
      .single()

    if (startError) {
      setError(startError.message || 'Could not start this writing mock.')
      return
    }

    setActiveAttempt({ exam, attempt: data })
  }

  const resumeExam = (attempt) => {
    const exam = exams.find((e) => e.id === attempt.exam_id)
    if (!exam) return
    setActiveAttempt({ exam, attempt })
  }

  if (activeAttempt) {
    return (
      <WritingTaker
        exam={activeAttempt.exam}
        attempt={activeAttempt.attempt}
        onDone={() => {
          setActiveAttempt(null)
          loadAll()
        }}
        onMinimize={() => {
          setActiveAttempt(null)
          loadAll()
        }}
      />
    )
  }

  return (
    <div className="ticket rounded-2xl p-5 sm:p-6 flex flex-col gap-5">
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
          Full writing mocks
        </div>

        <h2 className="font-display text-2xl sm:text-3xl mt-1">Writing Mock Test</h2>

        <p className="text-sm text-mist mt-1.5 max-w-md">
          Sit a full, timed writing test under real IELTS conditions. A writing examiner marks it
          by hand afterwards — check the Overview tab for your band and feedback once it's ready.
        </p>
      </div>

      <div className="border-t border-line pt-4">
        {loading && <p className="text-sm text-mist">Loading writing mocks…</p>}

        {!loading && error && <p className="text-sm text-coral">{error}</p>}

        {!loading && !error && inProgress && (
          <button
            type="button"
            onClick={() => resumeExam(inProgress)}
            className="focus-ring mb-4 w-full flex items-center justify-between rounded-xl border border-brass/40 bg-brass/10 px-4 py-3 text-left transition hover:bg-brass/15"
          >
            <span className="text-sm font-medium text-paper">
              Resume your writing mock in progress
            </span>
            <span className="text-sm font-semibold text-brass">Resume →</span>
          </button>
        )}

        {!loading && !error && exams.length === 0 && (
          <p className="text-sm text-mist">
            No writing mocks published yet — check back soon.
          </p>
        )}

        {!loading && !error && exams.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {exams.map((exam) => (
              <button
                key={exam.id}
                type="button"
                disabled={Boolean(inProgress)}
                onClick={() => startExam(exam)}
                className="focus-ring group flex flex-col justify-between rounded-xl border border-line bg-panel-2 p-4 text-left transition hover:border-brass/40 hover:bg-panel disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <span className="inline-flex items-center rounded-full bg-brass/15 px-2.5 py-1 text-[11px] font-semibold text-brass">
                    Writing
                  </span>
                  <p className="mt-2.5 font-display text-sm text-paper">{exam.title}</p>
                  <p className="mt-1 text-xs text-mist">
                    {exam.time_limit_minutes} minutes ·{' '}
                    {exam.task1_prompt ? 'Task 1 + Task 2' : 'Task 2 only'}
                  </p>
                </div>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brass group-hover:text-brass-dim">
                  Start test <span aria-hidden>→</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function WritingTaker({ exam, attempt, onDone, onMinimize }) {
  const tasks = useMemo(() => tasksFor(exam), [exam])
  const [activeTask, setActiveTask] = useState(() => {
    const saved = readSession(`ielts:writingPart:${attempt.id}`, null)
    return saved && tasks.includes(saved) ? saved : tasks[0]
  })
  const [imageLightboxOpen, setImageLightboxOpen] = useState(false)

  const [texts, setTexts] = useState({
    task1: attempt.task1_text || '',
    task2: attempt.task2_text || '',
  })

  // Server deadline + teacher pause (migration_62, 2026-09-29) — same model
  // as MockExams.jsx's ExamTaker: deadline_at is set by the database when
  // the attempt is created and only a teacher can move it (pause/resume,
  // extra time). Falls back to started_at + the exam's limit for a row
  // created before migration_62, and to 60 minutes if the exam object
  // passed in has no time_limit_minutes at all.
  const [deadlineMs, setDeadlineMs] = useState(() =>
    attempt.deadline_at
      ? new Date(attempt.deadline_at).getTime()
      : new Date(attempt.started_at).getTime() + (exam.time_limit_minutes || 60) * 60_000
  )
  const [pausedAt, setPausedAt] = useState(() =>
    attempt.paused_at ? new Date(attempt.paused_at).getTime() : null
  )
  const [endedExternally, setEndedExternally] = useState(null) // 'submitted' | 'deleted' | null

  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((deadlineMs - (pausedAt ?? Date.now())) / 1000))
  )

  const [submitting, setSubmitting] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [error, setError] = useState('')

  const textsRef = useRef(texts)
  textsRef.current = texts

  const tabSwitchCountRef = useRef(attempt.tab_switch_count || 0)
  const submittedRef = useRef(false)
  const submittingRef = useRef(false)

  const finishTest = async ({ auto = false } = {}) => {
    if (submittedRef.current || submittingRef.current) return

    submittingRef.current = true
    setSubmitting(true)
    setError('')

    try {
      const { error: updateError } = await supabase
        .from('writing_mock_attempts')
        .update({
          task1_text: textsRef.current.task1,
          task2_text: textsRef.current.task2,
          tab_switch_count: tabSwitchCountRef.current,
          submitted_at: new Date().toISOString(),
          auto_submitted: auto,
        })
        .eq('id', attempt.id)

      if (updateError) throw updateError

      submittedRef.current = true
      onDone()
    } catch (err) {
      console.error('Writing mock submit failed:', err)
      setError(err?.message || 'Could not submit — please try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  useEffect(() => {
    if (endedExternally) return

    if (pausedAt) {
      setRemaining(Math.max(0, Math.round((deadlineMs - pausedAt) / 1000)))
      return
    }

    const tick = () => {
      const left = Math.max(0, Math.round((deadlineMs - Date.now()) / 1000))
      setRemaining(left)

      if (left <= 0 && !submittedRef.current && !submittingRef.current) {
        finishTest({ auto: true })
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineMs, pausedAt, endedExternally])

  // Poll this attempt's own row for teacher actions — pause/resume, extra
  // time, "end section now", or the sitting being cancelled.
  useEffect(() => {
    if (endedExternally) return
    let cancelled = false

    const id = setInterval(async () => {
      if (submittedRef.current) return
      const { data: row, error: pollError } = await supabase
        .from('writing_mock_attempts')
        .select('*')
        .eq('id', attempt.id)
        .maybeSingle()

      if (cancelled || pollError) return

      if (!row) {
        submittedRef.current = true
        setEndedExternally('deleted')
        return
      }
      if (row.submitted_at && !submittingRef.current) {
        submittedRef.current = true
        setEndedExternally('submitted')
        return
      }
      if (row.deadline_at) {
        const serverDeadline = new Date(row.deadline_at).getTime()
        setDeadlineMs((prev) => (prev === serverDeadline ? prev : serverDeadline))
      }
      const nextPaused = row.paused_at ? new Date(row.paused_at).getTime() : null
      setPausedAt((prev) => (prev === nextPaused ? prev : nextPaused))
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endedExternally])

  useEffect(() => {
    const id = setInterval(() => {
      if (submittedRef.current) return

      supabase
        .from('writing_mock_attempts')
        .update({
          task1_text: textsRef.current.task1,
          task2_text: textsRef.current.task2,
          tab_switch_count: tabSwitchCountRef.current,
        })
        .eq('id', attempt.id)
        .then(({ error: autosaveError }) => {
          if (autosaveError) {
            console.error('Autosave failed:', autosaveError)
            return
          }
          setLastSavedAt(new Date())
        })
    }, AUTOSAVE_MS)

    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handler = (e) => {
      if (submittedRef.current) return
      e.preventDefault()
      e.returnValue = ''
    }

    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // Quiet integrity log — same convention as WritingMockTest.jsx.
  useEffect(() => {
    let away = false

    const markAway = () => {
      if (!away && !submittedRef.current) {
        away = true
        tabSwitchCountRef.current += 1
      }
    }

    const markBack = () => {
      away = false
    }

    const onVisibility = () => {
      if (document.hidden) markAway()
      else markBack()
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', markAway)
    window.addEventListener('focus', markBack)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', markAway)
      window.removeEventListener('focus', markBack)
    }
  }, [])

  // No "Submit Now" and no "Minimize" any more (2026-09-29) — same rule
  // Jasur set for Listening/Reading ("submit button shouldnt be
  // available") and his "students can freely press back to dashboard and
  // interrupt the mock": Writing ends only when its time runs out, or when
  // the teacher ends it from Live Mocks. `onMinimize` is still accepted as
  // a prop so existing callers don't break, but nothing calls it.
  void onMinimize

  const blockPaste = (e) => e.preventDefault()

  const timeUp = remaining <= 0

  if (endedExternally) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-900 shadow-sm">
        <p className="text-lg font-bold">
          {endedExternally === 'deleted'
            ? 'This sitting was cancelled by your teacher.'
            : 'Your teacher has ended the Writing test.'}
        </p>
        <p className="mt-2 text-sm text-slate-500">
          {endedExternally === 'deleted'
            ? 'Please wait — you will be taken back in a moment.'
            : 'Your writing up to the last save has been recorded. Please wait a moment.'}
        </p>
      </div>
    )
  }

  // REAL-EXAM LAYOUT (2026-09-29) — Jasur: "in task 1, the graph has to
  // be on the left side of the screen, like in the screenshot i sent you.
  // task 2 has to be like in the screenshot as well." His screenshots of
  // the real computer-delivered test: pink bar on top; a "Part 1" box
  // with "You should spend about 20 minutes on this task. Write at least
  // 150 words."; below it a split screen — the task (and Task 1's chart)
  // on the LEFT, the answer box on the RIGHT with "Word count: N" under
  // it; ← / → arrows bottom-right; and a footer with "Part 1  0 of 1" /
  // "Part 2  [2]". The whole screen never scrolls — only the task pane
  // (e.g. a tall chart) scrolls on its own, and the answer box.
  const partNo = (t) => (t === 'task1' ? 1 : 2)
  const partGuide = (t) =>
    t === 'task1'
      ? `You should spend about 20 minutes on this task. Write at least ${MIN_WORDS.task1 || 150} words.`
      : `You should spend about 40 minutes on this task. Write at least ${MIN_WORDS.task2 || 250} words.`
  const activeIdx = Math.max(0, tasks.indexOf(activeTask))
  const goTask = (t) => {
    setActiveTask(t)
    writeSession(`ielts:writingPart:${attempt.id}`, t)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col overflow-hidden bg-ink text-paper">
      <div
        className="relative z-20 flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-2.5 shadow-md"
        style={{ background: '#e3a7ae', color: '#1c1b29' }}
      >
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest opacity-60">Writing</p>
          <p className="truncate font-display text-sm font-bold leading-tight">{exam.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {lastSavedAt && (
            <span className="hidden text-xs opacity-70 sm:inline">saved {lastSavedAt.toLocaleTimeString()}</span>
          )}
          <span
            className={`font-display text-lg font-bold tabular-nums ${remaining <= 60 ? 'animate-pulse' : ''}`}
            style={{ color: remaining <= 300 ? '#b3261e' : undefined }}
          >
            {formatClock(remaining)}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pt-4 sm:px-6">
        <div className="shrink-0 rounded-md border border-line bg-panel px-5 py-3">
          <p className="font-display text-2xl leading-tight text-paper">Part {partNo(activeTask)}</p>
          <p className="mt-1 text-sm text-paper/85">{partGuide(activeTask)}</p>
        </div>

        <div className="relative min-h-0 flex-1">
          {tasks.map((t) => {
            if (t !== activeTask) return null

            const prompt = t === 'task1' ? exam.task1_prompt : exam.task2_prompt
            const image = t === 'task1' ? exam.task1_image_url : null
            const words = countWords(texts[t])

            return (
              <div
                key={t}
                className="grid h-full grid-cols-1 gap-5 overflow-y-auto overscroll-contain pb-20 lg:grid-cols-2 lg:gap-0 lg:overflow-hidden lg:pb-0"
              >
                {/* LEFT — the task itself (and Task 1's chart/graph/table). */}
                <div className="lg:h-full lg:overflow-y-auto lg:overscroll-contain lg:border-r lg:border-line lg:pr-6">
                  {prompt && (
                    <p className="whitespace-pre-wrap text-[0.95rem] font-semibold leading-relaxed text-paper">
                      {prompt}
                    </p>
                  )}
                  {image && (
                    <button
                      type="button"
                      onClick={() => setImageLightboxOpen(true)}
                      className="focus-ring mt-4 block w-full cursor-zoom-in"
                      title="Click to enlarge"
                    >
                      <img
                        src={image}
                        alt="Task 1 chart"
                        className="w-full rounded-sm border border-line bg-white object-contain"
                      />
                    </button>
                  )}
                </div>

                {/* RIGHT — the answer box, "Word count: N" underneath. */}
                <div className="flex min-h-[320px] flex-col lg:h-full lg:pl-6 lg:pb-16">
                  <textarea
                    value={texts[t]}
                    onChange={(e) => setTexts((prev) => ({ ...prev, [t]: e.target.value }))}
                    onPaste={blockPaste}
                    onDrop={blockPaste}
                    onContextMenu={(e) => e.preventDefault()}
                    disabled={submitting || timeUp || Boolean(pausedAt)}
                    className="focus-ring min-h-0 w-full flex-1 resize-none rounded-sm border border-line bg-panel-2 px-4 py-3 text-[0.95rem] leading-7 text-paper"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    aria-label={`Part ${partNo(t)} answer`}
                  />
                  <p className="mt-2 shrink-0 text-sm text-paper/85">Word count: {words}</p>
                  {error && <p className="mt-1 text-sm text-coral">{error}</p>}
                  {timeUp && (
                    <p className="mt-1 text-sm text-mist">
                      Time's up — {submitting ? 'submitting your answer…' : 'your answer is being submitted.'}
                    </p>
                  )}
                </div>

                {image && imageLightboxOpen && (
                  <div
                    className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 p-6"
                    onClick={() => setImageLightboxOpen(false)}
                  >
                    <img
                      src={image}
                      alt="Task 1 chart, enlarged"
                      className="max-h-full max-w-full rounded-lg border border-line bg-white object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => setImageLightboxOpen(false)}
                      className="focus-ring absolute top-5 right-5 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-panel text-paper transition hover:border-brass hover:text-brass"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )
          })}

          {tasks.length > 1 && (
            <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex gap-1.5">
              <button
                type="button"
                onClick={() => activeIdx > 0 && goTask(tasks[activeIdx - 1])}
                title="Previous part"
                className="pointer-events-auto focus-ring flex h-12 w-12 items-center justify-center rounded-sm bg-[#8a8a8a] text-2xl font-bold text-white shadow hover:bg-[#777]"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => activeIdx < tasks.length - 1 && goTask(tasks[activeIdx + 1])}
                title="Next part"
                className="pointer-events-auto focus-ring flex h-12 w-12 items-center justify-center rounded-sm bg-black text-2xl font-bold text-white shadow hover:bg-[#222]"
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer part navigator — "Part 1  0 of 1" for the part you're not
          on (1 of 1 once anything is written), "Part 2  [2]" for the one
          you're on. */}
      <div className="flex shrink-0 items-stretch gap-6 border-t border-line bg-panel px-3 pb-2 sm:px-4">
        {tasks.map((t) =>
          t === activeTask ? (
            <div key={t} className="flex flex-1 items-center gap-2 pt-1.5">
              <span className="px-2 pt-1 text-sm font-bold text-paper">Part {partNo(t)}</span>
              <span
                className={`flex h-8 min-w-[2.1rem] items-center justify-center rounded-sm border-t-2 px-1 text-sm font-bold text-paper outline outline-2 outline-brass ${
                  texts[t].trim() ? 'border-t-paper' : 'border-t-line'
                }`}
              >
                {partNo(t)}
              </span>
            </div>
          ) : (
            <button
              key={t}
              type="button"
              onClick={() => goTask(t)}
              className="focus-ring flex shrink-0 items-center gap-4 border-t-2 border-line px-2 pt-2.5 text-sm text-paper/80 hover:text-paper"
            >
              <span>Part {partNo(t)}</span>
              <span className="text-mist">{texts[t].trim() ? 1 : 0} of 1</span>
            </button>
          )
        )}
      </div>

      {pausedAt && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 p-6">
          <div className="max-w-md rounded-xl bg-white px-8 py-7 text-center text-slate-900 shadow-2xl">
            <p className="text-xl font-bold">Your test has been paused</p>
            <p className="mt-2 text-sm text-slate-600">
              Your teacher has paused this test. The timer is stopped and your writing is saved.
              It will continue from exactly where you are when your teacher resumes it.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
