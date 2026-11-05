import { useMemo, useState } from 'react'
import { MicIcon } from './SpeakingFeedback'
import { keyWords, makeGaps, norm, saidPhrase, stem, targets } from '../../lib/textMatch'

export { saidPhrase, targets }

/*
 * GET READY (2026-11-05). Before each question the student sees the words
 * and grammar of a Band 8 answer, does a 30-second practice, then speaks.
 * After speaking: which of those words and structures they really used.
 */
export function highlight(answer, phrases) {
  const text = String(answer || '')
  const keys = (phrases || []).map(([p]) => keyWords(p)[0]).filter(Boolean)
  if (!keys.length) return text
  const parts = text.split(/(\s+)/)
  return parts.map((w, i) => {
    const n = norm(w)
    return n && keys.some((k) => n.startsWith(stem(k))) ? (
      <b key={i} className="font-extrabold text-speaking">{w}</b>
    ) : (
      w
    )
  })
}

function sayAloud(text) {
  try {
    const u = new SpeechSynthesisUtterance(String(text).replace(/\([^)]*\)/g, ' '))
    u.lang = 'en-GB'
    u.rate = 0.92
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch {
    /* no voice in this browser */
  }
}

export function GetReady({ q, onReady, readyLabel = 'I’m ready — ask me', maxGrammar = 3 }) {
  const phrases = q.model?.phrases || []
  const grammar = (q.model?.grammar || []).slice(0, maxGrammar)
  const gaps = useMemo(() => makeGaps(q), [q])
  const options = useMemo(() => [...new Set(gaps.map((g) => g.answer))].sort((a, b) => a.localeCompare(b)), [gaps])
  const [picked, setPicked] = useState({}) // gap index -> word
  const [wrong, setWrong] = useState(null)
  const [tries, setTries] = useState({})
  const right = gaps.filter((g, i) => picked[i] === g.answer).length

  const choose = (i, word) => {
    if (picked[i] === gaps[i].answer) return
    if (word === gaps[i].answer) {
      setPicked((m) => ({ ...m, [i]: word }))
      setWrong(null)
    } else {
      setWrong(`${i}:${word}`)
      setTimeout(() => setWrong(null), 600)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel p-4">
        <p className="text-[12px] font-extrabold uppercase tracking-wide text-speaking">1 · Words to use</p>
        <ul className="flex flex-col gap-1.5">
          {phrases.map(([p, m], k) => (
            <li key={k} className="flex items-start gap-2 rounded-[12px] bg-speaking-tint/50 px-3 py-2">
              <button type="button" onClick={() => sayAloud(p)} aria-label={`Hear “${p}”`} className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel text-speaking hover:brightness-95">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z" /><path d="M16 9a4 4 0 0 1 0 6" /></svg>
              </button>
              <span className="min-w-0 flex-1 text-[14px] leading-snug"><b className="font-extrabold text-paper">{p}</b> <span className="text-paper-dim">— {m}</span></span>
            </li>
          ))}
        </ul>
      </section>

      {grammar.length > 0 && (
        <section className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel p-4">
          <p className="text-[12px] font-extrabold uppercase tracking-wide text-speaking">2 · Grammar to use</p>
          {grammar.map((g, k) => (
            <div key={k} className="flex flex-col gap-1 rounded-[12px] bg-panel-2/70 px-3 py-2.5">
              <p className="text-[14px] font-extrabold text-paper">{g.pattern}</p>
              {g.example && <p className="text-[13px] italic text-paper-dim">“{g.example}”</p>}
              {g.try && (
                <label className="flex flex-col gap-1">
                  <span className="text-[12px] font-bold text-mist">Your turn: {g.try}</span>
                  <input
                    value={tries[k] || ''}
                    onChange={(e) => setTries((m) => ({ ...m, [k]: e.target.value }))}
                    placeholder="Finish the sentence about you (optional)"
                    className="focus-ring h-10 rounded-[10px] border border-line bg-panel px-3 text-[14px] text-paper"
                  />
                </label>
              )}
            </div>
          ))}
        </section>
      )}

      {gaps.length > 0 && (
        <section className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel p-4">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[12px] font-extrabold uppercase tracking-wide text-speaking">3 · Quick practice</p>
            <span className={`rounded-[10px] px-2 py-0.5 text-[12px] font-extrabold ${right === gaps.length ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-paper-dim'}`}>{right}/{gaps.length}</span>
          </div>
          <p className="text-[12px] font-semibold text-mist">Tap the word that fills each gap.</p>
          {gaps.map((g, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-[12px] bg-panel-2/70 px-3 py-2.5">
              <p className="text-[14px] leading-relaxed text-paper">
                {g.before}
                <span className={`mx-0.5 inline-block min-w-[64px] rounded-[8px] px-1.5 text-center font-extrabold ${picked[i] ? 'bg-reading-tint text-reading' : 'border-b-2 border-dashed border-speaking text-transparent'}`}>{picked[i] || '____'}</span>
                {g.after}
              </p>
              {picked[i] !== g.answer && (
                <div className="flex flex-wrap gap-1.5">
                  {options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => choose(i, o)}
                      className={`focus-ring h-8 rounded-[10px] px-2.5 text-[13px] font-bold transition ${wrong === `${i}:${o}` ? 'bg-urgent-tint text-coral' : 'bg-panel text-paper hover:bg-speaking-tint'}`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {right === gaps.length && <p className="text-[13px] font-extrabold text-reading">Well done — now use them in your own answer!</p>}
        </section>
      )}

      <button type="button" onClick={onReady} className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] hover:brightness-105">
        <MicIcon className="h-5 w-5" /> {readyLabel}
      </button>
    </div>
  )
}

// After speaking: the words and grammar from Get ready that the student used.
export function UsedCheck({ q, said }) {
  const list = targets(q)
  const heard = norm(said).split(' ').filter(Boolean).length > 3
  const [ticks, setTicks] = useState({})
  const used = list.map((t) => (heard ? (t.kind === 'phrase' ? saidPhrase(said, t.label) : norm(said).includes(t.stem)) : Boolean(ticks[t.label])))
  const n = used.filter(Boolean).length
  const msg = n === 0 ? 'Next time, try to use one or two of these.' : n >= Math.min(3, list.length) ? 'Excellent — that’s how Band 8 answers sound!' : 'Good start — try to add one more next time.'
  return (
    <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] font-extrabold uppercase tracking-wide text-speaking">{heard ? 'What you used' : 'Tick what you used'}</p>
        <span className={`rounded-[10px] px-2 py-0.5 text-[12px] font-extrabold ${n ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-paper-dim'}`}>{n}/{list.length}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {list.map((t, k) =>
          heard ? (
            <li key={t.label} className={`rounded-[10px] px-2.5 py-1 text-[12px] font-bold ${used[k] ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-mist'}`}>
              {used[k] ? '✓ ' : ''}{t.label}
            </li>
          ) : (
            <li key={t.label}>
              <button type="button" onClick={() => setTicks((m) => ({ ...m, [t.label]: !m[t.label] }))} aria-pressed={Boolean(ticks[t.label])} className={`focus-ring rounded-[10px] px-2.5 py-1 text-[12px] font-bold ${ticks[t.label] ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-paper-dim'}`}>
                {ticks[t.label] ? '✓ ' : ''}{t.label}
              </button>
            </li>
          )
        )}
      </ul>
      <p className="text-[13px] font-bold text-paper">{msg}</p>
    </section>
  )
}
