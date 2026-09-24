import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import ConfirmModal from './ConfirmModal'
import { MIN_WORDS, countWords, secondsRemaining, formatClock } from '../lib/writingMock'

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

function tasksFor(exam) {
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

function WritingTaker({ exam, attempt, onDone, onMinimize }) {
  const tasks = useMemo(() => tasksFor(exam), [exam])
  const [activeTask, setActiveTask] = useState(tasks[0])
  const [imageLightboxOpen, setImageLightboxOpen] = useState(false)

  const [texts, setTexts] = useState({
    task1: attempt.task1_text || '',
    task2: attempt.task2_text || '',
  })

  const [remaining, setRemaining] = useState(() =>
    secondsRemaining(attempt.started_at, exam.time_limit_minutes)
  )

  const [submitting, setSubmitting] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [confirmDialog, setConfirmDialog] = useState(null)
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
    const tick = () => {
      const left = secondsRemaining(attempt.started_at, exam.time_limit_minutes)
      setRemaining(left)

      if (left <= 0 && !submittedRef.current && !submittingRef.current) {
        finishTest({ auto: true })
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleManualSubmit = () => {
    const short = tasks.filter((t) => MIN_WORDS[t] && countWords(texts[t]) < MIN_WORDS[t])

    if (short.length) {
      setConfirmDialog({
        title: 'Short on words',
        points: short.map(
          (t) =>
            `${t === 'task1' ? 'Task 1' : 'Task 2'}: ${countWords(texts[t])} words (IELTS recommends at least ${MIN_WORDS[t]})`
        ),
        message: 'You can still submit as-is, or go back and keep writing.',
        confirmLabel: 'Submit anyway',
        cancelLabel: 'Keep writing',
        tone: 'coral',
        onConfirm: () => finishTest({ auto: false }),
      })
      return
    }

    setConfirmDialog({
      title: 'Submit your writing mock?',
      message:
        "You won't be able to make further changes after this. A writing examiner will mark it and you'll see your band on the Overview tab.",
      confirmLabel: 'Submit Now',
      cancelLabel: 'Keep writing',
      onConfirm: () => finishTest({ auto: false }),
    })
  }

  const handleMinimize = () => {
    setConfirmDialog({
      title: 'Hide the writing window?',
      message:
        'The timer keeps running in the background. Come back to "Take a Test" anytime — it opens straight back up where you left off.',
      confirmLabel: 'Minimize',
      cancelLabel: 'Stay here',
      onConfirm: async () => {
        await supabase
          .from('writing_mock_attempts')
          .update({
            task1_text: textsRef.current.task1,
            task2_text: textsRef.current.task2,
            tab_switch_count: tabSwitchCountRef.current,
          })
          .eq('id', attempt.id)

        onMinimize()
      },
    })
  }

  const blockPaste = (e) => e.preventDefault()

  const timeUp = remaining <= 0

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-panel overflow-hidden">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="font-display text-lg text-paper truncate">{exam.title}</div>
          <span className="shrink-0 text-xs font-mono text-mist">
            {tasks.length > 1 ? 'Full Test' : 'Task 2'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div
            className={`font-mono text-lg tabular-nums px-3 py-1 rounded-md border ${
              remaining <= 60
                ? 'border-coral text-coral animate-pulse'
                : remaining <= 300
                ? 'border-amber text-amber'
                : 'border-line text-paper'
            }`}
          >
            {formatClock(remaining)}
          </div>

          <button
            type="button"
            onClick={handleMinimize}
            disabled={submitting}
            className="focus-ring text-xs text-mist hover:text-paper disabled:opacity-40"
          >
            Minimize
          </button>
        </div>
      </div>

      {tasks.length > 1 && (
        <div className="shrink-0 flex gap-2 border-b border-line bg-panel-2 px-4 py-2 sm:px-6">
          {tasks.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTask(t)}
              className={`focus-ring px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTask === t ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
              }`}
            >
              {t === 'task1' ? 'Task 1' : 'Task 2'} · {countWords(texts[t])} words
            </button>
          ))}
        </div>
      )}

      <div className="px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {tasks.map((t) => {
            if (t !== activeTask) return null

            const prompt = t === 'task1' ? exam.task1_prompt : exam.task2_prompt
            const image = t === 'task1' ? exam.task1_image_url : null
            const words = countWords(texts[t])
            const min = MIN_WORDS[t]
            const under = min && words < min

            return (
              <div key={t} className="flex flex-col gap-3">
                {(prompt || image) && (
                  <div className="shrink-0 rounded-lg border border-line bg-panel-2 p-4">
                    {prompt && (
                      <p className="text-sm text-paper-dim whitespace-pre-wrap">{prompt}</p>
                    )}

                    {image && (
                      <button
                        type="button"
                        onClick={() => setImageLightboxOpen(true)}
                        className="focus-ring mt-3 block cursor-zoom-in"
                        title="Click to enlarge"
                      >
                        <img
                          src={image}
                          alt="Task 1 chart"
                          className="max-h-72 w-auto rounded-md border border-line object-contain"
                        />
                      </button>
                    )}
                  </div>
                )}

                {image && imageLightboxOpen && (
                  <div
                    className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/80 p-6"
                    onClick={() => setImageLightboxOpen(false)}
                  >
                    <img
                      src={image}
                      alt="Task 1 chart, enlarged"
                      className="max-h-full max-w-full rounded-lg border border-line object-contain"
                    />

                    <button
                      type="button"
                      onClick={() => setImageLightboxOpen(false)}
                      className="focus-ring absolute top-5 right-5 w-10 h-10 rounded-full bg-panel border border-line text-paper flex items-center justify-center hover:border-brass hover:text-brass transition"
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                )}

                <textarea
                  value={texts[t]}
                  onChange={(e) => setTexts((prev) => ({ ...prev, [t]: e.target.value }))}
                  onPaste={blockPaste}
                  onDrop={blockPaste}
                  onContextMenu={(e) => e.preventDefault()}
                  disabled={submitting || timeUp}
                  placeholder={`Write your ${t === 'task1' ? 'Task 1' : 'Task 2'} answer here…`}
                  className="focus-ring min-h-[320px] w-full resize-none bg-panel-2 border border-line rounded-lg px-4 py-3 text-sm leading-6 text-paper"
                  spellCheck={false}
                />

                <div className="shrink-0 flex items-center justify-between text-xs">
                  <span className={under ? 'text-coral font-medium' : 'text-mist'}>
                    {words} word{words === 1 ? '' : 's'}
                    {min ? ` · minimum ${min}` : ''}
                  </span>

                  {lastSavedAt && (
                    <span className="text-mist font-mono">
                      saved {lastSavedAt.toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {error && <p className="px-4 sm:px-6 pb-3 text-sm text-coral">{error}</p>}

      <div className="shrink-0 flex items-center justify-between gap-3 border-t border-line bg-panel px-4 py-3 sm:px-6">
        <p className="text-xs text-mist">
          Pasting is disabled — type your answer directly. Your work is saved automatically.
        </p>

        <button
          type="button"
          onClick={handleManualSubmit}
          disabled={submitting}
          className="focus-ring px-5 py-2.5 rounded-md bg-brass text-onbrass font-medium disabled:opacity-40"
        >
          {submitting ? 'Submitting…' : 'Submit Now'}
        </button>
      </div>

      {timeUp && (
        <div className="px-4 sm:px-6 pb-4">
          <div className="rounded-xl border border-line bg-panel-2 px-4 py-3 text-center text-sm text-mist">
            Time's up — {submitting ? 'submitting your answer…' : 'your answer is being submitted.'}
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmDialog)}
        {...confirmDialog}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const run = confirmDialog?.onConfirm
          setConfirmDialog(null)
          run?.()
        }}
      />
    </div>
  )
}
