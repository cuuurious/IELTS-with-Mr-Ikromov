import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { Flashcards, QuizRunner, ResultsPanel, buildMixedQuestions } from './wordPractice'

/*
 * WORD LIST PLAYER — rebuilt 2026-10-06 on the shared word-practice
 * engine (wordPractice.jsx): swipeable flashcards with sound and
 * "know / still learning" rounds, then a mixed test (meaning, word,
 * sentence gap, spelling) with instant feedback, a second chance for
 * missed words, streaks, and an animated result.
 *
 * Unchanged contracts:
 *   - one wordlist_attempts row per finished test, detail rows
 *     {word, correct, chosen, isCorrect} — the database trigger moves
 *     each word through the spaced-repetition boxes from that;
 *   - progress is checkpointed in localStorage (key per student + list)
 *     so a locked phone or a refresh doesn't lose the place; a teacher
 *     reset (completion_reset_at) discards old progress.
 */

const AUTOSAVE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const SAVE_VERSION = 2

function progressKeyFor(studentId, wordlistId) {
  return `ielts-wordlist-progress:${studentId}:${wordlistId}`
}

function readSaved(key, resetAt) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (saved.v !== SAVE_VERSION || saved.resetAt !== resetAt || !saved.savedAt || Date.now() - saved.savedAt > AUTOSAVE_MAX_AGE_MS) {
      localStorage.removeItem(key)
      return null
    }
    return saved
  } catch {
    return null
  }
}

function writeSaved(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...value, v: SAVE_VERSION, savedAt: Date.now() }))
  } catch {
    /* storage unavailable — progress just isn't kept */
  }
}

function clearSaved(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* nothing to clear */
  }
}

function ModeTabs({ mode, onStudy, onTest }) {
  return (
    <div className="inline-flex rounded-full border border-line bg-panel p-1 text-sm">
      {[
        ['study', 'Cards', onStudy],
        ['quiz', 'Test', onTest],
      ].map(([key, label, fn]) => (
        <button
          key={key}
          type="button"
          onClick={fn}
          className={`focus-ring rounded-full px-4 py-1.5 font-medium transition-colors ${
            mode === key ? 'bg-brass text-onbrass' : 'text-mist hover:text-paper'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

export default function WordlistPlayer({ wordlist, studentId, onExit }) {
  const [items, setItems] = useState(null)
  const [mode, setMode] = useState('study') // study | quiz | results
  const [studyItems, setStudyItems] = useState(null) // null = whole list
  const [studyStart, setStudyStart] = useState(0)
  const [studyKey, setStudyKey] = useState(0)
  const [questions, setQuestions] = useState([])
  const [quizInitial, setQuizInitial] = useState(null)
  const [quizKey, setQuizKey] = useState(0)
  const [result, setResult] = useState(null) // {detail, best}
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [resumed, setResumed] = useState(false)

  const progressKey = progressKeyFor(studentId, wordlist.id)
  const resetAt = wordlist.completion_reset_at || null
  const lastSnapshot = useRef(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('wordlist_items')
      .select('*')
      .eq('wordlist_id', wordlist.id)
      .order('position')
      .then(({ data }) => {
        if (cancelled) return
        const loaded = data || []
        setItems(loaded)
        const saved = readSaved(progressKey, resetAt)
        if (!saved) return
        const ids = new Set(loaded.map((it) => it.id))
        if (saved.mode === 'study' && saved.cardIndex > 0 && saved.cardIndex < loaded.length) {
          setStudyStart(saved.cardIndex)
          setResumed(true)
        } else if (saved.mode === 'quiz' && saved.quiz?.queue?.length && saved.quiz.queue.every((q) => ids.has(q.itemId))) {
          setQuizInitial(saved.quiz)
          setQuestions(saved.quiz.queue)
          setMode('quiz')
          setResumed(true)
        } else {
          clearSaved(progressKey)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordlist.id])

  const startQuiz = () => {
    setQuestions(buildMixedQuestions(items))
    setQuizInitial(null)
    setQuizKey((k) => k + 1)
    setResult(null)
    setMode('quiz')
    setResumed(false)
  }

  const startStudy = (subset = null) => {
    setStudyItems(subset)
    setStudyStart(0)
    setStudyKey((k) => k + 1)
    setMode('study')
    setResumed(false)
  }

  const saveAttempt = async (detail) => {
    setSaving(true)
    setSaveFailed(false)
    const score = detail.filter((d) => d.isCorrect).length
    const total = detail.length
    let failed = false
    try {
      const { error } = await supabase.from('wordlist_attempts').insert({
        wordlist_id: wordlist.id,
        student_id: studentId,
        score,
        total,
        percentage: total ? Math.round((score / total) * 100) : 0,
        detail,
      })
      if (error) throw error
    } catch (err) {
      console.error('Failed to save word list attempt:', err)
      failed = true
    }
    setSaving(false)
    setSaveFailed(failed)
    if (!failed) clearSaved(progressKey)
  }

  const onQuizFinish = (detail, state) => {
    setResult({ detail, best: state?.best || 0 })
    setMode('results')
    saveAttempt(detail)
  }

  const deck = useMemo(() => studyItems || items || [], [studyItems, items])

  if (!items) return <p className="text-mist">Loading…</p>

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <button type="button" onClick={onExit} className="focus-ring text-sm text-mist hover:text-paper">
        ← Back to word lists
      </button>
      {mode !== 'results' && items.length > 0 && (
        <ModeTabs mode={mode} onStudy={() => startStudy(null)} onTest={() => (mode === 'quiz' ? null : startQuiz())} />
      )}
    </div>
  )

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <p className="text-mist">This word list doesn't have any words in it yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 overflow-x-clip">
      {header}
      <div className="text-center">
        <p className="text-lg font-semibold text-paper">{wordlist.title}</p>
        <p className="text-xs text-mist">
          {items.length} word{items.length === 1 ? '' : 's'}
          {studyItems && mode === 'study' ? ` · practising ${studyItems.length} missed` : ''}
        </p>
        {resumed && <p className="mt-1 text-xs font-medium text-reading">Picked up where you left off</p>}
      </div>

      {mode === 'study' && (
        <Flashcards
          key={studyKey}
          items={deck}
          initialIndex={studyStart}
          onIndexChange={(i) => {
            if (!studyItems) writeSaved(progressKey, { mode: 'study', cardIndex: i, resetAt })
          }}
          onStartTest={startQuiz}
        />
      )}

      {mode === 'quiz' && questions.length > 0 && (
        <QuizRunner
          key={quizKey}
          questions={questions}
          initial={quizInitial}
          onSnapshot={(state) => {
            lastSnapshot.current = state
            writeSaved(progressKey, { mode: 'quiz', quiz: state, resetAt })
          }}
          onFinish={onQuizFinish}
        />
      )}
      {mode === 'quiz' && questions.length === 0 && (
        <p className="text-center text-sm text-mist">This list needs at least two words with meanings for a test.</p>
      )}

      {mode === 'results' && result && (
        <ResultsPanel
          detail={result.detail}
          best={result.best}
          title={wordlist.title}
          saving={saving}
          saveFailed={saveFailed}
          onRetrySave={() => saveAttempt(result.detail)}
          onPractiseMistakes={() => {
            const wrongIds = new Set(result.detail.filter((d) => !d.isCorrect).map((d) => d.itemId))
            startStudy(items.filter((it) => wrongIds.has(it.id)))
          }}
          onAgain={startQuiz}
          onExit={onExit}
          exitLabel="Back to word lists"
        />
      )}
    </div>
  )
}
