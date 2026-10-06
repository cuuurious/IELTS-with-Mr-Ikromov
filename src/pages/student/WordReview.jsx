import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { QuizRunner, ResultsPanel, buildMixedQuestions } from './wordPractice'

/*
 * DAILY WORD REVIEW (2026-10-02) — spaced repetition.
 *
 * Every answer a student gives in any word-list quiz now moves that word
 * through 6 "boxes" (word_progress, migration_69):
 *   box 0 → again today, 1 → tomorrow, 2 → 3 days, 3 → a week,
 *   4 → two weeks, 5 → a month.
 * Right answer = one box up, wrong answer = back to box 0.
 *
 * This screen asks the words that are due today — the weakest first —
 * at most 20 per session, so it's a 3-minute daily habit instead of
 * redoing whole lists. Results are saved with record_word_review().
 *
 * 2026-10-06: uses the shared word-practice test (wordPractice.jsx) —
 * mixed question kinds, feedback with the example, a second chance for
 * missed words (only the first try moves the word between boxes),
 * streaks and an animated result.
 */

export const REVIEW_SESSION_SIZE = 20

export default function WordReview({ studentId, wordlistIds, onExit }) {
  const [status, setStatus] = useState('loading') // loading | empty | quiz | saving | done | error
  const [questions, setQuestions] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data: due, error: dueError } = await supabase
          .from('word_progress')
          .select('item_id, wordlist_id, box, due_at')
          .eq('student_id', studentId)
          .in('wordlist_id', wordlistIds)
          .lte('due_at', new Date().toISOString())
          .order('box', { ascending: true })
          .order('due_at', { ascending: true })
          .limit(REVIEW_SESSION_SIZE)
        if (dueError) throw dueError
        if (!due?.length) {
          if (!cancelled) setStatus('empty')
          return
        }
        const listIds = [...new Set(due.map((r) => r.wordlist_id))]
        const { data: items, error: itemsError } = await supabase
          .from('wordlist_items')
          .select('id, wordlist_id, word, definition, uzbek_translation, example_sentence')
          .in('wordlist_id', listIds)
        if (itemsError) throw itemsError
        const dueIds = new Set(due.map((r) => r.item_id))
        const qs = buildMixedQuestions((items || []).filter((it) => dueIds.has(it.id)), items || [])
        if (cancelled) return
        if (!qs.length) {
          setStatus('empty')
          return
        }
        setQuestions(qs)
        setStatus('quiz')
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Could not load your review.')
          setStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  const save = async (detail) => {
    setStatus('saving')
    setSaveFailed(false)
    const { error: saveError } = await supabase.rpc('record_word_review', {
      p_results: detail.map((a) => ({ item_id: a.itemId, correct: a.isCorrect })),
    })
    if (saveError) {
      setError(saveError.message || 'Could not save your review.')
      setSaveFailed(true)
    }
    setStatus('done')
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onExit} className="focus-ring text-sm text-mist hover:text-paper">
        ← Back to word lists
      </button>
      <span className="rounded-full bg-vocab-tint px-2.5 py-1 text-xs font-semibold text-vocab">Daily review</span>
    </div>
  )

  if (status === 'loading') {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="text-sm text-mist">Picking today’s words…</p>
      </div>
    )
  }

  if (status === 'error' || status === 'empty') {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="rounded-[22px] border border-line bg-panel px-5 py-8 text-center text-sm text-mist">
          {status === 'error' ? error : 'Nothing to review right now — come back tomorrow!'}
        </div>
      </div>
    )
  }

  if ((status === 'done' || status === 'saving') && result) {
    const correct = result.detail.filter((d) => d.isCorrect).length
    return (
      <div className="flex flex-col gap-5">
        {header}
        <ResultsPanel
          detail={result.detail}
          best={result.best}
          title="Today’s review"
          note={
            correct === result.detail.length
              ? 'Perfect! Every word moved up a level.'
              : correct === 0
                ? 'These words will come back again soon.'
                : `${correct} word${correct === 1 ? '' : 's'} moved up. The others come back sooner.`
          }
          saving={status === 'saving'}
          saveFailed={saveFailed}
          onRetrySave={() => save(result.detail)}
          onExit={onExit}
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <QuizRunner
        questions={questions}
        label="Review"
        onFinish={(detail, state) => {
          setResult({ detail, best: state?.best || 0 })
          save(detail)
        }}
      />
    </div>
  )
}
