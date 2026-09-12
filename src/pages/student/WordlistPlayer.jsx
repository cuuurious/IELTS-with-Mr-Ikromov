import { useEffect, useRef, useState } from 'react'
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
//
// The flip card used to be a REAL 3D flip (rotateY + perspective +
// backface-visibility, two absolutely-positioned faces stacked on top
// of each other). That turned out to be two rounds of cross-browser
// rendering bugs in a row — first overflowing text bleeding past the
// card because overflow clipping silently breaks on an element that
// also has backface-visibility set, and then, after fixing that, the
// card visibly squashing/dipping mid-animation because clipping a
// container around a rotating 3D child clips part of its natural
// perspective "bulge" while it's mid-turn. Both are real, documented
// WebKit/Chromium quirks with 3D transforms — not something worth a
// third round of chasing. wlp-flip below fakes the same "card flips
// over" feeling with a plain 2D horizontal squash (scaleX 1 → 0 → 1,
// swapping which side's content is showing at the invisible zero-width
// midpoint) — no rotation, no perspective, no backface-visibility, so
// none of that whole class of bug can happen here again.
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
@keyframes wlp-flip {
  0% { transform: scaleX(1); }
  50% { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}
.wlp-pop { animation: wlp-pop 0.32s cubic-bezier(0.22, 1, 0.36, 1); }
.wlp-pulse { animation: wlp-pulse 0.28s ease-out; }
.wlp-flip { animation: wlp-flip 0.36s ease; }
`

// How long the wlp-flip animation takes to visually reach zero width
// (its exact midpoint) — the moment content is swapped, so the swap
// itself is never actually seen, only the squash-and-unsquash.
const FLIP_SWAP_DELAY_MS = 180

// How often in-progress study/quiz state is checkpointed to
// localStorage. Kept short (2s) because the whole point is that an
// interruption — the phone locking, the browser tab getting killed in
// the background, an accidental refresh — should cost at most a
// couple of seconds of progress, not the entire list.
const AUTOSAVE_INTERVAL_MS = 2000

// Saved progress older than this is treated as abandoned rather than
// resumed — mainly so a half-finished attempt from weeks ago doesn't
// unexpectedly reappear.
const AUTOSAVE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

function progressKeyFor(studentId, wordlistId) {
  return `ielts-wordlist-progress:${studentId}:${wordlistId}`
}

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

  // Retriggers the wlp-flip squash animation on every tap — changing a
  // className alone doesn't restart a CSS animation that's already
  // finished, but remounting the element via a changing `key` does.
  const [flipAnimKey, setFlipAnimKey] = useState(0)
  const flipTimeoutRef = useRef(null)

  // Swaps the visible side exactly at the flip animation's invisible
  // (zero-width) midpoint, so the change itself is never seen — only
  // the squash-and-unsquash motion is.
  const toggleFlip = () => {
    setFlipAnimKey((key) => key + 1)

    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current)
    }

    flipTimeoutRef.current = setTimeout(() => {
      setFlipped((f) => !f)
      flipTimeoutRef.current = null
    }, FLIP_SWAP_DELAY_MS)
  }

  // Moving to a different word should show its front face immediately
  // — no animation, and no leftover flip from the previous card
  // arriving late.
  const resetFlip = () => {
    if (flipTimeoutRef.current) {
      clearTimeout(flipTimeoutRef.current)
      flipTimeoutRef.current = null
    }

    setFlipped(false)
  }

  useEffect(() => {
    return () => {
      if (flipTimeoutRef.current) {
        clearTimeout(flipTimeoutRef.current)
      }
    }
  }, [])

  const [questions, setQuestions] = useState([])
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState([])
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  // Whether we just restored an in-progress attempt from a previous
  // visit, so a small "picked up where you left off" note can be
  // shown once, instead of the resume happening silently.
  const [resumed, setResumed] = useState(false)

  const progressKey = progressKeyFor(
    studentId,
    wordlist.id
  )

  useEffect(() => {
    supabase
      .from('wordlist_items')
      .select('*')
      .eq('wordlist_id', wordlist.id)
      .order('position')
      .then(({ data }) => {
        const loadedItems = data || []
        setItems(loadedItems)

        /*
         * -----------------------------------------------------
         * RESUME AUTOSAVED PROGRESS
         * -----------------------------------------------------
         *
         * Only trusted if it still lines up with what's actually
         * here right now — the word count, and (for a quiz) the
         * exact words the saved questions were built from — and if
         * the teacher hasn't reset this list since it was saved.
         * Anything that doesn't check out is discarded rather than
         * risking a broken resume.
         */
        try {
          const raw = localStorage.getItem(
            progressKey
          )

          if (!raw) return

          const saved = JSON.parse(raw)

          const resetAt =
            wordlist.completion_reset_at ||
            null

          const isFromBeforeReset =
            saved.resetAt !== resetAt

          const isTooOld =
            !saved.savedAt ||
            Date.now() - saved.savedAt >
              AUTOSAVE_MAX_AGE_MS

          if (
            isFromBeforeReset ||
            isTooOld
          ) {
            localStorage.removeItem(
              progressKey
            )
            return
          }

          if (
            saved.mode === 'study' &&
            Number.isInteger(
              saved.cardIndex
            ) &&
            saved.cardIndex > 0 &&
            saved.cardIndex <
              loadedItems.length
          ) {
            setCardIndex(
              saved.cardIndex
            )
            setResumed(true)
          } else if (
            saved.mode === 'quiz' &&
            Array.isArray(
              saved.questions
            ) &&
            saved.questions.length >
              0 &&
            Array.isArray(saved.detail)
          ) {
            const currentWords = new Set(
              loadedItems.map(
                (item) => item.word
              )
            )

            const stillValid =
              saved.questions.every(
                (q) =>
                  currentWords.has(
                    q.word
                  )
              )

            if (
              stillValid &&
              saved.qIndex >= 0 &&
              saved.qIndex <
                saved.questions.length
            ) {
              setQuestions(
                saved.questions
              )
              setQIndex(saved.qIndex)
              setDetail(saved.detail)
              setMode('quiz')
              setResumed(true)
            } else {
              localStorage.removeItem(
                progressKey
              )
            }
          }
        } catch {
          // Corrupt or unreadable autosave — ignore it and start fresh
          // rather than let a bad localStorage entry break the page.
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordlist.id])

  /*
   * -----------------------------------------------------------
   * AUTOSAVE
   * -----------------------------------------------------------
   *
   * Checkpoints study/quiz progress to localStorage roughly every
   * 2 seconds so an interruption — the app closing, the phone
   * locking, a lost connection — costs at most a couple of seconds
   * of progress instead of the whole list. A ref (rather than the
   * interval depending on every piece of state) keeps this to one
   * timer for the life of the component, always reading the latest
   * values when it fires.
   */

  const progressSnapshotRef = useRef(
    null
  )

  useEffect(() => {
    progressSnapshotRef.current = {
      mode,
      cardIndex,
      qIndex,
      detail,
      questions,
    }
  })

  useEffect(() => {
    const interval = setInterval(() => {
      const snapshot =
        progressSnapshotRef.current

      if (!snapshot) return

      // Nothing worth saving yet, and nothing to save once the
      // attempt is already complete — the real result is in the
      // database by then.
      if (
        snapshot.mode !== 'study' &&
        snapshot.mode !== 'quiz'
      ) {
        return
      }

      if (
        snapshot.mode === 'study' &&
        snapshot.cardIndex === 0
      ) {
        return
      }

      try {
        localStorage.setItem(
          progressKey,
          JSON.stringify({
            ...snapshot,
            resetAt:
              wordlist.completion_reset_at ||
              null,
            savedAt: Date.now(),
          })
        )
      } catch {
        // Private browsing / storage disabled / storage full —
        // autosave just silently doesn't happen this tick.
      }
    }, AUTOSAVE_INTERVAL_MS)

    return () =>
      clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressKey])

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

        // The real result now lives in the database — the autosaved
        // in-progress copy would only be stale from here on.
        try {
          localStorage.removeItem(progressKey)
        } catch {
          // Ignore — nothing to clean up if storage isn't available.
        }
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

        {resumed && (
          <div className="text-sage text-xs font-mono -mt-1">
            Picked up where you left off
          </div>
        )}

        <div key={cardIndex} className="wlp-pop w-full max-w-sm">
          <button
            key={flipAnimKey}
            onClick={toggleFlip}
            aria-label={flipped ? 'Show the word' : 'Reveal definition and translation'}
            className="wlp-flip focus-ring ticket rounded-xl w-full min-h-[18rem] max-h-96 overflow-y-auto flex flex-col items-center justify-center gap-2 p-6 text-center"
          >
            {!flipped ? (
              /* FRONT — the word */
              <>
                <span className="font-display text-3xl">{item.word}</span>
                <span className="text-mist text-xs font-mono mt-2">tap to reveal</span>
              </>
            ) : (
              /* BACK — definition, translation, example */
              <>
                {item.definition && (
                  <p className="text-paper text-sm leading-5">{item.definition}</p>
                )}
                <p className="text-brass font-medium">{item.uzbek_translation}</p>
                {item.example_sentence && (
                  <p className="text-mist text-sm italic">"{item.example_sentence}"</p>
                )}
                <span className="text-mist text-xs font-mono mt-2">tap to see word</span>
              </>
            )}
          </button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => {
              setCardIndex((i) => Math.max(0, i - 1))
              resetFlip()
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
                resetFlip()
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
        {resumed && (
          <div className="text-sage text-xs font-mono -mt-2">
            Picked up where you left off
          </div>
        )}
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
