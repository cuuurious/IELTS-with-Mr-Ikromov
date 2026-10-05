import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

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
 */

export const REVIEW_SESSION_SIZE = 20

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function decodeHtmlEntities(value) {
  if (!value) return ''
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

const meaningOf = (item) => item.definition || item.uzbek_translation || ''
const meaningType = (item) => (item.definition ? 'definition' : 'translation')

function buildReviewQuestions(dueRows, items) {
  const byId = new Map(items.map((it) => [it.id, it]))
  const usable = items.filter((it) => meaningOf(it))

  return dueRows
    .map((row) => {
      const item = byId.get(row.item_id)
      if (!item || !meaningOf(item)) return null
      const correctAnswer = meaningOf(item)
      const type = meaningType(item)
      const others = usable.filter((it) => it.id !== item.id && meaningOf(it) !== correctAnswer)
      // Best distractors: same list + same kind of meaning; widen if needed.
      const tiers = [
        others.filter((it) => it.wordlist_id === item.wordlist_id && meaningType(it) === type),
        others.filter((it) => meaningType(it) === type),
        others,
      ]
      const picked = []
      for (const tier of tiers) {
        for (const it of shuffle(tier)) {
          const m = meaningOf(it)
          if (picked.length < 3 && !picked.includes(m)) picked.push(m)
        }
        if (picked.length >= 3) break
      }
      if (!picked.length) return null
      return {
        itemId: item.id,
        word: item.word,
        box: row.box,
        correctAnswer,
        options: shuffle([correctAnswer, ...picked]),
      }
    })
    .filter(Boolean)
}

export default function WordReview({ studentId, wordlistIds, onExit }) {
  const [status, setStatus] = useState('loading') // loading | empty | quiz | saving | done | error
  const [questions, setQuestions] = useState([])
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answers, setAnswers] = useState([])
  const [error, setError] = useState('')

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
          .select('id, wordlist_id, word, definition, uzbek_translation')
          .in('wordlist_id', listIds)
        if (itemsError) throw itemsError
        const qs = buildReviewQuestions(due, items || [])
        if (cancelled) return
        if (!qs.length) {
          setStatus('empty')
          return
        }
        setQuestions(shuffle(qs))
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

  const finish = async (finalAnswers) => {
    setStatus('saving')
    const { error: saveError } = await supabase.rpc('record_word_review', {
      p_results: finalAnswers.map((a) => ({ item_id: a.itemId, correct: a.isCorrect })),
    })
    if (saveError) {
      setError(saveError.message || 'Could not save your review.')
    }
    setStatus('done')
  }

  const answer = (option) => {
    if (selected) return
    setSelected(option)
    const q = questions[qIndex]
    const next = [...answers, { itemId: q.itemId, word: q.word, correctAnswer: q.correctAnswer, isCorrect: option === q.correctAnswer, box: q.box }]
    setAnswers(next)
    setTimeout(() => {
      if (qIndex + 1 < questions.length) {
        setQIndex((i) => i + 1)
        setSelected(null)
      } else {
        finish(next)
      }
    }, option === q.correctAnswer ? 700 : 1500)
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onExit} className="focus-ring text-sm text-mist hover:text-paper">
        ← Back to word lists
      </button>
      <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-brass">Daily review</span>
    </div>
  )

  if (status === 'loading' || status === 'saving') {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <p className="text-sm text-mist">{status === 'saving' ? 'Saving your progress…' : 'Picking today’s words…'}</p>
      </div>
    )
  }

  if (status === 'error' || status === 'empty') {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="rounded-lg border border-line bg-panel-2 px-5 py-8 text-sm text-mist">
          {status === 'error' ? error : 'Nothing to review right now — come back tomorrow!'}
        </div>
      </div>
    )
  }

  if (status === 'done') {
    const correct = answers.filter((a) => a.isCorrect).length
    const wrong = answers.filter((a) => !a.isCorrect)
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="ticket mx-auto flex w-full max-w-sm flex-col items-center gap-2 rounded-xl p-6 text-center">
          <p className="font-display text-4xl">{correct}/{answers.length}</p>
          <p className="text-sm text-mist">
            {correct === answers.length
              ? 'Perfect! Every word moved up a level.'
              : correct === 0
                ? 'These words will come back again soon — learn them below.'
                : `${correct} word${correct === 1 ? '' : 's'} moved up. The others will come back sooner.`}
          </p>
          {error && <p className="text-xs text-coral">{error}</p>}
        </div>
        {wrong.length > 0 && (
          <div className="mx-auto w-full max-w-sm">
            <p className="mb-2 text-xs font-mono uppercase tracking-[0.18em] text-mist">Learn these</p>
            <ul className="flex flex-col gap-2">
              {wrong.map((a) => (
                <li key={a.itemId} className="rounded-md border border-line bg-panel-2 px-3 py-2 text-sm">
                  <b className="text-paper">{decodeHtmlEntities(a.word)}</b>
                  <span className="text-mist"> — {decodeHtmlEntities(a.correctAnswer)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          type="button"
          onClick={onExit}
          className="focus-ring self-center rounded-full bg-brass hover:bg-brass-dim px-6 py-2.5 text-sm font-semibold text-onbrass"
        >
          Done
        </button>
      </div>
    )
  }

  const q = questions[qIndex]
  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="flex flex-col items-center gap-4">
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-panel-2">
          <div className="h-full bg-brass transition-all" style={{ width: `${(qIndex / questions.length) * 100}%` }} />
        </div>
        <span className="text-xs font-mono text-mist">
          {qIndex + 1} / {questions.length}
        </span>
        <div key={qIndex} className="ticket flex w-full max-w-sm flex-col gap-4 rounded-xl p-6">
          <p className="text-sm text-mist">What does this mean?</p>
          <p className="text-center font-display text-2xl">{decodeHtmlEntities(q.word)}</p>
          <div className="flex flex-col gap-2">
            {q.options.map((opt, i) => {
              const isCorrect = opt === q.correctAnswer
              const isChosen = opt === selected
              let style = 'border-line hover:border-brass'
              if (selected) {
                if (isCorrect) style = 'border-sage text-sage'
                else if (isChosen) style = 'border-coral text-coral'
                else style = 'border-line opacity-50'
              }
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => answer(opt)}
                  disabled={Boolean(selected)}
                  className={`focus-ring rounded-md border px-3 py-2 text-left text-sm transition-colors ${style}`}
                >
                  {decodeHtmlEntities(opt)}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
