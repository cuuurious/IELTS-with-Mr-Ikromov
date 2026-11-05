import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { fetchVoice, fmtTime } from '../../lib/speaking'
import { MicIcon } from './SpeakingFeedback'

/*
 * DAILY SPEAKING WARM-UP (2026-11-05, migration_104). Three Part 1
 * questions a day (the same three all day) from the warm-up bank, or
 * from the speaking sets when there is no bank, asked
 * by the examiner's voice. The student answers out loud; where the
 * browser can, it shows what it heard, then the book's model answer and
 * phrases. Finishing pays a small coin bonus once a day. Mr Ikromov can
 * turn it off in Coins & Rewards → Coins & prices.
 */

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
const LIMIT = 40

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' })

// Same order all day for one student.
function seeded(list, seedText) {
  let h = 2166136261
  for (let i = 0; i < seedText.length; i += 1) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619) >>> 0
  const rnd = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0
    return ((h ^= h >>> 16) >>> 0) / 4294967296
  }
  return list
    .map((x) => [rnd(), x])
    .sort((a, b) => a[0] - b[0])
    .map((x) => x[1])
}

function useWarmup(studentId) {
  const [state, setState] = useState(null) // null | { on, coins, done, questions }
  useEffect(() => {
    if (!studentId) return undefined
    let cancelled = false
    ;(async () => {
      const [set, sets, led] = await Promise.all([
        supabase.from('coin_settings').select('speaking_warmup, warmup_coins').eq('id', 1).maybeSingle(),
        supabase.from('speaking_sets').select('id, number, content'),
        supabase.from('coin_ledger').select('id').eq('user_id', studentId).eq('ref_type', 'warmup').eq('ref_key', today()).limit(1),
      ])
      if (cancelled) return
      if (set.error || !set.data?.speaking_warmup || sets.error) return setState({ on: false })
      // Mr Ikromov's warm-up bank (migration_106: "Part 1 · Always in use")
      // is used when it is there: one of its topics a day, its opening
      // question first and two more in the book's order, like the start
      // of a real test. Otherwise any Part 1 questions from the sets.
      const bank = (sets.data || []).filter((s) => s.content?.warmup)
      let picked = []
      if (bank.length) {
        const topics = []
        bank.forEach((s) => (s.content.part1 || []).forEach((t) => t.questions?.length && topics.push({ setId: s.id, t })))
        if (topics.length) {
          const { setId, t } = seeded(topics, `${today()}:${studentId}:topic`)[0]
          const qs = t.questions.map((q, qi) => ({ setId, key: `${setId}-${t.topic}-${qi}`, topic: t.topic, q: q.q, model: q.model || null, qi })).filter((x) => x.q)
          const rest = seeded(qs.slice(1), `${today()}:${studentId}`).slice(0, 2).sort((a, b) => a.qi - b.qi)
          picked = [qs[0], ...rest].filter(Boolean)
        }
      }
      if (picked.length < 3) {
        picked = []
        const all = []
        ;(sets.data || []).forEach((s) =>
          (s.content?.part1 || []).forEach((t, ti) =>
            (t.questions || []).forEach((q, qi) => q?.q && all.push({ setId: s.id, key: `${s.id}-${ti}-${qi}`, topic: t.topic, q: q.q, model: q.model || null }))
          )
        )
        if (all.length < 3) return setState({ on: false })
        // Not two questions on the same topic.
        const order = seeded(all, `${today()}:${studentId}`)
        for (const x of order) {
          if (picked.some((p) => p.topic === x.topic && p.setId === x.setId)) continue
          picked.push(x)
          if (picked.length === 3) break
        }
        // Few topics so far: fill up with other questions.
        for (const x of order) {
          if (picked.length === 3) break
          if (!picked.includes(x)) picked.push(x)
        }
      }
      setState({ on: true, coins: set.data.warmup_coins || 0, done: Boolean(led.data?.length), questions: picked })
    })()
    return () => {
      cancelled = true
    }
  }, [studentId])
  return [state, setState]
}

export function WarmupCard({ studentId, className = '' }) {
  const [w, setW] = useWarmup(studentId)
  const [open, setOpen] = useState(false)
  if (!w?.on) return null
  return (
    <>
      <section className={`flex items-center gap-3 rounded-[20px] border border-line bg-panel p-3 sm:gap-4 sm:p-4 ${className}`}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-speaking-tint text-speaking">
          <MicIcon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-speaking">Speaking warm-up</p>
          <p className="truncate text-[15px] font-extrabold text-paper">{w.done ? 'Done for today ✓' : '3 questions · 3 min'}</p>
          <p className="truncate text-[12px] font-bold text-mist">{[...new Set(w.questions.map((q) => q.topic))].join(' · ')}{!w.done && w.coins ? ` · +${w.coins} coin${w.coins === 1 ? '' : 's'}` : ''}</p>
        </div>
        <button type="button" onClick={() => setOpen(true)} className={`focus-ring h-10 shrink-0 rounded-[12px] px-3.5 text-[13px] font-extrabold ${w.done ? 'bg-panel-2 text-paper' : 'bg-saffron text-[#17213a]'}`}>
          {w.done ? 'Again' : 'Start'}
        </button>
      </section>
      {open && createPortal(<WarmupRunner w={w} onClose={() => setOpen(false)} onDone={() => setW((x) => ({ ...x, done: true }))} />, document.body)}
    </>
  )
}

function WarmupRunner({ w, onClose, onDone }) {
  const [i, setI] = useState(0)
  const [phase, setPhase] = useState('ready') // ready | asking | rec | review | end
  const [voice, setVoice] = useState({})
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState(null) // { url, said, secs }
  const [coinMsg, setCoinMsg] = useState('')
  const audioRef = useRef(null)
  const recRef = useRef(null)
  const streamRef = useRef(null)
  const recogRef = useRef(null)
  const saidRef = useRef('')
  const timerRef = useRef(null)
  const startRef = useRef(0)
  const q = w.questions[i]

  useEffect(() => {
    // The examiner's voice, set by set (only lines in a set are spoken).
    const bySet = {}
    w.questions.forEach((x) => (bySet[x.setId] = [...(bySet[x.setId] || []), x.q]))
    Promise.all(Object.entries(bySet).map(([id, texts]) => fetchVoice(id, texts))).then((all) => setVoice(Object.assign({}, ...all)))
    return () => {
      clearInterval(timerRef.current)
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop())
      } catch {
        /* ignore */
      }
      window.speechSynthesis?.cancel()
    }
  }, [w.questions])

  const ask = () => {
    setTake(null)
    setPhase('asking')
    const done = () => record()
    const url = voice[q.q]
    const a = audioRef.current
    if (url && a) {
      a.src = url
      a.onended = done
      a.onerror = done
      a.play().catch(() => speak())
      return
    }
    speak()
    function speak() {
      try {
        const u = new SpeechSynthesisUtterance(q.q)
        u.lang = 'en-GB'
        u.rate = 0.95
        u.onend = done
        u.onerror = done
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(u)
      } catch {
        setTimeout(done, 1500)
      }
    }
  }

  const record = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks = []
      saidRef.current = ''
      if (Recognition) {
        const r = new Recognition()
        r.lang = 'en-GB'
        r.continuous = true
        r.interimResults = false
        r.onresult = (e) => {
          saidRef.current = Array.from(e.results)
            .map((x) => x[0]?.transcript || '')
            .join(' ')
        }
        try {
          r.start()
          recogRef.current = r
        } catch {
          recogRef.current = null
        }
      }
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const finish = () => {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          setTake({ url: URL.createObjectURL(blob), said: saidRef.current, secs: (Date.now() - startRef.current) / 1000 })
          setPhase('review')
        }
        const r = recogRef.current
        if (r) {
          r.onend = finish
          try {
            r.stop()
          } catch {
            finish()
          }
        } else finish()
      }
      streamRef.current = stream
      recRef.current = rec
      startRef.current = Date.now()
      setElapsed(0)
      rec.start()
      setPhase('rec')
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        const e = (Date.now() - startRef.current) / 1000
        setElapsed(e)
        if (e >= LIMIT) stop()
      }, 250)
    } catch {
      setTake({ error: 'Allow the microphone to answer.' })
      setPhase('review')
    }
  }

  const stop = () => {
    clearInterval(timerRef.current)
    const rec = recRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }

  const next = async () => {
    if (i < w.questions.length - 1) {
      setI(i + 1)
      setPhase('ready')
      setTake(null)
      return
    }
    setPhase('end')
    if (!w.done) {
      const { data, error } = await supabase.rpc('claim_warmup_coins')
      if (!error && w.coins) setCoinMsg(`+${w.coins} coin${w.coins === 1 ? '' : 's'} · you have ${data}`)
      onDone?.()
    }
  }

  const words = take?.said ? take.said.trim().split(/\s+/).filter(Boolean).length : null
  const tip = useMemo(() => {
    if (!take || take.error) return ''
    if (take.secs < 8) return 'Too short — give an answer, a reason and a small example (2–4 sentences).'
    if (take.secs > 38) return 'A bit long for Part 1 — 20–30 seconds is enough.'
    return 'Good length for Part 1.'
  }, [take])

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink">
      <audio ref={audioRef} preload="auto" className="hidden" />
      <div className="registan-band flex shrink-0 items-center gap-2 px-3 py-2 text-white sm:px-4">
        <button type="button" onClick={onClose} className="focus-ring flex h-10 items-center gap-1.5 rounded-[12px] bg-white/15 px-3 text-sm font-extrabold hover:bg-white/25">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          <span className="hidden sm:inline">Back</span>
        </button>
        <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold">Speaking warm-up</p>
        {phase !== 'end' && <span className="grid h-10 min-w-[56px] place-items-center rounded-[12px] bg-white px-2 font-brand text-[14px] font-semibold text-speaking">{i + 1}/{w.questions.length}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-6">
          {phase === 'end' ? (
            <section className="flex flex-col items-center gap-3 rounded-[20px] border border-line bg-panel p-6 text-center">
              <p className="font-brand text-[22px] font-semibold text-paper">Warm-up done ✓</p>
              {coinMsg && <p className="rounded-[12px] bg-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-panel))] px-3 py-1.5 text-sm font-extrabold text-amber">{coinMsg}</p>}
              <p className="text-sm font-semibold text-mist">Come back tomorrow for three new questions.</p>
              <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a]">Close</button>
            </section>
          ) : (
            <>
              <section className="registan-band flex flex-col gap-2 rounded-[24px] p-5 text-white">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Part 1 · {q.topic}</p>
                <p className="font-brand text-[20px] font-semibold leading-snug">{q.q}</p>
              </section>

              {phase === 'ready' &&
                (q.model?.phrases?.length || q.model?.grammar?.length ? (
                  <GetReady key={q.key} q={q} onReady={ask} />
                ) : (
                  <button type="button" onClick={ask} className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] hover:brightness-105">
                    <MicIcon className="h-5 w-5" /> Ask me
                  </button>
                ))}
              {phase === 'asking' && <p className="text-center text-sm font-bold text-mist">Listen…</p>}
              {phase === 'rec' && (
                <section className="flex flex-col gap-3 rounded-[20px] border-2 border-coral/60 bg-panel p-4">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-coral" aria-hidden="true" />
                    <span className="font-brand text-[22px] font-semibold text-paper">{fmtTime(elapsed)}</span>
                    <span className="text-[12px] font-bold text-mist">/ {fmtTime(LIMIT)}</span>
                  </div>
                  <p className="text-[12px] font-semibold text-mist">Answer, give a reason, add a small example.</p>
                  {targets(q).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-extrabold text-paper-dim">Try to use:</span>
                      {targets(q).map((t) => (
                        <span key={t.label} className="rounded-[10px] bg-speaking-tint px-2 py-0.5 text-[12px] font-bold text-speaking">{t.label}</span>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={stop} disabled={elapsed < 1.5} className="focus-ring h-12 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] disabled:opacity-50">I’ve finished</button>
                </section>
              )}
              {phase === 'review' && (
                <>
                  <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
                    {take?.error ? (
                      <p className="text-sm font-bold text-coral">{take.error}</p>
                    ) : (
                      <>
                        <audio src={take?.url} controls className="h-9 w-full" />
                        {take?.said && <p className="text-[13px] leading-relaxed text-paper-dim"><b className="text-mist">We heard: </b>{take.said}</p>}
                        <p className="text-[12px] font-bold text-speaking">{Math.round(take?.secs || 0)} seconds{words != null ? ` · about ${words} words` : ''} · {tip}</p>
                      </>
                    )}
                  </section>
                  {!take?.error && targets(q).length > 0 && <UsedCheck key={`${q.key}-${take?.url}`} q={q} said={take?.said || ''} />}
                  {q.model?.answer && (
                    <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
                      <p className="text-[12px] font-extrabold uppercase tracking-wide text-speaking">A Band 8 answer</p>
                      <p className="text-[14px] leading-relaxed text-paper">{highlight(q.model.answer, q.model.phrases)}</p>
                      {q.model.phrases?.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {q.model.phrases.map(([p, m], k) => (
                            <li key={k} className="rounded-[10px] bg-speaking-tint px-2.5 py-1 text-[12px] font-bold"><span className="text-speaking">{p}</span><span className="text-paper-dim"> — {m}</span></li>
                          ))}
                        </ul>
                      )}
                      {q.model.phrases?.length > 0 && <SavePhrases phrases={q.model.phrases} answer={q.model.answer} topic={q.topic} />}
                    </section>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={ask} className="focus-ring h-11 flex-1 rounded-[14px] bg-panel text-sm font-extrabold text-paper hover:bg-panel-2">Try again</button>
                    <button type="button" onClick={next} className="focus-ring h-11 flex-1 rounded-[14px] bg-saffron text-sm font-extrabold text-[#17213a] hover:brightness-105">{i < w.questions.length - 1 ? 'Next question' : 'Finish'}</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Keep the phrases (2026-11-05): they go into My words and come back in
// the daily word review.
function SavePhrases({ phrases, answer, topic }) {
  const [state, setState] = useState('')
  const save = async () => {
    setState('saving')
    const sentences = String(answer || '').split(/(?<=[.!?])\s+/)
    const rows = phrases.map(([p, m]) => {
      const key = String(p).replace(/\(.*?\)/g, '').trim().toLowerCase().split(' ')[0]
      const ex = sentences.find((x) => x.toLowerCase().includes(key)) || null
      return { word: String(p).slice(0, 120), definition: String(m || '').slice(0, 400) || null, example_sentence: ex, source: `Speaking warm-up · ${topic || 'Part 1'}` }
    })
    const { error } = await supabase.from('student_words').upsert(rows, { onConflict: 'user_id,word', ignoreDuplicates: true })
    setState(error ? 'error' : 'done')
  }
  return (
    <button type="button" onClick={save} disabled={state === 'saving' || state === 'done'} className="focus-ring self-start text-[12px] font-extrabold text-brass disabled:opacity-70">
      {state === 'done' ? '✓ Saved to My words' : state === 'error' ? 'Could not save — try again' : state === 'saving' ? 'Saving…' : '+ Save these phrases to My words'}
    </button>
  )
}

/*
 * GET READY (2026-11-05). Before each question the student sees the words
 * and grammar of a Band 8 answer, does a 30-second practice, then speaks.
 * After speaking: which of those words and structures they really used.
 */
const norm = (t) =>
  String(t || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const STOP = new Set(['a', 'an', 'the', 'be', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with', 'your', 'someone', "someone's", 'something', 'sb', 'sth', 'it', 'is', 'are'])
const keyWords = (phrase) =>
  norm(String(phrase).replace(/\([^)]*\)/g, ' '))
    .split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
const stem = (w) => w.replace(/'s$/, '').slice(0, Math.max(3, Math.min(5, w.length - 1)))
function saidPhrase(said, phrase) {
  const ks = keyWords(phrase)
  if (!ks.length) return false
  const words = norm(said).split(' ')
  return ks.every((k) => words.some((w) => w.startsWith(stem(k))))
}
// The fixed start of a grammar "Try it" frame: "I'm majoring in ______." → "i'm majoring in".
function frameStem(tryText) {
  const t = norm(String(tryText || '').split(/_{2,}|…/).find((x) => norm(x).split(' ').filter(Boolean).length >= 2) || '')
  return t.split(' ').filter(Boolean).length >= 2 ? t : ''
}

function targets(q) {
  const out = []
  ;(q.model?.phrases || []).forEach(([p, m]) => out.push({ kind: 'phrase', label: String(p), meaning: m }))
  ;(q.model?.grammar || []).forEach((g) => {
    const st = frameStem(g.try)
    if (st) out.push({ kind: 'grammar', label: g.pattern, stem: st })
  })
  return out
}

function highlight(answer, phrases) {
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

// One gap per phrase: a sentence of the model answer with the phrase's key word blanked.
function makeGaps(q) {
  const phrases = (q.model?.phrases || []).map(([p]) => String(p))
  const sentences = String(q.model?.answer || '').split(/(?<=[.!?])\s+/)
  const gaps = []
  phrases.forEach((p) => {
    const k = keyWords(p)[0]
    if (!k) return
    const sIdx = sentences.findIndex((x) => norm(x).split(' ').some((w) => w.startsWith(stem(k))))
    if (sIdx < 0) return
    const words = sentences[sIdx].split(/(\s+)/)
    const wIdx = words.findIndex((w) => norm(w) && norm(w).startsWith(stem(k)))
    if (wIdx < 0) return
    const answer = words[wIdx].replace(/[^A-Za-z'’-]/g, '')
    const trail = words[wIdx].slice(words[wIdx].indexOf(answer) + answer.length)
    gaps.push({ phrase: p, before: words.slice(0, wIdx).join(''), after: trail + words.slice(wIdx + 1).join(''), answer })
  })
  return gaps.slice(0, 3)
}

function GetReady({ q, onReady }) {
  const phrases = q.model?.phrases || []
  const grammar = q.model?.grammar || []
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
        <MicIcon className="h-5 w-5" /> I’m ready — ask me
      </button>
    </div>
  )
}

// After speaking: the words and grammar from Get ready that the student used.
function UsedCheck({ q, said }) {
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
