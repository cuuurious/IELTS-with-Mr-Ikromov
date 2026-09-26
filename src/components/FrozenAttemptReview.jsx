import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/*
 * Frozen real-interface review of a graded attempt — one of the ~15
 * convenience suggestions from the 2026-09-26 brainstorm, folded into
 * "build everything you suggested." The existing mistake breakdown
 * ("View mistakes") already shows a student's wrong answers as a plain
 * list; this instead opens a full-screen, read-only replay styled like
 * the actual exam screen itself — a sticky brass header bar (same
 * bg-brass/text-onbrass token pair ExamTaker's live countdown bar
 * uses), numbered questions grouped by section exactly as they
 * appeared on exam day, each showing the student's answer and whether
 * it was right, with the correct answer revealed only where it wasn't.
 *
 * Deliberately "frozen," not a re-opened live attempt: no timer, no
 * audio replay controls, no editable inputs — every field here is
 * inert, this is a historical record, not a redo. Shared between
 * TeacherMockCenter.jsx (a teacher reviewing any student's attempt,
 * released or not — get_mock_answer_breakdown's own is_teacher()
 * bypass already covers that) and MockTestCenter.jsx (a student
 * reviewing their own attempt, only once it's released — the same RPC
 * enforces that server-side, so this component itself does no
 * authorization of its own).
 *
 * Reuses get_mock_answer_breakdown (migration_50, bugfixed in
 * migration_54) rather than a new RPC — it already returns everything
 * needed (prompt, type, correct/student answers, section grouping, in
 * exam order) for a section-grouped, numbered read-only layout, even
 * though it doesn't carry full answer-choice data for a pixel-exact
 * widget replica of every question type.
 */
export default function FrozenAttemptReview({ attemptId, examTitle, onClose }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setLoading(true)
      setError('')
      const { data, error: rpcError } = await supabase.rpc('get_mock_answer_breakdown', {
        p_attempt_id: attemptId,
      })
      if (cancelled) return
      if (rpcError) {
        setError(rpcError.message || 'Could not load this attempt.')
        setLoading(false)
        return
      }
      setRows(data || [])
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [attemptId])

  // Group into sections, preserving the order the RPC already returns
  // (section_order, question_order) rather than re-sorting — that's the
  // same order the student saw them in on exam day.
  const sections = []
  const sectionByTitle = {}
  rows.forEach((r) => {
    const key = r.section_title || '—'
    if (!sectionByTitle[key]) {
      sectionByTitle[key] = { title: key, questions: [] }
      sections.push(sectionByTitle[key])
    }
    sectionByTitle[key].questions.push(r)
  })

  const totalQuestions = rows.length
  const correctCount = rows.filter((r) => r.is_correct === true).length

  let runningNumber = 0

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-ink text-paper">
      <header className="shrink-0 bg-brass text-onbrass px-4 sm:px-6 py-3 flex items-center justify-between gap-3 shadow-sm">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] font-mono opacity-80">
            Reviewing — read only
          </p>
          <p className="font-display text-lg truncate">{examTitle || 'Mock exam'}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!loading && !error && (
            <span className="text-sm font-mono opacity-90">
              {correctCount}/{totalQuestions} correct
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring flex h-9 w-9 items-center justify-center rounded-full bg-onbrass/15 hover:bg-onbrass/25 transition-colors text-lg"
            aria-label="Close review"
          >
            ×
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 flex flex-col gap-6">
          {loading && <p className="text-sm text-mist text-center py-10">Loading…</p>}
          {error && <p className="text-sm text-coral text-center py-10">{error}</p>}

          {!loading && !error && sections.length === 0 && (
            <p className="text-sm text-mist text-center py-10">
              No answers on record for this attempt.
            </p>
          )}

          {!loading &&
            !error &&
            sections.map((section) => (
              <div key={section.title} className="flex flex-col gap-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-brass font-mono">
                  {section.title}
                </p>

                {section.questions.map((q) => {
                  runningNumber += 1
                  const isCorrect = q.is_correct === true
                  const hasAnswer = q.student_answer != null && q.student_answer !== ''

                  return (
                    <div
                      key={q.question_id}
                      className={`rounded-xl border-l-4 bg-panel px-4 py-3 ${
                        isCorrect ? 'border-l-sage' : 'border-l-coral'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={`shrink-0 mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                            isCorrect ? 'bg-sage/15 text-sage' : 'bg-coral/15 text-coral'
                          }`}
                          aria-hidden
                        >
                          {isCorrect ? '✓' : '✕'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-mist font-mono mb-1">Question {runningNumber}</p>
                          <p className="text-sm text-paper">{q.prompt}</p>

                          <p className="mt-2 text-sm">
                            <span className="text-paper-dim">Your answer: </span>
                            <span className={isCorrect ? 'text-sage' : 'text-coral'}>
                              {hasAnswer ? q.student_answer : '(no answer)'}
                            </span>
                          </p>

                          {!isCorrect && (
                            <p className="mt-0.5 text-sm">
                              <span className="text-paper-dim">Correct answer: </span>
                              <span className="text-sage">{q.correct_answer}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
        </div>
      </main>
    </div>
  )
}
