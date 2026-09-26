import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/*
 * ================================================================
 * MOCK EXAMS — ported from the standalone `ielts-mock-tests` app
 * (Next.js, mocks.ieltswithmrikromov.com) into the main site.
 * ================================================================
 * Jasur's call (2026-09-24): Mock Tests shouldn't be a separate site a
 * student/teacher has to sign into again — it should be a section of
 * this app, reached from the dashboard, one deploy. See
 * `mock-test-site-concept.md`'s "Merge plan into the main site" for the
 * full technical plan this was built from (a real read of the standalone
 * app's actual source, not a guess).
 *
 * This is the student-facing slice only, per that plan's suggested build
 * order — exam list, exam-taking, instant scoring. The admin exam
 * manager/editor is a separate follow-up, gated on deciding whether
 * "who can edit mock exam content" reuses this app's existing
 * `is_admin`/teacher concept or stays its own `mock_test_admins`
 * allow-list (open question, flagged in the doc — not resolved here).
 *
 * Nothing about the DATA changed in this port: same shared Supabase
 * project, same `mock_`-prefixed tables, same `submit_mock_attempt()`
 * security-definer function doing 100% of the grading in Postgres (case-
 * insensitive trimmed string match, one row per question, never returns
 * per-question correctness — only the aggregate score). Only the app
 * code calling that data moved from Next.js Server Actions to plain
 * Supabase JS calls made directly from this component, since every one
 * of those actions was already just a thin RLS-gated pass-through (the
 * standalone app's own code comments say so) — nothing privileged to
 * replicate. No separate login screen either: a signed-in user here is
 * already signed into the same Supabase project. Time limits are still
 * the same hardcoded per-module constants the standalone app used
 * (`mock_exams` has no time-limit column) — porting behavior as-is, not
 * changing it.
 *
 * EXPANDED 2026-09-26 — Phase 8 (exam-screen rebuild), first real pass.
 * Jasur picked "every single thing" from the still-open Phase 8 list:
 * flashing 10/5-minute timer warnings, single-playback audio with a
 * volume control (no scrub bar, no replay), a question navigator with
 * flag-for-review, a Reading highlight+note tool, and — the trickiest —
 * a genuine 2-minute Listening-only review window once all audio has
 * played, plus a quiet tab-switch integrity log (migration_47,
 * `mock_attempts.tab_switch_count`, same pattern
 * `WritingMockTest.jsx`/`WritingMockExam.jsx` already use). Still not
 * done from the original Phase 8 list: the exact real-exam highlight
 * colors/Settings panel (still blocked on that research gap — this pass
 * uses the app's own `amber` token rather than waiting on it further)
 * and the pink exam-chrome/split-pane visual restyle (a separate, purely
 * cosmetic pass — the STRUCTURE below is now real-exam-accurate, the
 * paint job is still this app's own brass/dark theme).
 */

const MODULE_LABEL = { reading: 'Reading', listening: 'Listening' }

const MODULE_BLURB = {
  reading: '60 minutes, three passages, timed just like the real test.',
  listening: 'Play the audio once through, answer as you go.',
}

export const TIME_LIMIT_MINUTES = { reading: 60, listening: 40 }

// Real IELTS gives exactly 2 minutes of silent review time once the
// Listening audio has finished — no more audio, just a last look at
// your answers before it submits. This is a fixed allowance tacked onto
// the end of the module, not "however much of the 40-minute budget
// happens to be left" — see the review-phase effect in ExamTaker below.
const REVIEW_WINDOW_MS = 2 * 60_000

export const TRUE_FALSE_NG_CHOICES = ['True', 'False', 'Not Given']

// New question types — added 2026-09-26 alongside the teacher-side editor
// in TeacherMockCenter.jsx (see that file's QUESTION_TYPE_LABELS comment
// for the full taxonomy this maps to). Kept as small standalone consts
// here rather than importing from the teacher file, since this component
// is the student-facing side and the two don't otherwise share code.
export const YES_NO_NG_CHOICES = ['Yes', 'No', 'Not Given']

// Mirrors TeacherMockCenter.jsx's MULTI_SELECT_SEPARATOR /
// canonicalizeMultiSelect exactly — this is the half of that contract
// that runs on the student's submitted answer. The teacher's
// correct_answer is always every correct choice joined by this
// separator IN AUTHORED ORDER, so the student's submission has to be
// canonicalized the same way (by that question's own options.choices
// order, not click order) for the exact-string-match grading RPC to
// ever award multi_select points correctly.
const MULTI_SELECT_SEPARATOR = ', '

function canonicalizeMultiSelect(selectedChoices, allChoices) {
  return allChoices.filter((c) => selectedChoices.includes(c)).join(MULTI_SELECT_SEPARATOR)
}

// Randomized question bank — added 2026-09-25, RETIRED 2026-09-26.
// Was scoped with Jasur as "just shuffle": a toggle on the exam
// ("Randomize questions from bank") plus an optional "questions per
// section" count, drawing a random subset in random order from a
// larger authored pool per section. Removed from the UI for both
// modules (Listening's was already gone; Reading's went with it here)
// once Jasur pointed out a passage's questions are written to match
// that specific passage — shuffling breaks that. buildAttemptQuestions
// below is kept as a stable no-op (old rows may still have
// randomize_questions set) rather than deleted outright, so nothing
// upstream that still passes an exam through it needs to change.
export function buildAttemptQuestions(allQuestionsForSection, exam) {
  // Randomizing was tried for both modules and retired for both.
  // Listening never worked with it (one fixed audio track narrates in
  // a set order — shuffling or drawing a subset would desync what's on
  // screen from what's playing), and Jasur flagged 2026-09-26 that
  // Reading has the same problem for a different reason: a passage's
  // questions are written to match that specific passage (e.g.
  // "Questions 14-20 refer to paragraph C"), so shuffling their order
  // or dropping some breaks that correspondence. So this is now a
  // permanent no-op — every section's questions are always returned as
  // authored, in order, regardless of what any row's
  // randomize_questions/questions_per_section columns say (old data
  // from before this guard, or before the UI to set it was removed
  // entirely).
  return allQuestionsForSection
}

export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MockExams({ selfId }) {
  const [exams, setExams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeExam, setActiveExam] = useState(null)

  useEffect(() => {
    let active = true

    const loadExams = async () => {
      setLoading(true)
      setError('')

      const { data, error: examsError } = await supabase
        .from('mock_exams')
        .select('*')
        .eq('is_active', true)
        .order('module', { ascending: true })
        .order('sort_order', { ascending: true })

      if (!active) return

      if (examsError) {
        setError(examsError.message || 'Could not load mock exams.')
        setLoading(false)
        return
      }

      setExams(data || [])
      setLoading(false)
    }

    loadExams()

    return () => {
      active = false
    }
  }, [])

  const byModule = useMemo(() => {
    const grouped = { reading: [], listening: [] }
    exams.forEach((exam) => {
      if (grouped[exam.module]) grouped[exam.module].push(exam)
    })
    return grouped
  }, [exams])

  const openExam = async (exam) => {
    setError('')

    const { data: sections, error: sectionsError } = await supabase
      .from('mock_sections')
      .select('*')
      .eq('exam_id', exam.id)
      .order('order_index', { ascending: true })

    if (sectionsError) {
      setError(sectionsError.message || 'Could not load this exam.')
      return
    }

    const sectionIds = (sections || []).map((s) => s.id)

    const { data: questions, error: questionsError } = await supabase
      .from('mock_questions_public')
      .select('*')
      .in('section_id', sectionIds.length ? sectionIds : ['00000000-0000-0000-0000-000000000000'])
      .order('order_index', { ascending: true })

    if (questionsError) {
      setError(questionsError.message || 'Could not load this exam.')
      return
    }

    setActiveExam({
      exam,
      sections: (sections || []).map((s) => ({
        ...s,
        questions: buildAttemptQuestions((questions || []).filter((q) => q.section_id === s.id), exam),
      })),
    })
  }

  if (activeExam) {
    return (
      <ExamTaker
        selfId={selfId}
        exam={activeExam.exam}
        sections={activeExam.sections}
        onExit={() => setActiveExam(null)}
      />
    )
  }

  return (
    <div className="ticket rounded-2xl p-5 sm:p-6 flex flex-col gap-5">

      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
          Full mock exams
        </div>

        <h2 className="font-display text-2xl sm:text-3xl mt-1">
          Mock Exams
        </h2>

        <p className="text-sm text-mist mt-1.5 max-w-md">
          Sit a full, timed exam under real IELTS conditions — timed, can't
          pause, scored instantly the moment you submit.
        </p>
      </div>

      <div className="border-t border-line pt-4">

        {loading && (
          <p className="text-sm text-mist">Loading exams…</p>
        )}

        {!loading && error && (
          <p className="text-sm text-coral">{error}</p>
        )}

        {!loading && !error && exams.length === 0 && (
          <p className="text-sm text-mist">
            No mock exams published yet — check back soon.
          </p>
        )}

        {!loading && !error && exams.length > 0 && (
          <div className="flex flex-col gap-6">
            {['reading', 'listening'].map((mod) =>
              byModule[mod].length === 0 ? null : (
                <div key={mod}>
                  <div className="mb-2.5 flex items-baseline gap-2.5">
                    <h3 className="font-display text-base text-paper">
                      {MODULE_LABEL[mod]}
                    </h3>
                    <span className="text-xs text-mist">{MODULE_BLURB[mod]}</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {byModule[mod].map((exam) => (
                      <button
                        key={exam.id}
                        type="button"
                        onClick={() => openExam(exam)}
                        className="focus-ring group flex flex-col justify-between rounded-xl border border-line bg-panel-2 p-4 text-left transition hover:border-brass/40 hover:bg-panel"
                      >
                        <div>
                          <span className="inline-flex items-center rounded-full bg-brass/15 px-2.5 py-1 text-[11px] font-semibold capitalize text-brass">
                            {mod}
                          </span>
                          <p className="mt-2.5 font-display text-sm text-paper">
                            {exam.title}
                          </p>
                        </div>
                        <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brass group-hover:text-brass-dim">
                          Start test <span aria-hidden>→</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        )}

      </div>

    </div>
  )
}

export function ExamTaker({
  selfId,
  exam,
  sections,
  onExit,
  ctaLabel = 'Back to exams',
  onAttemptStarted,
  onSubmitted,
}) {
  const [phase, setPhase] = useState('starting')
  const [attemptId, setAttemptId] = useState(null)
  const [error, setError] = useState(null)
  const [answers, setAnswers] = useState({})
  const [deadline, setDeadline] = useState(null)
  const [remainingMs, setRemainingMs] = useState(0)
  const [result, setResult] = useState(null)

  // ------------------------------------------------------------------
  // Question navigator + flag-for-review — numbers run CONTINUOUSLY
  // across every section (1..40), matching the real test, instead of
  // resetting to 1 at the top of each section/passage the way the old
  // per-section `qIdx + 1` did.
  // ------------------------------------------------------------------
  const flatQuestions = useMemo(() => sections.flatMap((s) => s.questions), [sections])
  const questionIndexById = useMemo(() => {
    const map = {}
    flatQuestions.forEach((q, i) => {
      map[q.id] = i + 1
    })
    return map
  }, [flatQuestions])

  const [flags, setFlags] = useState(() => new Set())

  const toggleFlag = (questionId) => {
    setFlags((prev) => {
      const next = new Set(prev)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  }

  const jumpToQuestion = (questionId) => {
    document.getElementById(`q-${questionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // ------------------------------------------------------------------
  // Reading highlight + notes — in-memory only for this sitting (never
  // persisted; this app has never autosaved Reading/Listening answers
  // either, and there's nowhere on `mock_sections` to save it back to
  // anyway). Keyed by section id, each entry {id, start, end, note}.
  // ------------------------------------------------------------------
  const [highlightsBySection, setHighlightsBySection] = useState({})

  const addHighlight = (sectionId, range) => {
    setHighlightsBySection((prev) => {
      const existing = prev[sectionId] || []
      // Keep it simple for v1: reject a selection that overlaps an
      // already-highlighted range rather than merging/splitting them.
      const overlaps = existing.some((h) => range.start < h.end && range.end > h.start)
      if (overlaps) return prev
      return { ...prev, [sectionId]: [...existing, { id: range.id, start: range.start, end: range.end, note: '' }] }
    })
  }

  const updateHighlightNote = (sectionId, highlightId, note) => {
    setHighlightsBySection((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).map((h) => (h.id === highlightId ? { ...h, note } : h)),
    }))
  }

  const removeHighlight = (sectionId, highlightId) => {
    setHighlightsBySection((prev) => ({
      ...prev,
      [sectionId]: (prev[sectionId] || []).filter((h) => h.id !== highlightId),
    }))
  }

  // ------------------------------------------------------------------
  // Listening-only: track which sections' audio has played all the way
  // through, so the 2-minute review window (below) knows when to start.
  // ------------------------------------------------------------------
  const [audioEndedBySection, setAudioEndedBySection] = useState({})
  const [reviewPhase, setReviewPhase] = useState(false)

  const handleAudioEnded = (sectionId) => {
    setAudioEndedBySection((prev) => (prev[sectionId] ? prev : { ...prev, [sectionId]: true }))
  }

  // ------------------------------------------------------------------
  // Momentary flash messages — the real exam's timer "flashes" at 10
  // and 5 minutes remaining, and again once the review window opens.
  // announcedRef makes sure each one only fires once per attempt.
  // ------------------------------------------------------------------
  const [flashMessage, setFlashMessage] = useState('')
  const announcedRef = useRef(new Set())

  useEffect(() => {
    if (!flashMessage) return
    const t = setTimeout(() => setFlashMessage(''), 4500)
    return () => clearTimeout(t)
  }, [flashMessage])

  // ------------------------------------------------------------------
  // Quiet tab-switch integrity log — same convention as
  // WritingMockTest.jsx/WritingMockExam.jsx: window blur AND tab
  // visibility both feed one shared "away" flag so a single switch is
  // counted once, not twice. Deliberately NOT the real Fullscreen API,
  // for the same reason those two files already settled on this —
  // most browsers force-exit fullscreen on a tab switch anyway, which
  // would make the window look like it closed. Never shown to or
  // enforced against the student; saved quietly for a teacher to see
  // as context later (migration_47 adds the column this writes to).
  // ------------------------------------------------------------------
  const tabSwitchCountRef = useRef(0)

  useEffect(() => {
    if (phase !== 'in-progress') return

    let away = false
    const markAway = () => {
      if (!away) {
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
  }, [phase])

  // Cheap periodic save so the count survives a crash/refresh even if
  // the student never reaches a normal submit — mirrors how Writing's
  // own autosave keeps tab_switch_count current throughout, not just
  // at the very end.
  useEffect(() => {
    if (phase !== 'in-progress' || !attemptId) return
    const id = setInterval(() => {
      supabase
        .from('mock_attempts')
        .update({ tab_switch_count: tabSwitchCountRef.current })
        .eq('id', attemptId)
        .then(({ error: saveError }) => {
          if (saveError) console.error('Could not save integrity log:', saveError)
        })
    }, 30_000)
    return () => clearInterval(id)
  }, [phase, attemptId])

  const totalQuestions = useMemo(
    () => sections.reduce((n, s) => n + s.questions.length, 0),
    [sections]
  )

  const answeredCount = Object.values(answers).filter((v) => v.trim() !== '').length

  // Start the attempt as soon as the student opens the test, so
  // started_at reflects when they actually began rather than when they
  // submit — same as the standalone app.
  useEffect(() => {
    let cancelled = false

    const start = async () => {
      const { data, error: startError } = await supabase
        .from('mock_attempts')
        .insert({ exam_id: exam.id, user_id: selfId })
        .select('id')
        .single()

      if (cancelled) return

      if (startError) {
        setError(startError.message)
        setPhase('error')
        return
      }

      setAttemptId(data.id)
      setDeadline(Date.now() + TIME_LIMIT_MINUTES[exam.module] * 60_000)
      setPhase('in-progress')
      onAttemptStarted?.(data.id)
    }

    start()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id])

  useEffect(() => {
    if (phase !== 'in-progress' || !deadline) return

    const tick = () => {
      const left = deadline - Date.now()
      setRemainingMs(Math.max(0, left))
      if (left <= 0) {
        handleSubmit(true)
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, deadline])

  // Flash the 10-minute / 5-minute warnings, exactly once each, per the
  // real computer-delivered test's own "timer flashes at 10 and 5
  // minutes remaining" behavior (confirmed during the cdielts.gelielts.com
  // research pass). Skipped once in review phase — that window is only
  // ever 2 minutes long to begin with, so it's already "critical".
  useEffect(() => {
    if (phase !== 'in-progress' || reviewPhase) return
    ;[10, 5].forEach((mark) => {
      const key = `warn-${mark}`
      if (remainingMs > 0 && remainingMs <= mark * 60_000 && !announcedRef.current.has(key)) {
        announcedRef.current.add(key)
        setFlashMessage(`${mark} minute${mark === 1 ? '' : 's'} remaining`)
      }
    })
  }, [remainingMs, phase, reviewPhase])

  // ------------------------------------------------------------------
  // The 2-minute Listening review window. Once every section that has
  // audio has played it through to the end, this OVERWRITES `deadline`
  // with a fresh 2-minute one — a fixed allowance for reviewing answers
  // with no more audio playing, same as the real test, rather than
  // whatever happened to be left of the app's own 40-minute budget.
  // That's deliberate even if it means granting a little more time than
  // the flat 40-minute figure would otherwise leave: the real exam's
  // pacing is driven by the audio, not by an arbitrary app-side clock.
  // ------------------------------------------------------------------
  useEffect(() => {
    if (exam.module !== 'listening' || phase !== 'in-progress' || reviewPhase) return
    const sectionsWithAudio = sections.filter((s) => s.audio_url)
    if (sectionsWithAudio.length === 0) return
    const allDone = sectionsWithAudio.every((s) => audioEndedBySection[s.id])
    if (!allDone) return

    setReviewPhase(true)
    setDeadline(Date.now() + REVIEW_WINDOW_MS)
    setFlashMessage('Audio finished — 2 minutes to review your answers')
  }, [audioEndedBySection, exam.module, phase, reviewPhase, sections])

  const setAnswer = (questionId, value) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  const handleSubmit = async (auto = false) => {
    if (!attemptId || phase === 'submitting' || phase === 'done') return

    if (!auto && answeredCount < totalQuestions) {
      const ok = window.confirm(
        `You've answered ${answeredCount} of ${totalQuestions} questions. Submit anyway?`
      )
      if (!ok) return
    }

    setPhase('submitting')

    // Save the integrity log one last time alongside the real submit —
    // best-effort, a failure here shouldn't block the actual grading.
    const { error: logError } = await supabase
      .from('mock_attempts')
      .update({ tab_switch_count: tabSwitchCountRef.current })
      .eq('id', attemptId)
    if (logError) console.error('Could not save integrity log:', logError)

    const payload = sections.flatMap((s) =>
      s.questions.map((q) => ({ question_id: q.id, answer: answers[q.id] ?? '' }))
    )

    const { data, error: submitError } = await supabase.rpc('submit_mock_attempt', {
      p_attempt_id: attemptId,
      p_answers: payload,
    })

    if (submitError) {
      setError(submitError.message)
      setPhase('error')
      return
    }

    const row = Array.isArray(data) ? data[0] : data
    const finalResult = { score: row?.score ?? 0, maxScore: row?.max_score ?? 0 }
    setResult(finalResult)
    setPhase('done')
    onSubmitted?.(finalResult)
  }

  if (phase === 'starting') {
    return (
      <div className="ticket rounded-2xl p-8 text-center">
        <p className="text-sm text-mist">Starting your attempt…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="ticket rounded-2xl p-8 text-center">
        <p className="font-display text-lg text-paper">Something went wrong</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-coral">{error}</p>
        <button
          type="button"
          onClick={onExit}
          className="focus-ring mt-5 inline-block rounded-full bg-panel-2 px-5 py-2 text-sm font-medium text-mist hover:text-paper"
        >
          {ctaLabel}
        </button>
      </div>
    )
  }

  if (phase === 'done' && result) {
    const pct = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0

    return (
      <div className="flex flex-col gap-5">
        <div className="ticket rounded-2xl p-8 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-brass">
            Test submitted
          </span>
          <p className="mt-2 font-display text-4xl text-paper">
            {result.score}
            <span className="text-lg font-medium text-mist"> / {result.maxScore}</span>
          </p>
          <p className="mt-1 text-sm text-mist">{pct}% correct</p>
          <button
            type="button"
            onClick={onExit}
            className="focus-ring mt-6 inline-block rounded-full bg-brass px-6 py-2.5 text-sm font-bold text-onbrass shadow-sm transition-transform hover:scale-105"
          >
            {ctaLabel}
          </button>
        </div>

        {exam.module === 'listening' && (
          <div className="ticket rounded-2xl p-6">
            <p className="font-display text-base text-paper">Transcripts</p>
            <p className="mt-1 text-xs text-mist">For review now that the test is over.</p>
            <div className="mt-4 flex flex-col gap-4">
              {sections.map((s, i) => (
                <details key={s.id} className="rounded-xl border border-line bg-panel-2 p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-paper">
                    {s.title || `Section ${i + 1}`}
                  </summary>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-mist">
                    {s.passage_text || 'No transcript available.'}
                  </p>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const timerLevel = reviewPhase || remainingMs <= 5 * 60_000
    ? 'critical'
    : remainingMs <= 10 * 60_000
      ? 'warning'
      : 'normal'
  const timerClass =
    timerLevel === 'critical'
      ? 'text-coral animate-pulse'
      : timerLevel === 'warning'
        ? 'text-amber'
        : 'text-onbrass'

  return (
    <div className="flex flex-col gap-5 pb-10">
      {flashMessage && (
        <div className="fixed top-20 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink/95 px-4 py-2 text-sm font-semibold text-paper shadow-lg animate-pulse">
          ⏱ {flashMessage}
        </div>
      )}

      <div className="sticky top-3 z-10 flex flex-col gap-2.5 rounded-2xl bg-brass px-5 py-3.5 text-onbrass shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-onbrass/70">
              {reviewPhase ? 'Review time' : exam.module}
            </p>
            <p className="font-display text-sm font-bold leading-tight">{exam.title}</p>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-onbrass/70">
              {answeredCount}/{totalQuestions} answered
            </span>
            <span className={`font-display text-lg font-bold tabular-nums ${timerClass}`}>
              {formatClock(remainingMs)}
            </span>
            <button
              type="button"
              onClick={() => handleSubmit(false)}
              disabled={phase === 'submitting'}
              className="focus-ring rounded-full bg-onbrass px-4 py-1.5 text-xs font-bold text-brass shadow-sm disabled:opacity-60"
            >
              {phase === 'submitting' ? 'Submitting…' : 'Submit test'}
            </button>
          </div>
        </div>

        {flatQuestions.length > 0 && (
          <QuestionNavigator
            questions={flatQuestions}
            answers={answers}
            flags={flags}
            onJump={jumpToQuestion}
          />
        )}

        {reviewPhase && (
          <p className="text-[11px] font-medium text-onbrass/85">
            All audio has finished — no more will play. You have 2 minutes to review your
            answers before this submits automatically.
          </p>
        )}
      </div>

      {sections.map((section, sIdx) => (
        <div key={section.id} className="ticket rounded-2xl p-5 sm:p-6">
          <p className="mb-3 font-display text-base text-paper">
            {section.title ||
              `${exam.module === 'reading' ? 'Passage' : 'Section'} ${sIdx + 1}`}
          </p>

          {exam.module === 'reading' && section.passage_text && (
            <div className="mb-5">
              <HighlightablePassage
                text={section.passage_text}
                highlights={highlightsBySection[section.id] || []}
                onAdd={(range) => addHighlight(section.id, range)}
                onUpdateNote={(id, note) => updateHighlightNote(section.id, id, note)}
                onRemove={(id) => removeHighlight(section.id, id)}
              />
            </div>
          )}

          {exam.module === 'listening' && section.audio_url && (
            <div className="mb-5">
              <SectionAudioPlayer
                url={section.audio_url}
                onEnded={() => handleAudioEnded(section.id)}
              />
            </div>
          )}

          <div className="flex flex-col gap-4">
            {section.questions.map((q) => (
              <QuestionBlock
                key={q.id}
                index={questionIndexById[q.id]}
                question={q}
                value={answers[q.id] ?? ''}
                onChange={(v) => setAnswer(q.id, v)}
                flagged={flags.has(q.id)}
                onToggleFlag={() => toggleFlag(q.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Numbered chips the student can click to jump straight to any
// question — answered ones fill in, an unanswered one stays hollow, and
// a flagged one (regardless of answered state) gets a small coral dot,
// mirroring the real test's own flag-for-review navigator.
function QuestionNavigator({ questions, answers, flags, onJump }) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
      {questions.map((q, i) => {
        const answered = Boolean((answers[q.id] ?? '').trim())
        const flagged = flags.has(q.id)
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onJump(q.id)}
            title={flagged ? `Question ${i + 1} — flagged for review` : `Question ${i + 1}`}
            className={`focus-ring relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold transition-colors ${
              answered
                ? 'bg-onbrass text-brass'
                : 'bg-onbrass/20 text-onbrass/80 hover:bg-onbrass/35'
            }`}
          >
            {i + 1}
            {flagged && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-brass bg-coral" />
            )}
          </button>
        )
      })}
    </div>
  )
}

// Single-playback audio — plays once, start to finish, with a volume
// slider but no scrub bar (no native `controls`, so there's no drag
// handle to seek with, and the context menu is blocked so a browser's
// own "show controls" option can't reopen one either). Matches the
// real test's "audio plays once" rule instead of the old plain
// `<audio controls>` element, which let a student scrub back and
// replay freely.
function SectionAudioPlayer({ url, onEnded }) {
  const audioRef = useRef(null)
  const [status, setStatus] = useState('ready') // ready | playing | done
  const [volume, setVolume] = useState(1)
  const [progressPct, setProgressPct] = useState(0)

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  const handlePlay = () => {
    if (status !== 'ready') return
    setStatus('playing')
    audioRef.current?.play()
  }

  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    setProgressPct(Math.min(100, (audio.currentTime / audio.duration) * 100))
  }

  const handleEnded = () => {
    setProgressPct(100)
    setStatus('done')
    onEnded?.()
  }

  return (
    <div className="rounded-xl border border-line bg-panel-2 p-4">
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onContextMenu={(e) => e.preventDefault()}
        controlsList="nodownload noplaybackrate nofullscreen"
        className="hidden"
      />

      <div className="flex items-center gap-3">
        {status === 'ready' ? (
          <button
            type="button"
            onClick={handlePlay}
            className="focus-ring shrink-0 rounded-full bg-brass px-4 py-1.5 text-xs font-bold text-onbrass shadow-sm hover:bg-brass-dim"
          >
            ▶ Play audio
          </button>
        ) : (
          <>
            <span className="w-14 shrink-0 text-[11px] font-semibold text-mist">
              {status === 'playing' ? 'Playing…' : 'Played'}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
              <div
                className="h-full rounded-full bg-brass transition-[width]"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-mist" aria-hidden>🔊</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-16 accent-brass"
            aria-label="Volume"
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] text-mist">
        {status === 'ready'
          ? 'Plays once, start to finish — no pausing or rewinding, just like the real test.'
          : 'The transcript will be available for review after you submit.'}
      </p>
    </div>
  )
}

// Select text in the passage to highlight it, or attach a short note —
// the real exam's own highlighter/notes tool. Ranges are plain
// character offsets into the passage text (computed via a Range from
// the start of the container, a standard DOM technique that works
// regardless of how many spans the text is broken into for rendering),
// so this works with no contenteditable and no external library.
// Deliberately simple for v1: an overlapping selection is rejected
// rather than merged/split — good enough for what a real passage
// actually needs, and a lot less code to get wrong.
function HighlightablePassage({ text, highlights, onAdd, onUpdateNote, onRemove }) {
  const containerRef = useRef(null)
  const [toolbar, setToolbar] = useState(null) // { start, end, rect }
  const [openNoteFor, setOpenNoteFor] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')

  const getSelectionOffsets = () => {
    const container = containerRef.current
    const selection = window.getSelection()
    if (!container || !selection || selection.rangeCount === 0) return null

    const range = selection.getRangeAt(0)
    if (range.collapsed || !container.contains(range.commonAncestorContainer)) return null

    const preRange = document.createRange()
    preRange.selectNodeContents(container)
    preRange.setEnd(range.startContainer, range.startOffset)
    const start = preRange.toString().length
    const end = start + range.toString().length
    if (end <= start) return null

    return { start, end, rect: range.getBoundingClientRect() }
  }

  const handleMouseUp = () => {
    setToolbar(getSelectionOffsets())
  }

  useEffect(() => {
    if (!toolbar) return
    const onDown = (e) => {
      if (containerRef.current?.contains(e.target)) return
      setToolbar(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [toolbar])

  const handleHighlight = () => {
    if (!toolbar) return
    onAdd({ id: crypto.randomUUID(), start: toolbar.start, end: toolbar.end })
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
  }

  const handleAddNote = () => {
    if (!toolbar) return
    const id = crypto.randomUUID()
    onAdd({ id, start: toolbar.start, end: toolbar.end })
    setToolbar(null)
    window.getSelection()?.removeAllRanges()
    setNoteDraft('')
    setOpenNoteFor(id)
  }

  const segments = useMemo(() => {
    const sorted = [...highlights].sort((a, b) => a.start - b.start)
    const out = []
    let cursor = 0
    sorted.forEach((h) => {
      if (h.start > cursor) out.push({ key: `t${cursor}`, plain: text.slice(cursor, h.start) })
      out.push({ key: `h${h.id}`, highlight: h, plain: text.slice(h.start, h.end) })
      cursor = Math.max(cursor, h.end)
    })
    if (cursor < text.length) out.push({ key: `t${cursor}`, plain: text.slice(cursor) })
    return out
  }, [text, highlights])

  return (
    <div className="relative">
      <div
        ref={containerRef}
        onMouseUp={handleMouseUp}
        className="max-h-72 overflow-y-auto rounded-xl border border-line bg-panel-2 p-4 text-sm leading-relaxed text-paper whitespace-pre-wrap"
      >
        {segments.map((seg) =>
          seg.highlight ? (
            <mark
              key={seg.key}
              onClick={(e) => {
                e.stopPropagation()
                setNoteDraft(seg.highlight.note || '')
                setOpenNoteFor(seg.highlight.id)
              }}
              title={seg.highlight.note ? `Note: ${seg.highlight.note}` : 'Click to add a note or remove'}
              className="cursor-pointer rounded bg-amber/35 px-0.5"
            >
              {seg.plain}
            </mark>
          ) : (
            <span key={seg.key}>{seg.plain}</span>
          )
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-mist">
        Select any text above to highlight it or attach a note.
      </p>

      {toolbar && (
        <div
          style={{ position: 'fixed', left: Math.max(8, toolbar.rect.left), top: Math.max(8, toolbar.rect.top - 46) }}
          className="z-30 flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-1.5 shadow-lg"
        >
          <button
            type="button"
            onClick={handleHighlight}
            className="focus-ring rounded-full bg-amber/20 px-3 py-1 text-xs font-semibold text-amber hover:bg-amber/30"
          >
            🖊 Highlight
          </button>
          <button
            type="button"
            onClick={handleAddNote}
            className="focus-ring rounded-full bg-panel-2 px-3 py-1 text-xs font-semibold text-paper-dim hover:text-paper"
          >
            📝 Note
          </button>
        </div>
      )}

      {openNoteFor && (
        <div className="absolute z-30 mt-2 w-64 rounded-xl border border-line bg-panel p-3 shadow-lg">
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-mist font-mono">Note</p>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={3}
            placeholder="Jot a note about this…"
            className="focus-ring w-full resize-none rounded-lg border border-line bg-panel-2 px-2.5 py-2 text-xs text-paper"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onRemove(openNoteFor)
                setOpenNoteFor(null)
              }}
              className="focus-ring rounded-full border border-coral/30 px-3 py-1 text-[11px] font-semibold text-coral hover:bg-coral/10"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => {
                onUpdateNote(openNoteFor, noteDraft)
                setOpenNoteFor(null)
              }}
              className="focus-ring rounded-full bg-brass px-3 py-1 text-[11px] font-bold text-onbrass"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function QuestionBlock({ index, question, value, onChange, flagged = false, onToggleFlag }) {
  return (
    <div id={`q-${question.id}`} className="border-t border-line pt-4 first:border-0 first:pt-0 scroll-mt-40">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-paper">
          <span className="mr-1.5 text-mist">{index}.</span>
          {question.prompt}
        </p>
        {onToggleFlag && (
          <button
            type="button"
            onClick={onToggleFlag}
            title={flagged ? 'Remove flag' : 'Flag for review'}
            className={`focus-ring shrink-0 rounded-full px-2 py-1 text-xs transition-colors ${
              flagged ? 'bg-coral/15 text-coral' : 'text-mist hover:text-coral'
            }`}
          >
            🚩
          </button>
        )}
      </div>

      {question.type === 'multiple_choice' && (
        <div className="flex flex-col gap-2">
          {(question.options?.choices ?? []).map((choice) => (
            <label
              key={choice}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-mist hover:border-brass/30'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice}
                onChange={() => onChange(choice)}
                className="accent-brass"
              />
              {choice}
            </label>
          ))}
        </div>
      )}

      {question.type === 'true_false_ng' && (
        <div className="flex flex-wrap gap-2">
          {TRUE_FALSE_NG_CHOICES.map((choice) => (
            <label
              key={choice}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-mist hover:border-brass/30'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice}
                onChange={() => onChange(choice)}
                className="accent-brass"
              />
              {choice}
            </label>
          ))}
        </div>
      )}

      {question.type === 'yes_no_ng' && (
        <div className="flex flex-wrap gap-2">
          {YES_NO_NG_CHOICES.map((choice) => (
            <label
              key={choice}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition-colors ${
                value === choice
                  ? 'border-brass/40 bg-brass/10 text-paper'
                  : 'border-line bg-panel text-mist hover:border-brass/30'
              }`}
            >
              <input
                type="radio"
                name={question.id}
                checked={value === choice}
                onChange={() => onChange(choice)}
                className="accent-brass"
              />
              {choice}
            </label>
          ))}
        </div>
      )}

      {question.type === 'multi_select' && (
        <MultiSelectQuestion
          question={question}
          value={value}
          onChange={onChange}
        />
      )}

      {question.type === 'matching' && (
        <MatchingQuestion
          question={question}
          value={value}
          onChange={onChange}
        />
      )}

      {question.type === 'short_answer' && (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer"
          className="focus-ring w-full max-w-sm rounded-xl border border-line bg-panel px-3.5 py-2 text-sm text-paper"
        />
      )}
    </div>
  )
}

// choose MORE THAN ONE from a list. `value` is the canonical
// comma-joined string (see canonicalizeMultiSelect above) — this
// component only ever writes that same canonical form back out, never
// a raw click-order join, so grading stays exact-match-safe.
function MultiSelectQuestion({ question, value, onChange }) {
  const choices = question.options?.choices ?? []
  const selected = value ? value.split(MULTI_SELECT_SEPARATOR).map((s) => s.trim()) : []

  const toggle = (choice) => {
    const next = selected.includes(choice)
      ? selected.filter((c) => c !== choice)
      : [...selected, choice]
    onChange(canonicalizeMultiSelect(next, choices))
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-mist -mt-1 mb-0.5">Choose every answer that applies.</p>
      {choices.map((choice) => {
        const checked = selected.includes(choice)
        return (
          <label
            key={choice}
            className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2 text-sm transition-colors ${
              checked
                ? 'border-brass/40 bg-brass/10 text-paper'
                : 'border-line bg-panel text-mist hover:border-brass/30'
            }`}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(choice)}
              className="accent-brass"
            />
            {choice}
          </label>
        )
      })}
    </div>
  )
}

// match a statement/heading/paragraph-ref/name to one item from a bank
// of options — the same single-pick data shape as multiple_choice
// (one options.choices bank, one correct_answer), but given the drag-
// and-drop interaction Jasur specifically asked for. Dragging a chip
// into the drop target (or just clicking a chip — kept as a fallback
// for touch/mobile, where HTML5 drag-and-drop doesn't work) both set
// the same single answer; dragging/clicking a different chip replaces
// it, same as picking a different radio would.
function MatchingQuestion({ question, value, onChange }) {
  const choices = question.options?.choices ?? []
  const [dragOver, setDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const choice = e.dataTransfer.getData('text/plain')
    if (choice) onChange(choice)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`flex min-h-[2.75rem] items-center rounded-xl border-2 border-dashed px-3.5 py-2 text-sm transition-colors ${
          dragOver
            ? 'border-brass bg-brass/10 text-paper'
            : value
              ? 'border-brass/40 bg-brass/5 text-paper'
              : 'border-line bg-panel text-mist'
        }`}
      >
        {value || 'Drag an option here, or tap one below'}
      </div>

      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', choice)}
            onClick={() => onChange(choice)}
            className={`focus-ring cursor-grab rounded-full border px-3.5 py-1.5 text-sm transition-colors active:cursor-grabbing ${
              value === choice
                ? 'border-brass/40 bg-brass/10 text-paper'
                : 'border-line bg-panel text-mist hover:border-brass/30'
            }`}
          >
            {choice}
          </button>
        ))}
      </div>
    </div>
  )
}
