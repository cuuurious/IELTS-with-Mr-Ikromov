import { useEffect, useState } from 'react'
import { RuLine } from '../../lib/russian'
import { supabase } from '../../lib/supabaseClient'
import { QuizRunner, ResultsPanel, SpeakButton, buildMixedQuestions } from './wordPractice'

/*
 * MY WORDS (2026-11-02) — words the student double-clicked in a passage
 * and saved. Same review boxes as word lists: right answer moves a word
 * up (tomorrow, 3 days, a week…), a wrong one brings it back today.
 */
export default function MyWords({ studentId, onExit }) {
  const [words, setWords] = useState(null)
  const [mode, setMode] = useState('list') // list | quiz | done
  const [questions, setQuestions] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    const { data, error: e } = await supabase
      .from('student_words')
      .select('id, word, definition, uzbek_translation, example_sentence, source, box, due_at, created_at')
      .eq('user_id', studentId)
      .order('created_at', { ascending: false })
    if (e) setError(e.message)
    setWords(data || [])
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  const now = Date.now()
  const due = (words || []).filter((w) => new Date(w.due_at).getTime() <= now)
  const known = (words || []).filter((w) => w.box >= 3).length

  const startReview = () => {
    const items = due.map((w) => ({ ...w, wordlist_id: 'mine' }))
    const pool = (words || []).map((w) => ({ ...w, wordlist_id: 'mine' }))
    setQuestions(buildMixedQuestions(items.slice(0, 20), pool))
    setMode('quiz')
  }

  const remove = async (id) => {
    setWords((prev) => prev.filter((w) => w.id !== id))
    await supabase.from('student_words').delete().eq('id', id)
  }

  const header = (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={onExit} className="focus-ring text-sm font-bold text-mist hover:text-paper">
        ← Back to word lists
      </button>
      <span className="rounded-xl bg-vocab-tint px-2.5 py-1 text-xs font-extrabold text-vocab">My words</span>
    </div>
  )

  if (mode === 'quiz') {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="rounded-[20px] border border-line bg-panel p-5">
          <QuizRunner
            questions={questions}
            label="My words"
            onFinish={async (detail, state) => {
              setResult({ detail, best: state?.best || 0 })
              setMode('done')
              await Promise.all(detail.map((d) => supabase.rpc('review_student_word', { p_word_id: d.itemId, p_correct: d.isCorrect })))
              load()
            }}
          />
        </div>
      </div>
    )
  }

  if (mode === 'done' && result) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="rounded-[20px] border border-line bg-panel p-5">
          <ResultsPanel detail={result.detail} best={result.best} title="My words review" onExit={() => setMode('list')} exitLabel="Back to my words" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { v: words?.length ?? '—', l: 'saved', c: 'bg-vocab-tint text-vocab' },
          { v: due.length, l: 'ready to review', c: 'bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))] text-amber' },
          { v: known, l: 'well known', c: 'bg-reading-tint text-reading' },
        ].map((t) => (
          <div key={t.l} className={`rounded-[20px] px-5 py-4 ${t.c}`}>
            <div className="font-brand text-[28px] font-semibold leading-none">{t.v}</div>
            <div className="mt-1.5 text-[13px] font-extrabold text-paper-dim">{t.l}</div>
          </div>
        ))}
      </div>

      {due.length > 0 && (
        <button type="button" onClick={startReview} className="focus-ring h-12 self-start rounded-[14px] bg-saffron px-6 text-[15px] font-extrabold text-[#17213a] hover:brightness-105">
          Review {Math.min(due.length, 20)} word{due.length === 1 ? '' : 's'}
        </button>
      )}

      {error && <p className="text-sm font-bold text-coral">{error}</p>}

      {words && words.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[24px] bg-vocab-tint px-6 py-10 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[20px] bg-panel font-brand text-[26px] font-semibold text-vocab" aria-hidden="true">Aa</span>
          <p className="font-brand text-[18px] font-semibold text-paper">No saved words yet</p>
          <p className="max-w-sm text-sm font-semibold text-paper-dim">In a practice test, double-click any word to see its meaning and save it here.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(words || []).map((w) => (
            <div key={w.id} className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
              <div className="flex items-center gap-2">
                <span className="font-brand text-[18px] font-semibold text-paper">{w.word}</span>
                <SpeakButton text={w.word} className="h-7 w-7" />
                <span className="ml-auto flex gap-0.5" aria-label={`Level ${w.box} of 5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={`h-2 w-3 rounded-full ${w.box >= n ? 'bg-reading' : 'bg-panel-2'}`} />
                  ))}
                </span>
              </div>
              {w.uzbek_translation && (
                <p className="w-fit rounded-xl bg-vocab-tint px-2.5 py-1 text-sm font-extrabold text-vocab">
                  {w.uzbek_translation}
                  <RuLine word={w.word} definition={w.definition} uzbek={w.uzbek_translation} />
                </p>
              )}
              {w.definition && <p className="text-sm leading-6 text-paper-dim">{w.definition}</p>}
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="truncate text-xs font-bold text-mist">{w.source || 'Saved word'}</span>
                <button type="button" onClick={() => remove(w.id)} className="focus-ring rounded-lg px-2 py-1 text-xs font-extrabold text-coral hover:bg-urgent-tint">
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
