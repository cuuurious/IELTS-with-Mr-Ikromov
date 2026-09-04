import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

function shuffle(arr) {
  const a = [...arr]

  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    )

    ;[a[i], a[j]] = [a[j], a[i]]
  }

  return a
}

function decodeHtmlEntities(value) {
  if (!value) return ''

  const textarea =
    document.createElement('textarea')

  textarea.innerHTML = value

  return textarea.value
}

// The quiz used to test on the definition — when definitions were
// temporarily cut off from word lists, the options here were switched
// over to the Uzbek translation as a stand-in. Definitions are back, so
// this goes back to testing on those; meaningOf() below still falls
// back to the translation for the rare item that has no definition on
// file (a collocation MW doesn't have its own entry for, say), so a
// blank definition never shows up as an actual quiz option.
function meaningOf(item) {
  return item.definition || item.uzbek_translation || ''
}

// Whether meaningOf() above is showing an actual English definition or
// had to fall back to the Uzbek translation (a collocation Merriam-
// Webster doesn't have its own entry for, most commonly). Distractors
// need to be picked from the SAME type as the correct answer — mixing
// "to make or do something the same way as..." (a definition) in with
// "bezovta qiluvchi tajriba" (a translation) as options for one
// question makes it obvious which option is correct by its language
// alone, instead of testing whether the student actually knows the
// word.
function meaningType(item) {
  return item.definition ? 'definition' : 'translation'
}

function buildQuestions(items) {
  const usable = items.filter((item) => meaningOf(item))

  return shuffle(usable).map((item) => {
    const distractorPool = usable.filter(
      (it) => it.id !== item.id
    )

    const correctAnswer = meaningOf(item)
    const targetType = meaningType(item)

    // Prefer distractors of the same type (definition vs. translation)
    // as the correct answer, so every option in a question reads the
    // same way. Only fall back to the mixed pool if there simply
    // aren't 3 other same-type items to draw from.
    const sameTypePool = distractorPool.filter(
      (it) => meaningType(it) === targetType
    )

    const pool =
      sameTypePool.length >= 3
        ? sameTypePool
        : distractorPool

    const distractors = shuffle(
      pool
    )
      .map(meaningOf)
      .filter(
        (meaning) =>
          meaning && meaning !== correctAnswer
      )
      .slice(0, 3)

    const options = shuffle([
      correctAnswer,
      ...distractors,
    ])

    return {
      word: item.word,
      correctAnswer,
      options,
    }
  })
}
// A few small, self-contained animations for this page only — a flip
// card (study mode), a "pop" entrance whenever a new card/question
// shows up, and a little pulse on whichever answer was just tapped.
// Kept scoped to this component (a plain <style> tag) rather than
// touching the shared stylesheet.
const ANIMATION_STYLES = `
@keyframes wlp-pop {
  from { opacity: 0; transform: scale(0.94) translateY(6px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes wlp-pulse {
  0% { transform: scale(1); }
  45% { transform: scale(1.04); }
  100% { transform: scale(1); }
}
.wlp-pop { animation: wlp-pop 0.32s cubic-bezier(0.22, 1, 0.36, 1); }
.wlp-pulse { animation: wlp-pulse 0.28s ease-out; }
`

function categoryFor(percentage) {
  if (percentage >= 90) return { label: 'Excellent!', tone: 'sage', note: 'Outstanding recall — these words are locked in.' }
  if (percentage >= 70) return { label: 'Good job', tone: 'brass', note: 'Solid work. A quick review of the missed ones will make it perfect.' }
  return { label: 'Keep practicing', tone: 'coral', note: "Don't worry — review the list again and try once more." }
}

export default function WordlistPlayer({ wordlist, studentId, onExit }) {
  const [items, setItems] = useState(null)
  const [mode, setMode] = useState('study') // 'study' | 'quiz' | 'results'
  const [cardIndex, setCardIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const [questions, setQuestions] = useState([])
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState([])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    supabase
      .from('wordlist_items')
      .select('*')
      .eq('wordlist_id', wordlist.id)
      .order('position')
      .then(({ data }) => setItems(data || []))
  }, [wordlist.id])

  const startQuiz = () => {
    setQuestions(buildQuestions(items))
    setQIndex(0)
    setDetail([])
    setSelected(null)
    setMode('quiz')
  }

  const answer = (option) => {
    if (selected) return
    setSelected(option)
    const q = questions[qIndex]
    const isCorrect = option === q.correctAnswer
    const newDetail = [...detail, { word: q.word, correct: q.correctAnswer, chosen: option, isCorrect }]
    setDetail(newDetail)

    setTimeout(async () => {
      if (qIndex + 1 < questions.length) {
        setQIndex((i) => i + 1)
        setSelected(null)
      } else {
        const score = newDetail.filter((d) => d.isCorrect).length
        const total = newDetail.length
        const percentage = Math.round((score / total) * 100)
        setSaving(true)
        await supabase.from('wordlist_attempts').insert({
          wordlist_id: wordlist.id,
          student_id: studentId,
          score,
          total,
          percentage,
          detail: newDetail,
        })
        setSaving(false)
        setResult({ score, total, percentage, detail: newDetail })
        setMode('results')
      }
    }, 600)
  }

  const category = result ? categoryFor(result.percentage) : null

  if (!items) return <p className="text-mist">Loading…</p>

  if (items.length === 0) {
    return (
      <div className="flex flex-col gap-4 items-center text-center">
        <div className="w-full flex items-center justify-between">
          <button onClick={onExit} className="focus-ring text-mist hover:text-paper text-sm">
            ← Back
          </button>
        </div>
        <p className="text-mist">This word list doesn't have any words in it yet.</p>
      </div>
    )
  }

  if (mode === 'study') {
    const item = items[cardIndex]
    return (
      <div className="flex flex-col gap-4 items-center">
        <style>{ANIMATION_STYLES}</style>

        <div className="w-full flex items-center justify-between">
          <button onClick={onExit} className="focus-ring text-mist hover:text-paper text-sm">
            ← Back
          </button>
          <span className="text-mist text-xs font-mono">
            {cardIndex + 1} / {items.length}
          </span>
        </div>

        <div
          key={cardIndex}
          className="wlp-pop w-full max-w-sm overflow-hidden"
          style={{ perspective: '1200px' }}
        >
          {/* Why this outer div needs its OWN `overflow-hidden` (this is
              the actual fix — a previous attempt only moved things
              around on the transformed elements below and the overlap
              came right back):
              Every element inside this card that has 3D transform
              properties (backfaceVisibility / the flip rotation) is
              part of a well-known WebKit/mobile-Safari-and-Chrome bug
              where overflow clipping — `hidden`, not just `auto`/
              `scroll` — silently stops working on THAT SAME element.
              Both the front/back faces AND their `.ticket` styling
              carry backfaceVisibility, so relying on `.ticket`'s own
              `overflow: hidden` to contain overflowing text was
              exactly the same broken combination, just with `hidden`
              instead of `auto`. This wrapping div has no 3D transform
              or backface-visibility of its own (only `perspective`,
              which doesn't trigger the bug) — it's a completely
              ordinary block, so its `overflow-hidden` reliably clips
              anything the rotated children inside it try to spill
              past its edges, on every browser. */}
          <button
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? 'Show the word' : 'Reveal definition and translation'}
            className="focus-ring relative w-full h-72 block"
            style={{
              transformStyle: 'preserve-3d',
              transition: 'transform 0.5s cubic-bezier(0.4, 0.2, 0.2, 1)',
              transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
            }}
          >
            {/* FRONT — the word */}
            <div
              className="ticket rounded-xl absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
              style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
            >
              <span className="font-display text-3xl">{item.word}</span>
              <span className="text-mist text-xs font-mono mt-2">tap to reveal</span>
            </div>

            {/* BACK — definition, translation, example.
                This used to have `overflow-y-auto` directly on this
                same element — the one carrying `backfaceVisibility:
                hidden` for the 3D flip. That combination is a known
                mobile-Safari/Chrome bug: overflow scrolling silently
                stops working (and stops clipping) on an element that
                also has backface-visibility set inside a 3D transform,
                so a longer definition/translation/example just spilled
                out of the card and overlapped the Previous/Next
                buttons below it, instead of scrolling or being cut off
                cleanly. Fixed by keeping this outer element purely for
                the 3D positioning (plus `.ticket`'s own `overflow:
                hidden`, which — unlike a scrollable overflow-auto —
                works fine here and acts as a hard safety clip), and
                moving the actual scrolling to a plain nested div below
                that isn't itself part of the 3D transform. */}
            <div
              className="ticket rounded-xl absolute inset-0"
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <div className="h-full w-full overflow-y-auto flex flex-col items-center justify-center gap-2 p-6 text-center">
                {item.definition && (
                  <p className="text-paper text-sm leading-5">{item.definition}</p>
                )}
                <p className="text-brass font-medium">{item.uzbek_translation}</p>
                {item.example_sentence && (
                  <p className="text-mist text-sm italic">"{item.example_sentence}"</p>
                )}
                <span className="text-mist text-xs font-mono mt-2">tap to see word</span>
              </div>
            </div>
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setCardIndex((i) => Math.max(0, i - 1))
              setFlipped(false)
            }}
            disabled={cardIndex === 0}
            className="focus-ring px-4 py-2 rounded-md border border-line text-sm disabled:opacity-30"
          >
            Previous
          </button>
          {cardIndex + 1 < items.length ? (
            <button
              onClick={() => {
                setCardIndex((i) => i + 1)
                setFlipped(false)
              }}
              className="focus-ring px-4 py-2 rounded-md border border-line text-sm hover:border-brass hover:text-brass"
            >
              Next
            </button>
          ) : (
            <button
              onClick={startQuiz}
              className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium"
            >
              I'm ready — start the test

            </button>
          )}
        </div>
      </div>
    )
  }

  if (mode === 'quiz') {
    const q = questions[qIndex]
    return (
      <div className="flex flex-col gap-4 items-center">
        <style>{ANIMATION_STYLES}</style>
        <span className="text-mist text-xs font-mono">
          Question {qIndex + 1} / {questions.length}
        </span>
        <div key={qIndex} className="wlp-pop ticket rounded-xl w-full max-w-sm p-6 flex flex-col gap-4">
          <p className="text-mist text-sm">What does this mean?</p>
         <p className="font-display text-2xl text-center">
  {decodeHtmlEntities(q.word)}
</p>
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
                  onClick={() => answer(opt)}
                  disabled={!!selected}
                  className={`focus-ring text-left px-3 py-2 rounded-md border text-sm transition-colors ${style} ${isChosen ? 'wlp-pulse' : ''}`}
                >
                  {decodeHtmlEntities(opt)}
                </button>
              )
            })}
          </div>
        </div>
        {saving && <p className="text-mist text-xs font-mono">saving result…</p>}
      </div>
    )
  }

  // results
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <style>{ANIMATION_STYLES}</style>
      <div className="wlp-pop ticket rounded-lg p-6 max-w-sm w-full flex flex-col gap-4 text-center">
        <span className={`stamp stamp-${category.tone === 'sage' ? 'done' : category.tone === 'coral' ? 'overdue' : 'pending'} w-20 h-20 mx-auto text-xs`}>
          {result.percentage}%
        </span>
        <h2 className="font-display text-2xl">{category.label}</h2>
        <p className="text-mist text-sm">{category.note}</p>
        <p className="text-sm">
          {result.score} / {result.total} correct
        </p>

        {result.detail.some((d) => !d.isCorrect) && (
          <div className="text-left bg-panel-2 border border-line rounded-md p-3 max-h-40 overflow-y-auto">
            <div className="text-xs uppercase tracking-wide text-mist font-mono mb-2">
              Words to review
            </div>
            {result.detail
              .filter((d) => !d.isCorrect)
              .map((d, i) => (
                <div key={i} className="text-sm mb-1">
                  <span className="font-medium">{d.word}</span>
                  <span className="text-mist"> — {decodeHtmlEntities(d.correct)}</span>
                </div>
              ))}
          </div>
        )}

        <button
          onClick={onExit}
          className="focus-ring px-4 py-2 rounded-md bg-brass text-onbrass font-medium"
        >
          Close
        </button>
      </div>
    </div>
  )
}
