import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { Flashcards, QuizRunner, ResultsPanel, buildMixedQuestions } from '../../pages/student/wordPractice'
import TaskShell, { Panel } from './TaskShell'

/*
 * A word list set as homework (2026-11-02): study the cards, then the
 * mixed quiz (meaning, word, gap, spelling). The first-try score is
 * handed in with submit_homework_score() and every answer also feeds
 * the student's spaced-repetition boxes (record_word_review).
 */
export default function WordlistTask({ task, onClose, onChanged }) {
  const [status, setStatus] = useState('loading') // loading | cards | quiz | saving | done | error
  const [list, setList] = useState(null)
  const [items, setItems] = useState([])
  const [questions, setQuestions] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [{ data: wl }, { data: rows, error: itemsError }] = await Promise.all([
        supabase.from('wordlists').select('id, title').eq('id', task.wordlist_id).maybeSingle(),
        supabase
          .from('wordlist_items')
          .select('id, wordlist_id, word, definition, uzbek_translation, example_sentence, position')
          .eq('wordlist_id', task.wordlist_id)
          .order('position', { ascending: true }),
      ])
      if (cancelled) return
      if (itemsError || !rows?.length) {
        setError(itemsError?.message || 'This word list is empty.')
        setStatus('error')
        return
      }
      setList(wl)
      setItems(rows)
      setStatus('cards')
    })()
    return () => {
      cancelled = true
    }
  }, [task.wordlist_id])

  const startQuiz = () => {
    setQuestions(buildMixedQuestions(items, items))
    setResult(null)
    setStatus('quiz')
  }

  const save = async (detail) => {
    setStatus('saving')
    setSaveFailed(false)
    const score = detail.filter((d) => d.isCorrect).length
    const [hand, review] = await Promise.all([
      supabase.rpc('submit_homework_score', {
        p_task_id: task.id,
        p_score: score,
        p_max: detail.length,
        p_details: { missed: detail.filter((d) => !d.isCorrect).map((d) => d.word).filter(Boolean) },
      }),
      supabase.rpc('record_word_review', { p_results: detail.map((d) => ({ item_id: d.itemId, correct: d.isCorrect })) }),
    ])
    if (hand.error) {
      setError(hand.error.message)
      setSaveFailed(true)
    } else {
      onChanged?.()
    }
    if (review.error) console.error('Word review not saved:', review.error)
    setStatus('done')
  }

  const title = task.title || list?.title || 'Word list'

  return (
    <TaskShell kind="wordlist" title={title} subtitle={items.length ? `${items.length} word${items.length === 1 ? '' : 's'}` : ''} onClose={onClose}>
      {status === 'loading' && <Panel><p className="text-sm font-semibold text-mist">Opening the words…</p></Panel>}
      {status === 'error' && <Panel><p className="text-sm font-semibold text-coral">{error}</p></Panel>}

      {status === 'cards' && (
        <Panel className="flex flex-col gap-4">
          <Flashcards items={items} title={title} onStartTest={startQuiz} />
          <button type="button" onClick={startQuiz} className="focus-ring h-12 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] hover:brightness-105">
            I'm ready — start the quiz
          </button>
        </Panel>
      )}

      {status === 'quiz' && (
        <Panel>
          <QuizRunner
            questions={questions}
            label="Homework quiz"
            onFinish={(detail, state) => {
              setResult({ detail, best: state?.best || 0 })
              save(detail)
            }}
          />
        </Panel>
      )}

      {(status === 'done' || status === 'saving') && result && (
        <Panel>
          <ResultsPanel
            detail={result.detail}
            best={result.best}
            title="Homework handed in"
            note={saveFailed ? error : 'Your first try is the one that counts. You can practise again any time.'}
            saving={status === 'saving'}
            saveFailed={saveFailed}
            onRetrySave={() => save(result.detail)}
            onAgain={startQuiz}
            onExit={onClose}
            exitLabel="Back to homework"
          />
        </Panel>
      )}
    </TaskShell>
  )
}
