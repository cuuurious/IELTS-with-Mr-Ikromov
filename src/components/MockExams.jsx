import { useEffect, useMemo, useState } from 'react'
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
 */

const MODULE_LABEL = { reading: 'Reading', listening: 'Listening' }

const MODULE_BLURB = {
  reading: '60 minutes, three passages, timed just like the real test.',
  listening: 'Play the audio once through, answer as you go.',
}

export const TIME_LIMIT_MINUTES = { reading: 60, listening: 40 }

export const TRUE_FALSE_NG_CHOICES = ['True', 'False', 'Not Given']

// Randomized question bank — added 2026-09-25. Scoped with Jasur as
// "just shuffle": no skill/difficulty tagging, a plain toggle on the
// exam ("Randomize questions from bank" in the Content tab's exam
// forms) plus an optional "questions per section" count. A teacher
// authors MORE questions in a section's pool than a student actually
// needs to see; each attempt draws that many at random, in random
// order, from the pool — so repeat test-takers don't just memorize one
// fixed paper. When questionsPerSection is unset, every question in the
// pool is still used, just shuffled into a random order.
//
// This only changes which questions get built into the `sections` array
// passed to <ExamTaker> at attempt-start — submission/scoring
// (submit_mock_attempt, an existing Postgres RPC from the original
// standalone app) is untouched, since it's driven entirely by whatever
// question_id/answer pairs are actually submitted, not by any separate
// count of "all questions in this section".
function shuffleArray(arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function buildAttemptQuestions(allQuestionsForSection, exam) {
  // Listening can't support this even if a row's randomize_questions
  // somehow ended up true (e.g. old data from before this guard) — one
  // fixed audio track narrates in a set order, so shuffling or drawing a
  // random subset would desync what's on screen from what's playing.
  // Reading-only, enforced here regardless of what the UI already does.
  if (exam?.module === 'listening') return allQuestionsForSection
  if (!exam?.randomize_questions) return allQuestionsForSection
  const shuffled = shuffleArray(allQuestionsForSection)
  const count = Number(exam.questions_per_section) || 0
  return count > 0 ? shuffled.slice(0, count) : shuffled
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

  const lowTime = remainingMs < 5 * 60_000

  return (
    <div className="flex flex-col gap-5 pb-10">
      <div className="sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-brass px-5 py-3.5 text-onbrass shadow-md">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-onbrass/70">
            {exam.module}
          </p>
          <p className="font-display text-sm font-bold leading-tight">{exam.title}</p>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-onbrass/70">
            {answeredCount}/{totalQuestions} answered
          </span>
          <span
            className={`font-display text-lg font-bold tabular-nums ${
              lowTime ? 'text-coral' : 'text-onbrass'
            }`}
          >
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

      {sections.map((section, sIdx) => (
        <div key={section.id} className="ticket rounded-2xl p-5 sm:p-6">
          <p className="mb-3 font-display text-base text-paper">
            {section.title ||
              `${exam.module === 'reading' ? 'Passage' : 'Section'} ${sIdx + 1}`}
          </p>

          {exam.module === 'reading' && section.passage_text && (
            <div className="mb-5 max-h-72 overflow-y-auto rounded-xl border border-line bg-panel-2 p-4 text-sm leading-relaxed text-paper whitespace-pre-wrap">
              {section.passage_text}
            </div>
          )}

          {exam.module === 'listening' && section.audio_url && (
            <div className="mb-5 rounded-xl border border-line bg-panel-2 p-4">
              <audio controls preload="none" src={section.audio_url} className="w-full" />
              <p className="mt-2 text-[11px] text-mist">
                The transcript will be available for review after you submit.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {section.questions.map((q, qIdx) => (
              <QuestionBlock
                key={q.id}
                index={qIdx + 1}
                question={q}
                value={answers[q.id] ?? ''}
                onChange={(v) => setAnswer(q.id, v)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function QuestionBlock({ index, question, value, onChange }) {
  return (
    <div className="border-t border-line pt-4 first:border-0 first:pt-0">
      <p className="mb-2.5 text-sm font-medium text-paper">
        <span className="mr-1.5 text-mist">{index}.</span>
        {question.prompt}
      </p>

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
