import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/*
 * WORD PRACTICE ENGINE (2026-10-06)
 *
 * Shared by WordlistPlayer (a teacher's list: flashcards → test) and
 * WordReview (today's spaced-repetition words).
 *
 * Flashcards
 *   - tap / Space flips; the word can be heard (browser speech, en-GB);
 *   - swipe right or → = "I know it", swipe left or ← = "Still learning";
 *   - the end of the deck shows what's known / still learning and offers
 *     another round with only the "still learning" cards, then the test.
 *
 * Test — four kinds of question instead of one, so a word is met from
 * different sides:
 *   meaning  word → pick its meaning
 *   word     meaning → pick the word
 *   gap      the example sentence with the word blanked → pick the word
 *   spell    meaning + Uzbek (+ listen) → type the word
 * Every answer shows the right answer with the example before moving on.
 * A word answered wrong comes back once at the end ("second chance") so
 * the student finishes on the right answer — only the first try counts
 * for the score and for spaced repetition. Answers in a row build a
 * streak. Keys: 1–4 pick an option, Enter continues.
 *
 * Detail rows keep the old shape {word, correct, chosen, isCorrect} (+
 * kind) — the database trigger moving words between review boxes only
 * reads word + isCorrect.
 */

/* ---------------- helpers ---------------- */

export function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function decodeHtml(value) {
  if (!value) return ''
  if (typeof document === 'undefined') return value
  const t = document.createElement('textarea')
  t.innerHTML = value
  return t.value
}

export const meaningOf = (item) => decodeHtml(item.definition || item.uzbek_translation || '')
const meaningType = (item) => (item.definition ? 'definition' : 'translation')

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Finds the word (or a simple inflection of it) inside the example. */
function blankOut(sentence, word) {
  if (!sentence || !word) return null
  const w = decodeHtml(word).trim()
  if (w.length < 2) return null
  const stem = w.length > 4 && /e$/i.test(w) ? w.slice(0, -1) : w
  const re = new RegExp(`\\b${escapeRe(stem)}[a-z]{0,4}\\b`, 'i')
  const m = re.exec(sentence)
  if (!m) return null
  return { before: sentence.slice(0, m.index), after: sentence.slice(m.index + m[0].length), found: m[0] }
}

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

let cachedVoice
export function speak(text) {
  if (!canSpeak() || !text) return
  try {
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new window.SpeechSynthesisUtterance(decodeHtml(text))
    if (cachedVoice === undefined) {
      const voices = synth.getVoices() || []
      cachedVoice =
        voices.find((v) => /en-GB/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null
    }
    if (cachedVoice) u.voice = cachedVoice
    u.lang = cachedVoice?.lang || 'en-GB'
    u.rate = 0.92
    synth.speak(u)
  } catch {
    /* no sound — never break the page */
  }
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/* ---------------- question building ---------------- */

/**
 * items: the words being tested. pool: every word available for wrong
 * options (defaults to items). Returns questions in a shuffled order
 * with a mix of kinds.
 */
export function buildMixedQuestions(items, pool = items) {
  const usable = items.filter((it) => meaningOf(it) && it.word)
  const poolUsable = pool.filter((it) => meaningOf(it) && it.word)
  const words = shuffle(usable)

  const pickOthers = (item, fn, n = 3) => {
    const seen = new Set([fn(item).toLowerCase()])
    const out = []
    const tiers = [
      poolUsable.filter((it) => it.id !== item.id && it.wordlist_id === item.wordlist_id && meaningType(it) === meaningType(item)),
      poolUsable.filter((it) => it.id !== item.id && meaningType(it) === meaningType(item)),
      poolUsable.filter((it) => it.id !== item.id),
    ]
    for (const tier of tiers) {
      for (const it of shuffle(tier)) {
        const v = fn(it)
        if (!v || seen.has(v.toLowerCase())) continue
        seen.add(v.toLowerCase())
        out.push(v)
        if (out.length >= n) return out
      }
    }
    return out
  }

  // Rotate through the kinds so every test has a mix.
  const cycle = ['meaning', 'word', 'gap', 'meaning', 'spell', 'word', 'meaning', 'gap']
  return words
    .map((item, i) => {
      const word = decodeHtml(item.word)
      const meaning = meaningOf(item)
      const base = {
        itemId: item.id,
        // As stored — the database matches review progress on it.
        rawWord: item.word,
        word,
        meaning,
        uzbek: decodeHtml(item.uzbek_translation || ''),
        definition: decodeHtml(item.definition || ''),
        example: decodeHtml(item.example_sentence || ''),
      }
      let kind = cycle[i % cycle.length]
      const gap = blankOut(base.example, word)
      if (kind === 'gap' && !gap) kind = 'word'
      if (kind === 'spell' && word.split(/\s+/).length > 3) kind = 'meaning'

      if (kind === 'meaning') {
        const others = pickOthers(item, meaningOf)
        if (!others.length) return null
        return { ...base, kind, options: shuffle([meaning, ...others]), answer: meaning }
      }
      if (kind === 'word' || kind === 'gap') {
        const others = pickOthers(item, (it) => decodeHtml(it.word))
        if (!others.length) return null
        return { ...base, kind, gap: kind === 'gap' ? gap : null, options: shuffle([word, ...others]), answer: word }
      }
      return { ...base, kind: 'spell', answer: word }
    })
    .filter(Boolean)
}

const normalise = (s) =>
  decodeHtml(s || '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,!?;:]+|[\s.,!?;:]+$/g, '')

function closeEnough(a, b) {
  // One slip (a letter missing, extra or swapped) — told "almost", still wrong.
  if (Math.abs(a.length - b.length) > 1 || a === b) return false
  let i = 0
  while (i < a.length && a[i] === b[i]) i++
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2))
}

/* ---------------- small visual pieces ---------------- */

export function SpeakButton({ text, className = '', label = 'Listen' }) {
  if (!canSpeak()) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        speak(text)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className={`focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel text-paper transition-transform hover:scale-105 active:scale-95 ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    </button>
  )
}

function Highlighted({ text, word }) {
  const g = blankOut(text, word)
  if (!g) return <>{text}</>
  return (
    <>
      {g.before}
      <mark className="rounded bg-vocab-tint px-0.5 font-semibold text-vocab">{g.found}</mark>
      {g.after}
    </>
  )
}

export function Confetti({ run }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.35,
        dur: 1.4 + Math.random() * 0.9,
        rot: Math.random() * 360,
        drift: (Math.random() - 0.5) * 160,
        colour: ['#94BCEB', '#9ACFAA', '#F2B48A', '#BBA6E6', '#F3D27A'][i % 5],
        w: 6 + Math.random() * 6,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run]
  )
  if (!run || prefersReducedMotion()) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="wp-confetti absolute top-[-12px] rounded-[2px]"
          style={{
            left: `${p.left}%`,
            width: p.w,
            height: p.w * 0.45,
            background: p.colour,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.dur}s`,
            '--drift': `${p.drift}px`,
            '--rot': `${p.rot}deg`,
          }}
        />
      ))}
    </div>
  )
}

function CountUp({ value, duration = 900 }) {
  const [shown, setShown] = useState(prefersReducedMotion() ? value : 0)
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value)
      return
    }
    let raf
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration)
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return shown
}

export function ScoreRing({ percentage, size = 132 }) {
  const r = 52
  const c = 2 * Math.PI * r
  const colour = percentage >= 90 ? 'text-reading' : percentage >= 70 ? 'text-vocab' : 'text-writing'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" stroke="currentColor" strokeWidth="10" className="text-panel-2" />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
          className={`${colour} wp-ring`}
          style={{ strokeDasharray: c, strokeDashoffset: c * (1 - percentage / 100), '--ring-from': c }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold text-paper tabular-nums">
          <CountUp value={percentage} />%
        </span>
      </div>
    </div>
  )
}

/* ---------------- flashcards ---------------- */

const SWIPE_DISTANCE = 90

/**
 * items: words to study (in order). onFinish({known, learning}) when the
 * deck is done; onIndexChange(i) for autosave.
 */
export function Flashcards({ items, initialIndex = 0, onIndexChange, onStartTest, title }) {
  const [deck, setDeck] = useState(items)
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, items.length - 1)))
  const [flipped, setFlipped] = useState(false)
  const [flipKey, setFlipKey] = useState(0)
  const [known, setKnown] = useState(() => new Set())
  const [learning, setLearning] = useState(() => new Set())
  const [drag, setDrag] = useState(null) // {dx}
  const [leaving, setLeaving] = useState(null) // 'left' | 'right'
  const [reverse, setReverse] = useState(false) // front shows the meaning
  const [round, setRound] = useState(1)
  const [done, setDone] = useState(false)
  const startRef = useRef(null)
  const flipTimer = useRef(null)

  useEffect(() => () => clearTimeout(flipTimer.current), [])
  useEffect(() => {
    onIndexChange?.(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  const item = deck[index]

  const flip = useCallback(() => {
    if (prefersReducedMotion()) {
      setFlipped((f) => !f)
      return
    }
    setFlipKey((k) => k + 1)
    clearTimeout(flipTimer.current)
    flipTimer.current = setTimeout(() => setFlipped((f) => !f), 170)
  }, [])

  const advance = useCallback(
    (verdict) => {
      if (!item || leaving) return
      const id = item.id
      if (verdict === 'know') {
        setKnown((s) => new Set(s).add(id))
        setLearning((s) => {
          const n = new Set(s)
          n.delete(id)
          return n
        })
      } else if (verdict === 'learn') {
        setLearning((s) => new Set(s).add(id))
        setKnown((s) => {
          const n = new Set(s)
          n.delete(id)
          return n
        })
      }
      const go = () => {
        setLeaving(null)
        setDrag(null)
        setFlipped(false)
        if (index + 1 < deck.length) setIndex(index + 1)
        else setDone(true)
      }
      if (verdict && !prefersReducedMotion()) {
        setLeaving(verdict === 'know' ? 'right' : 'left')
        setTimeout(go, 260)
      } else go()
    },
    [item, leaving, index, deck.length]
  )

  const back = () => {
    if (index === 0) return
    setFlipped(false)
    setIndex(index - 1)
  }

  useEffect(() => {
    if (done) return
    const onKey = (e) => {
      if (e.target.closest?.('input, textarea, select')) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        flip()
      } else if (e.key === 'ArrowRight') advance('know')
      else if (e.key === 'ArrowLeft') advance('learn')
      else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'p') speak(item?.word)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flip, advance, done, item])

  const onPointerDown = (e) => {
    if (leaving) return
    startRef.current = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    const s = startRef.current
    if (!s) return
    const dx = e.clientX - s.x
    if (Math.abs(dx) > 6) s.moved = true
    if (s.moved) setDrag({ dx })
  }
  const onPointerUp = () => {
    const s = startRef.current
    startRef.current = null
    if (!s) return
    if (!s.moved) {
      flip()
      return
    }
    const dx = drag?.dx || 0
    if (dx > SWIPE_DISTANCE) advance('know')
    else if (dx < -SWIPE_DISTANCE) advance('learn')
    else setDrag(null)
  }

  if (done) {
    const learningItems = deck.filter((it) => learning.has(it.id))
    const knownCount = deck.filter((it) => known.has(it.id)).length
    return (
      <div className="wp-pop mx-auto flex w-full max-w-md flex-col items-center gap-4 rounded-[22px] border border-line bg-panel p-6 text-center">
        <p className="text-xs font-medium text-mist">Round {round} done</p>
        <div className="flex w-full justify-center gap-3">
          <div className="flex-1 rounded-2xl bg-reading-tint px-4 py-3">
            <p className="text-3xl font-semibold text-reading tabular-nums">
              <CountUp value={knownCount} />
            </p>
            <p className="text-xs font-medium text-reading">I know</p>
          </div>
          <div className="flex-1 rounded-2xl bg-writing-tint px-4 py-3">
            <p className="text-3xl font-semibold text-writing tabular-nums">
              <CountUp value={learningItems.length} />
            </p>
            <p className="text-xs font-medium text-writing">Still learning</p>
          </div>
        </div>
        <p className="text-sm text-paper-dim">
          {learningItems.length
            ? 'Go through the ones you are still learning once more — short rounds stick better.'
            : 'You know every card. Time to prove it in the test.'}
        </p>
        <div className="flex w-full flex-col gap-2">
          {learningItems.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setDeck(learningItems)
                setIndex(0)
                setLearning(new Set())
                setRound((r) => r + 1)
                setDone(false)
              }}
              className="focus-ring rounded-full bg-brass px-5 py-2.5 text-sm font-semibold text-onbrass hover:bg-brass-dim"
            >
              Study the {learningItems.length} again
            </button>
          )}
          <button
            type="button"
            onClick={() => onStartTest?.()}
            className={`focus-ring rounded-full px-5 py-2.5 text-sm font-semibold ${
              learningItems.length ? 'border border-line text-paper hover:border-brass/50' : 'bg-brass text-onbrass hover:bg-brass-dim'
            }`}
          >
            Start the test
          </button>
          <button
            type="button"
            onClick={() => {
              setDeck(items)
              setIndex(0)
              setKnown(new Set())
              setLearning(new Set())
              setRound(1)
              setDone(false)
            }}
            className="focus-ring text-xs text-mist hover:text-paper"
          >
            Start the cards over
          </button>
        </div>
      </div>
    )
  }

  if (!item) return null

  const dx = leaving === 'right' ? 520 : leaving === 'left' ? -520 : drag?.dx || 0
  const tilt = Math.max(-18, Math.min(18, dx / 14))
  const hint = dx > 30 ? 'know' : dx < -30 ? 'learn' : null
  const front = !flipped // the tinted front face

  const progress = ((index + (leaving ? 1 : 0)) / deck.length) * 100

  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4">
      {title && <p className="text-sm font-semibold text-paper">{title}</p>}

      <div className="flex w-full items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-vocab transition-[width] duration-300" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs tabular-nums text-mist">
          {index + 1}/{deck.length}
        </span>
      </div>
      <div className="flex w-full items-center justify-between text-xs">
        <span className="rounded-full bg-writing-tint px-2.5 py-1 font-medium text-writing">Still learning {learning.size}</span>
        <button
          type="button"
          onClick={() => {
            setReverse((r) => !r)
            setFlipped(false)
          }}
          className="focus-ring rounded-full border border-line px-2.5 py-1 text-mist hover:text-paper"
          title="Choose what the front of the card shows"
        >
          Front: {reverse ? 'meaning' : 'word'}
        </button>
        <span className="rounded-full bg-reading-tint px-2.5 py-1 font-medium text-reading">I know {known.size}</span>
      </div>

      <div className="relative h-[19rem] w-full select-none" style={{ perspective: '900px' }}>
        {/* the next card peeking from underneath */}
        {deck[index + 1] && (
          <div className="absolute inset-x-4 top-3 bottom-[-6px] rounded-[26px] border border-line bg-panel-2" aria-hidden="true" />
        )}
        <div
          key={`${index}-${round}`}
          className={`wp-card-in absolute inset-0 touch-pan-y ${leaving ? 'transition-transform duration-300 ease-in' : drag ? '' : 'transition-transform duration-200'}`}
          style={{ transform: `translateX(${dx}px) rotate(${tilt}deg)`, opacity: leaving ? 0 : 1 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            startRef.current = null
            setDrag(null)
          }}
          role="button"
          tabIndex={0}
          aria-label={front ? (reverse ? 'Card front: the meaning. Press space to flip.' : `Card: ${decodeHtml(item.word)}. Press space to flip.`) : 'Card back. Press space to flip.'}
        >
          <div
            key={flipKey}
            className={`${flipKey ? 'wp-flip' : ''} relative flex h-full w-full cursor-grab flex-col overflow-hidden rounded-[26px] border shadow-[0_10px_30px_-12px_rgba(31,35,64,0.25)] active:cursor-grabbing ${
              front ? 'border-[#F3D27A] bg-vocab-tint' : 'border-line bg-panel'
            }`}
          >
            {/* swipe stamps */}
            <span
              className={`pointer-events-none absolute left-5 top-5 rotate-[-12deg] rounded-lg border-2 border-reading px-2 py-0.5 text-sm font-bold uppercase text-reading transition-opacity ${hint === 'know' ? 'opacity-100' : 'opacity-0'}`}
            >
              I know it
            </span>
            <span
              className={`pointer-events-none absolute right-5 top-5 rotate-[12deg] rounded-lg border-2 border-writing px-2 py-0.5 text-sm font-bold uppercase text-writing transition-opacity ${hint === 'learn' ? 'opacity-100' : 'opacity-0'}`}
            >
              Learning
            </span>

            {!flipped && !reverse && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <span className="text-[2rem] font-semibold leading-tight text-paper">{decodeHtml(item.word)}</span>
                <SpeakButton text={item.word} />
                <span className="mt-2 text-xs text-vocab">Tap or press space to flip</span>
              </div>
            )}
            {!flipped && reverse && (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                {item.definition && <p className="text-[15px] leading-relaxed text-paper">{decodeHtml(item.definition)}</p>}
                {item.uzbek_translation && (
                  <p className="rounded-lg bg-panel/70 px-2.5 py-1 text-sm font-medium text-vocab">{decodeHtml(item.uzbek_translation)}</p>
                )}
                <span className="mt-2 text-xs text-vocab">Which word is it? Flip to check.</span>
              </div>
            )}
            {flipped && (
              <div className="flex flex-1 flex-col justify-center gap-3 overflow-y-auto px-6 py-6 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-semibold text-paper">{decodeHtml(item.word)}</span>
                  <SpeakButton text={item.word} className="h-8 w-8" />
                </div>
                {item.definition && <p className="text-[15px] leading-relaxed text-paper">{decodeHtml(item.definition)}</p>}
                {item.uzbek_translation && (
                  <p className="w-fit rounded-lg bg-vocab-tint px-2.5 py-1 text-sm font-medium text-vocab">{decodeHtml(item.uzbek_translation)}</p>
                )}
                {item.example_sentence && (
                  <p className="border-l-2 border-[#F3D27A] pl-3 text-sm italic leading-relaxed text-paper-dim">
                    <Highlighted text={decodeHtml(item.example_sentence)} word={item.word} />
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid w-full grid-cols-[auto_1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={back}
          disabled={index === 0}
          title="Previous card"
          aria-label="Previous card"
          className="focus-ring flex h-11 w-11 items-center justify-center rounded-full border border-line text-mist hover:text-paper disabled:opacity-30"
        >
          ↶
        </button>
        <button
          type="button"
          onClick={() => advance('learn')}
          className="focus-ring whitespace-nowrap rounded-full border border-writing/40 bg-writing-tint px-2 py-2.5 text-[13px] font-semibold text-writing transition-transform hover:scale-[1.02] active:scale-95 sm:px-3 sm:text-sm"
        >
          ← Learning
        </button>
        <button
          type="button"
          onClick={flip}
          title="Flip (space)"
          aria-label="Flip the card"
          className="focus-ring flex h-11 w-11 items-center justify-center rounded-full border border-line text-paper hover:border-brass/50"
        >
          ⟲
        </button>
        <button
          type="button"
          onClick={() => advance('know')}
          className="focus-ring whitespace-nowrap rounded-full border border-reading/40 bg-reading-tint px-2 py-2.5 text-[13px] font-semibold text-reading transition-transform hover:scale-[1.02] active:scale-95 sm:px-3 sm:text-sm"
        >
          I know it →
        </button>
      </div>
      <p className="text-center text-[11px] text-mist">Swipe the card, or use ← → and space.</p>
      {onStartTest && (
        <button type="button" onClick={onStartTest} className="focus-ring text-xs font-medium text-mist underline-offset-2 hover:text-paper hover:underline">
          Skip to the test
        </button>
      )}
    </div>
  )
}

/* ---------------- quiz ---------------- */

const KIND_LABEL = {
  meaning: 'What does it mean?',
  word: 'Which word is it?',
  gap: 'Complete the sentence',
  spell: 'Type the word',
}

const STREAK_WORDS = { 3: 'Three in a row!', 5: 'Five in a row!', 8: 'On fire — eight!', 10: 'Ten in a row!', 15: 'Unstoppable!' }

/**
 * questions: from buildMixedQuestions. initial: saved state to resume.
 * onSnapshot(state) after every step (for autosave). onFinish(detail)
 * with first-try answers only.
 */
export function QuizRunner({ questions, initial, onSnapshot, onFinish, label }) {
  const [state, setState] = useState(
    () =>
      initial || {
        queue: questions.map((q) => ({ ...q, retry: false })),
        index: 0,
        detail: [],
        streak: 0,
        best: 0,
      }
  )
  const [picked, setPicked] = useState(null) // {value, correct, almost}
  const [typed, setTyped] = useState('')
  const [cheer, setCheer] = useState('')
  const inputRef = useRef(null)
  const continueRef = useRef(null)

  const q = state.queue[state.index]
  const firstTryTotal = state.queue.filter((x) => !x.retry).length
  const answeredFirst = state.detail.length

  useEffect(() => {
    onSnapshot?.(state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    setTyped('')
    setPicked(null)
    if (q?.kind === 'spell') setTimeout(() => inputRef.current?.focus(), 60)
  }, [state.index, q?.kind])

  useEffect(() => {
    if (!cheer) return
    const t = setTimeout(() => setCheer(''), 1400)
    return () => clearTimeout(t)
  }, [cheer])

  const submit = useCallback(
    (value) => {
      if (!q || picked) return
      const correct =
        q.kind === 'spell' ? normalise(value) === normalise(q.answer) : value === q.answer
      const almost = q.kind === 'spell' && !correct && closeEnough(normalise(value), normalise(q.answer))
      setPicked({ value, correct, almost })
      setState((s) => {
        const next = { ...s }
        if (!q.retry) {
          next.detail = [...s.detail, { word: q.rawWord ?? q.word, itemId: q.itemId, correct: q.answer, chosen: value, isCorrect: correct, kind: q.kind, meaning: q.meaning }]
        }
        if (correct) {
          next.streak = s.streak + 1
          next.best = Math.max(s.best, next.streak)
        } else {
          next.streak = 0
          // Second chance at the end — once.
          if (!q.retry) next.queue = [...s.queue, { ...q, retry: true }]
        }
        return next
      })
      if (correct) {
        const n = state.streak + 1
        if (STREAK_WORDS[n]) setCheer(STREAK_WORDS[n])
      }
      setTimeout(() => continueRef.current?.focus(), 30)
    },
    [q, picked, state.streak]
  )

  const next = useCallback(() => {
    if (!picked) return
    if (state.index + 1 >= state.queue.length) {
      onFinish?.(state.detail, state)
      return
    }
    setState((s) => ({ ...s, index: s.index + 1 }))
  }, [picked, state, onFinish])

  // Correct multiple-choice answers move on by themselves.
  useEffect(() => {
    if (!picked?.correct || q?.kind === 'spell') return
    const t = setTimeout(next, 1100)
    return () => clearTimeout(t)
  }, [picked, q?.kind, next])

  useEffect(() => {
    const onKey = (e) => {
      if (picked && e.key === 'Enter') {
        e.preventDefault()
        next()
        return
      }
      if (picked || !q?.options) return
      if (e.target.closest?.('input, textarea')) return
      const n = Number(e.key)
      if (n >= 1 && n <= q.options.length) submit(q.options[n - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [picked, q, next, submit])

  if (!q) return null

  const progress = (state.index / state.queue.length) * 100

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-vocab transition-[width] duration-500" style={{ width: `${progress}%` }} />
        </div>
        <span className="text-xs tabular-nums text-mist">
          {Math.min(answeredFirst + (q.retry ? 0 : 1), firstTryTotal)}/{firstTryTotal}
        </span>
        <span
          key={state.streak}
          className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
            state.streak >= 3 ? 'wp-bump bg-writing-tint text-writing' : 'bg-panel-2 text-mist'
          }`}
          title="Correct answers in a row"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            <path d="M12 2c1 3.5-1.5 5-1.5 7.5A2.5 2.5 0 0 0 13 12c1.7 0 2.5-1.6 2.2-3.4C17.8 10.4 19 13 19 15a7 7 0 0 1-14 0c0-4 3.5-6.5 7-13Z" />
          </svg>
          {state.streak}
        </span>
      </div>

      {cheer && (
        <div className="wp-cheer pointer-events-none self-center rounded-full bg-writing px-3 py-1 text-xs font-semibold text-white">
          {cheer}
        </div>
      )}

      <div
        key={state.index}
        className={`wp-pop flex flex-col gap-4 rounded-[22px] border bg-panel p-5 sm:p-6 ${
          picked ? (picked.correct ? 'border-reading/50' : 'wp-shake border-writing/50') : 'border-line'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-mist">{label ? `${label} · ` : ''}{KIND_LABEL[q.kind]}</span>
          {q.retry && <span className="rounded-full bg-speaking-tint px-2 py-0.5 text-[11px] font-semibold text-speaking">Second chance</span>}
        </div>

        {q.kind === 'meaning' && (
          <div className="flex items-center justify-center gap-2 py-2">
            <p className="text-center text-2xl font-semibold text-paper">{q.word}</p>
            <SpeakButton text={q.word} className="h-8 w-8" />
          </div>
        )}
        {q.kind === 'word' && (
          <div className="rounded-2xl bg-vocab-tint px-4 py-3 text-center">
            <p className="text-[15px] leading-relaxed text-paper">{q.meaning}</p>
            {q.definition && q.uzbek && q.meaning !== q.uzbek && picked && (
              <p className="mt-1 text-xs font-medium text-vocab">{q.uzbek}</p>
            )}
          </div>
        )}
        {q.kind === 'gap' && q.gap && (
          <p className="rounded-2xl bg-vocab-tint px-4 py-3 text-[15px] leading-relaxed text-paper">
            {q.gap.before}
            <span className={`mx-0.5 inline-block min-w-[5rem] border-b-2 px-1 text-center font-semibold ${picked ? (picked.correct ? 'border-reading text-reading' : 'border-writing text-writing') : 'border-vocab text-transparent'}`}>
              {picked ? q.gap.found : '_'}
            </span>
            {q.gap.after}
          </p>
        )}
        {q.kind === 'spell' && (
          <div className="flex flex-col gap-2 rounded-2xl bg-vocab-tint px-4 py-3">
            {q.definition && <p className="text-[15px] leading-relaxed text-paper">{q.definition}</p>}
            {q.uzbek && <p className="text-sm font-medium text-vocab">{q.uzbek}</p>}
            <div className="flex items-center gap-2 text-xs text-vocab">
              <SpeakButton text={q.word} className="h-8 w-8" label="Hear the word" />
              {canSpeak() ? 'Listen, then type it' : 'Type the word'}
            </div>
          </div>
        )}

        {q.options ? (
          <div className="flex flex-col gap-2">
            {q.options.map((opt, i) => {
              const isAnswer = opt === q.answer
              const isPicked = picked?.value === opt
              let tone = 'border-line bg-panel hover:border-brass/50 hover:bg-panel-2'
              if (picked) {
                if (isAnswer) tone = 'border-reading bg-reading-tint text-reading'
                else if (isPicked) tone = 'border-writing bg-writing-tint text-writing'
                else tone = 'border-line opacity-45'
              }
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => submit(opt)}
                  disabled={Boolean(picked)}
                  className={`focus-ring flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-sm text-paper transition-all duration-200 ${tone} ${isPicked ? 'wp-press' : ''}`}
                >
                  <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold ${picked && isAnswer ? 'bg-reading text-white' : picked && isPicked ? 'bg-writing text-white' : 'bg-panel-2 text-mist'}`}>
                    {picked && isAnswer ? '✓' : picked && isPicked ? '✕' : i + 1}
                  </span>
                  <span className="leading-snug">{opt}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (picked) next()
              else if (typed.trim()) submit(typed)
            }}
          >
            <input
              ref={inputRef}
              value={picked ? picked.value : typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={Boolean(picked)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Type here…"
              className={`focus-ring min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-base text-paper ${
                picked ? (picked.correct ? 'border-reading bg-reading-tint' : 'border-writing bg-writing-tint') : 'border-line bg-panel'
              }`}
            />
            {!picked && (
              <button type="submit" disabled={!typed.trim()} className="focus-ring rounded-xl bg-brass px-4 text-sm font-semibold text-onbrass disabled:opacity-40">
                Check
              </button>
            )}
          </form>
        )}

        {picked && (
          <div className="wp-pop flex flex-col gap-2 rounded-2xl border border-line bg-panel-2 px-4 py-3">
            <p className={`text-sm font-semibold ${picked.correct ? 'text-reading' : 'text-writing'}`}>
              {picked.correct
                ? ['Correct!', 'Well done!', 'Yes — exactly.', 'Spot on.'][state.index % 4]
                : picked.almost
                  ? `Almost — it's spelt "${q.answer}".`
                  : q.kind === 'meaning'
                    ? 'Not this time — the meaning is marked in green.'
                    : `The answer is "${q.answer}".`}
            </p>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-paper">{q.word}</span>
              <SpeakButton text={q.word} className="h-7 w-7" />
              {q.uzbek && <span className="text-sm text-vocab">· {q.uzbek}</span>}
            </div>
            {q.example && (
              <p className="text-sm italic leading-relaxed text-paper-dim">
                <Highlighted text={q.example} word={q.word} />
              </p>
            )}
            {!picked.correct && !q.retry && <p className="text-xs text-mist">This word will come back once at the end.</p>}
            <button
              ref={continueRef}
              type="button"
              onClick={next}
              className="focus-ring mt-1 self-end rounded-full bg-brass px-5 py-2 text-sm font-semibold text-onbrass hover:bg-brass-dim"
            >
              {state.index + 1 >= state.queue.length ? 'See my result' : 'Continue'} ↵
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- results ---------------- */

export function ResultsPanel({ detail, best = 0, title = 'Your result', note, saving, saveFailed, onRetrySave, onPractiseMistakes, onAgain, onExit, exitLabel = 'Done' }) {
  const score = detail.filter((d) => d.isCorrect).length
  const total = detail.length || 1
  const percentage = Math.round((score / total) * 100)
  const wrong = detail.filter((d) => !d.isCorrect)
  const verdict =
    percentage >= 90
      ? { label: 'Excellent!', text: 'These words are yours now.' }
      : percentage >= 70
        ? { label: 'Good work', text: 'A quick look at the missed words will make it perfect.' }
        : { label: 'Keep going', text: 'Study the missed words on cards, then try again — it gets easier every round.' }
  const byKind = ['meaning', 'word', 'gap', 'spell']
    .map((k) => {
      const rows = detail.filter((d) => d.kind === k)
      return rows.length ? { k, right: rows.filter((d) => d.isCorrect).length, n: rows.length } : null
    })
    .filter(Boolean)

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <Confetti run={percentage >= 90 ? 1 : 0} />
      <div className="wp-pop flex flex-col items-center gap-2 rounded-[22px] border border-line bg-panel p-6 text-center">
        <p className="text-xs font-medium text-mist">{title}</p>
        <ScoreRing percentage={percentage} />
        <p className="text-xl font-semibold text-paper">{verdict.label}</p>
        <p className="text-sm text-paper-dim">{note || verdict.text}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2 text-xs">
          <span className="rounded-full bg-panel-2 px-2.5 py-1 text-paper">
            {score} of {detail.length} right first time
          </span>
          {best >= 3 && <span className="rounded-full bg-writing-tint px-2.5 py-1 font-medium text-writing">Best streak {best}</span>}
        </div>
        {byKind.length > 1 && (
          <div className="mt-2 grid w-full grid-cols-2 gap-2 text-left">
            {byKind.map((b) => (
              <div key={b.k} className="rounded-xl bg-panel-2 px-3 py-2">
                <p className="text-[11px] text-mist">{KIND_LABEL[b.k]}</p>
                <p className="text-sm font-semibold text-paper tabular-nums">
                  {b.right}/{b.n}
                </p>
              </div>
            ))}
          </div>
        )}
        {(saving || saveFailed) && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-writing/40 bg-writing-tint px-3 py-2 text-sm text-writing">
            {saving ? (
              'Saving…'
            ) : (
              <>
                Couldn't save your result.
                <button type="button" onClick={onRetrySave} className="focus-ring rounded-md border border-writing/50 px-2 py-0.5 text-xs font-semibold">
                  Retry
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {wrong.length > 0 && (
        <div className="rounded-[22px] border border-line bg-panel p-4">
          <p className="mb-2 text-sm font-semibold text-paper">Words to review ({wrong.length})</p>
          <ul className="flex flex-col gap-1.5">
            {wrong.map((d, i) => (
              <li key={`${d.word}-${i}`} className="wp-pop flex items-start gap-2 rounded-xl bg-panel-2 px-3 py-2 text-sm" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                <SpeakButton text={d.word} className="h-7 w-7 shrink-0" />
                <span>
                  <b className="text-paper">{decodeHtml(d.word)}</b>
                  <span className="text-mist"> — {d.kind === 'meaning' || !d.kind ? d.correct : d.meaning || ''}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {wrong.length > 0 && onPractiseMistakes && (
          <button type="button" onClick={onPractiseMistakes} className="focus-ring rounded-full bg-brass px-5 py-2.5 text-sm font-semibold text-onbrass hover:bg-brass-dim">
            Practise these {wrong.length} on cards
          </button>
        )}
        {onAgain && (
          <button type="button" onClick={onAgain} className="focus-ring rounded-full border border-line px-5 py-2.5 text-sm font-semibold text-paper hover:border-brass/50">
            Take the test again
          </button>
        )}
        <button type="button" onClick={onExit} className="focus-ring text-sm font-medium text-mist hover:text-paper">
          {exitLabel}
        </button>
      </div>
    </div>
  )
}
