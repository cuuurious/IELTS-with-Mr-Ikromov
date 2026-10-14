import { useEffect, useRef, useState } from 'react'
import { isSpeechSupported, speak, stopSpeaking } from '../../lib/speech'

/*
 * "Test information" player (2026-10-14) — our own version of the short
 * animated introduction the official computer test shows before each
 * section (Jasur sent the official Listening one; the Reading and
 * Writing ones were checked on the British Council familiarisation
 * site). Same calm look: one sentence on the left with the key words in
 * red, a grey panel on the right with a round red picture, slides that
 * slide in one after another, read aloud. Our own wordmark instead of
 * the IELTS logo, and drawn here instead of copying their video.
 *
 * Narration uses the browser's English voice (lib/speech) and moves to
 * the next slide when a sentence has been read; without speech it moves
 * on by time.
 */

const RED = '#d6173c'

// ---- pictures -------------------------------------------------------
const Disc = ({ children }) => (
  <div className="tiv-pop relative flex h-[46%] max-h-44 min-h-24 aspect-square items-center justify-center rounded-full" style={{ background: RED }}>
    <div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.12) 50%)' }} />
    <div className="relative flex h-full w-full items-center justify-center">{children}</div>
  </div>
)

const pics = {
  ear: (
    <Disc>
      <svg viewBox="0 0 64 64" className="h-1/2 w-1/2" fill="none">
        <path d="M22 26a12 12 0 1 1 24 0c0 8-8 10-8 18a6 6 0 0 1-12 0" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
        <path d="M29 27a5 5 0 0 1 10 0" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
        <path d="M50 20l5-3M51 27h6M50 34l5 3" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </Disc>
  ),
  book: (
    <Disc>
      <svg viewBox="0 0 64 64" className="h-1/2 w-1/2" fill="none">
        <rect x="8" y="12" width="48" height="32" rx="3" fill="#fff" />
        <path d="M32 16v24M14 20h12M14 26h12M14 32h12M38 20h12M38 26h12M38 32h12" stroke={RED} strokeWidth="2.5" />
        <path d="M26 52h12M32 44v8" stroke="#fff" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </Disc>
  ),
  pen: (
    <Disc>
      <svg viewBox="0 0 64 64" className="h-1/2 w-1/2" fill="none">
        <rect x="12" y="8" width="32" height="44" rx="3" fill="#fff" />
        <path d="M18 18h20M18 25h20M18 32h14" stroke={RED} strokeWidth="2.5" />
        <path d="M54 22L36 46l-5 2 1-5 18-24z" fill="#fff" stroke={RED} strokeWidth="2" />
      </svg>
    </Disc>
  ),
  clock: (
    <Disc>
      <div className="tiv-spin-hand relative flex h-[62%] w-[62%] items-center justify-center rounded-full bg-[#ffffff4d]">
        <div className="flex h-[70%] w-[70%] items-center justify-center rounded-full bg-[#fff]">
          <svg viewBox="0 0 40 40" className="h-2/3 w-2/3" fill="none">
            <path d="M20 8v12l9 6" stroke={RED} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="tiv-hand" />
          </svg>
        </div>
      </div>
    </Disc>
  ),
  parts: (n) => (
    <div className="tiv-pop relative flex h-[70%] flex-col items-center justify-between py-1">
      <div className="absolute inset-y-4 left-1/2 w-1 -translate-x-1/2 bg-[#fff]" />
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="tiv-step relative flex h-10 w-10 items-center justify-center rounded-full text-lg font-bold text-[#fff] sm:h-12 sm:w-12" style={{ background: RED, animationDelay: `${0.25 + i * 0.35}s` }}>
          {i + 1}
        </div>
      ))}
    </div>
  ),
  tasks: (
    <div className="tiv-pop flex gap-5">
      {[1, 2].map((n, i) => (
        <div key={n} className="tiv-step flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold text-[#fff] sm:h-16 sm:w-16" style={{ background: RED, animationDelay: `${0.2 + i * 0.4}s` }}>
          {n}
        </div>
      ))}
    </div>
  ),
  sheet: (badge) => (
    <Disc>
      <div className="relative flex h-[58%] w-[44%] flex-col items-center justify-center rounded-md bg-[#ffffffd9]">
        {badge === '?' ? (
          <span className="text-4xl font-black" style={{ color: RED }}>?</span>
        ) : (
          <div className="flex w-2/3 flex-col gap-1.5">
            {[0, 1, 2].map((i) => <span key={i} className="h-1.5 rounded-full" style={{ background: RED, opacity: 0.6 }} />)}
          </div>
        )}
        {badge && badge !== '?' && (
          <span className="tiv-step absolute -bottom-3 -right-5 flex h-9 min-w-9 items-center justify-center rounded-full border-2 bg-[#fff] px-1.5 text-sm font-bold" style={{ color: RED, borderColor: RED, animationDelay: '0.5s' }}>
            {badge}
          </span>
        )}
      </div>
    </Disc>
  ),
  window: (variant) => (
    <div className="tiv-pop w-[62%] max-w-56 overflow-hidden rounded-md bg-[#fff] shadow-sm">
      <div className="flex h-6 items-center justify-center gap-1 text-[10px] font-bold text-[#fff]" style={{ background: variant === 'timer' ? RED : '#c9c6c2' }}>
        {variant === 'timer' ? (
          <>
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span className="tiv-tick">12:18</span>
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 p-3">
        {variant === 'check'
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="h-3 flex-1 rounded-sm bg-[#cfccc8]" />
                <span className="tiv-step flex h-4 w-4 items-center justify-center rounded-full text-[9px] text-[#fff]" style={{ background: RED, animationDelay: `${0.3 + i * 0.3}s` }}>✓</span>
              </div>
            ))
          : variant === 'listen'
            ? (
              <>
                <span className="tiv-step mx-auto flex h-8 w-8 items-center justify-center rounded-full" style={{ background: RED }}>
                  <svg viewBox="0 0 64 64" className="h-5 w-5" fill="none"><path d="M22 26a12 12 0 1 1 24 0c0 8-8 10-8 18a6 6 0 0 1-12 0" stroke="#fff" strokeWidth="6" strokeLinecap="round" /></svg>
                </span>
                {[0, 1, 2].map((i) => <span key={i} className="h-3 rounded-sm bg-[#cfccc8]" />)}
              </>
            )
            : variant === 'read'
              ? (
                <>
                  <span className="tiv-step mx-auto flex h-8 w-8 items-center justify-center rounded-full" style={{ background: RED }}>
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M8 20h8M12 16v4" /></svg>
                  </span>
                  {[0, 1, 2].map((i) => <span key={i} className="h-3 rounded-sm bg-[#cfccc8]" />)}
                </>
              )
              : (
                <>
                  <span className="h-10 rounded-sm bg-[#cfccc8]" />
                  {[0, 1, 2].map((i) => <span key={i} className="h-1.5 rounded-sm bg-[#cfccc8]" />)}
                </>
              )}
      </div>
    </div>
  ),
  done: (
    <div className="tiv-pop w-[52%] max-w-48 overflow-hidden rounded-md shadow-sm">
      <div className="bg-[#c9c6c2] py-1 text-center text-[10px] font-bold text-[#000]">Test complete</div>
      <div className="flex aspect-[4/5] items-center justify-center text-lg font-bold tracking-tight text-[#fff]" style={{ background: RED }}>
        Mr Ikromov
      </div>
    </div>
  ),
}

// ---- slides -----------------------------------------------------------
// [text, picture]; *words* are printed in red.
export const TEST_INFO = {
  listening: {
    title: 'Listening test',
    titlePic: pics.ear,
    slides: [
      ['Your Listening test takes about *30 minutes.*', pics.clock],
      ['The Listening test is in *4 parts.*', pics.parts(4)],
      ['You will hear each part *once.*', pics.ear],
      ['There are *40 questions.* Each question is worth *one mark.*', pics.sheet('?')],
      ['Listen to and read the *instructions carefully.*', pics.window('listen')],
      ['You have *time to read the questions before you listen.*', pics.window('read')],
      ['Answer the questions *while you listen.*', pics.window('listen')],
      ['Try and answer *all the questions.*', pics.window('check')],
      ['At the end you will have *2 minutes to check your answers.*', pics.clock],
      ['The *timer at the top of the screen* shows how much time you have left.', pics.window('timer')],
      ['At the end of the test, the test will *finish automatically.*', pics.done],
    ],
  },
  reading: {
    title: 'Reading test',
    titlePic: pics.book,
    slides: [
      ['Your Reading test is *60 minutes.*', pics.clock],
      ['There are *40 questions.*', pics.sheet('?')],
      ['Each question is worth *one mark.*', pics.sheet('1')],
      ['Try and answer *all the questions.*', pics.window('check')],
      ['The *timer at the top of the screen* shows how much time you have left.', pics.window('timer')],
      ['At the end of the test, the test will *finish automatically.*', pics.done],
    ],
  },
  writing: {
    title: 'Writing test',
    titlePic: pics.pen,
    slides: [
      ['Your Writing test is *60 minutes.*', pics.clock],
      ['The Writing test is in 2 parts: *Task 1 and Task 2.*', pics.tasks],
      ['In *Task 1* you must write at least *150 words.*', pics.sheet('150')],
      ['In *Task 2* you must write at least *250 words.*', pics.sheet('250')],
      ['Try and spend *no more than 20 minutes for Task 1.*', pics.clock],
      ['The *timer at the top of the screen* shows how much time you have left.', pics.window('timer')],
      ['At the end of the test, the test will *finish automatically.*', pics.done],
    ],
  },
}

const plain = (t) => t.replace(/\*/g, '')
const rich = (t) =>
  t.split(/(\*[^*]+\*)/).map((p, i) =>
    /^\*[^*]+\*$/.test(p) ? (
      <span key={i} style={{ color: RED }}>
        {p.slice(1, -1)}
      </span>
    ) : (
      p
    )
  )

const CSS = `
@keyframes tiv-in { from { opacity: 0; transform: translateX(28px) } to { opacity: 1; transform: none } }
@keyframes tiv-pop { from { opacity: 0; transform: scale(.6) } 70% { transform: scale(1.06) } to { opacity: 1; transform: scale(1) } }
@keyframes tiv-step { from { opacity: 0; transform: scale(.3) } to { opacity: 1; transform: scale(1) } }
@keyframes tiv-hand { from { transform: rotate(-90deg) } to { transform: rotate(0deg) } }
.tiv-text { animation: tiv-in .55s ease-out both }
.tiv-pop { animation: tiv-pop .6s ease-out both .15s }
.tiv-step { animation: tiv-step .4s ease-out both }
.tiv-hand { transform-origin: 20px 20px; animation: tiv-hand 1.4s ease-in-out both .4s }
@media (prefers-reduced-motion: reduce) { .tiv-text, .tiv-pop, .tiv-step, .tiv-hand { animation: none } }
`

export default function TestInfoVideo({ module = 'listening', autoPlay = false, onFinished }) {
  const info = TEST_INFO[module] || TEST_INFO.listening
  const frames = [{ title: true }, ...info.slides.map(([text, pic]) => ({ text, pic }))]
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [started, setStarted] = useState(false)
  const [muted, setMuted] = useState(!isSpeechSupported())
  const tokenRef = useRef(0)
  const timerRef = useRef(null)

  const finish = () => {
    setPlaying(false)
    stopSpeaking()
    onFinished?.()
  }

  // Run one frame: read it aloud (or wait), then go on.
  useEffect(() => {
    if (!playing) return
    const token = ++tokenRef.current
    const frame = frames[idx]
    const words = frame.title ? info.title : plain(frame.text)
    const next = () => {
      if (tokenRef.current !== token) return
      if (idx >= frames.length - 1) finish()
      else setIdx((i) => i + 1)
    }
    const minMs = frame.title ? 2200 : 2600
    const started = Date.now()
    const afterSpeech = () => {
      const wait = Math.max(500, minMs - (Date.now() - started))
      timerRef.current = setTimeout(next, wait)
    }
    if (!muted) {
      speak(words, { onEnd: () => tokenRef.current === token && afterSpeech() }).then((ok) => {
        if (!ok && tokenRef.current === token) timerRef.current = setTimeout(next, Math.max(minMs, words.split(/\s+/).length * 420))
      })
    } else {
      timerRef.current = setTimeout(next, Math.max(minMs, words.split(/\s+/).length * 420))
    }
    return () => {
      clearTimeout(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, idx, muted])

  useEffect(() => () => {
    tokenRef.current++
    clearTimeout(timerRef.current)
    stopSpeaking()
  }, [])

  useEffect(() => {
    if (autoPlay) {
      setStarted(true)
      setPlaying(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const play = () => {
    if (idx >= frames.length - 1 && !playing && started) setIdx(0)
    setStarted(true)
    setPlaying(true)
  }
  const pause = () => {
    tokenRef.current++
    clearTimeout(timerRef.current)
    stopSpeaking()
    setPlaying(false)
  }

  const frame = frames[idx]

  return (
    <div className="overflow-hidden rounded-lg border border-[#e2e8f0] bg-[#fff] text-[#111]">
      <style>{CSS}</style>
      <div className="relative aspect-video w-full select-none" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        {frame.title ? (
          <div key={`t-${idx}`} className="absolute inset-0 flex items-center">
            <span className="absolute left-[4%] top-[8%] text-sm font-bold tracking-tight" style={{ color: RED }}>Mr Ikromov</span>
            <h3 className="tiv-text w-[50%] pl-[4%] text-[clamp(1.4rem,4.2vw,2.6rem)] font-bold" style={{ color: RED }}>
              {info.title}
            </h3>
            <div className="flex w-[50%] items-center justify-center">{info.titlePic}</div>
          </div>
        ) : (
          <div key={`s-${idx}`} className="absolute inset-0 flex items-stretch">
            <p className="tiv-text flex w-[55%] items-center pl-[4%] pr-4 text-[clamp(0.95rem,2.4vw,1.5rem)] font-bold leading-snug">
              <span>{rich(frame.text)}</span>
            </p>
            <div className="flex w-[45%] items-center justify-center bg-[#ebe9e7]">{frame.pic}</div>
          </div>
        )}

        {!playing && (
          <button
            type="button"
            onClick={play}
            className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/35"
            aria-label={started ? 'Play' : 'Play the test information'}
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#fffffff2] shadow-lg">
              <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill={RED}><path d="M7 4l13 8-13 8z" /></svg>
            </span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-[#e2e8f0] px-3 py-2">
        <button
          type="button"
          onClick={playing ? pause : play}
          className="focus-ring flex h-8 w-8 items-center justify-center rounded-full text-[#334155] hover:bg-[#f1f5f9]"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M7 4l13 8-13 8z" /></svg>
          )}
        </button>
        <div className="flex flex-1 gap-1">
          {frames.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                tokenRef.current++
                clearTimeout(timerRef.current)
                stopSpeaking()
                setIdx(i)
              }}
              className="h-1.5 flex-1 rounded-full"
              style={{ background: i <= idx ? RED : '#e2e8f0' }}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
        {isSpeechSupported() && (
          <button
            type="button"
            onClick={() => {
              if (!muted) stopSpeaking()
              setMuted((m) => !m)
            }}
            className="focus-ring flex h-8 w-8 items-center justify-center rounded-full text-[#334155] hover:bg-[#f1f5f9]"
            aria-label={muted ? 'Sound on' : 'Sound off'}
            title={muted ? 'Sound on' : 'Sound off'}
          >
            {muted ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9h4l5-4v14l-5-4H4zM17 9l5 6M22 9l-5 6" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 9h4l5-4v14l-5-4H4zM17 8a5 5 0 0 1 0 8" /></svg>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
