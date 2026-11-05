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
          <p className="truncate text-[15px] font-extrabold text-paper">{w.done ? 'Done for today ✓' : '3 questions · about 3 minutes'}</p>
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

              {phase === 'ready' && (
                <button type="button" onClick={ask} className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] hover:brightness-105">
                  <MicIcon className="h-5 w-5" /> Ask me
                </button>
              )}
              {phase === 'asking' && <p className="text-center text-sm font-bold text-mist">Listen…</p>}
              {phase === 'rec' && (
                <section className="flex flex-col gap-3 rounded-[20px] border-2 border-coral/60 bg-panel p-4">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 animate-pulse rounded-full bg-coral" aria-hidden="true" />
                    <span className="font-brand text-[22px] font-semibold text-paper">{fmtTime(elapsed)}</span>
                    <span className="text-[12px] font-bold text-mist">/ {fmtTime(LIMIT)}</span>
                  </div>
                  <p className="text-[12px] font-semibold text-mist">Answer, give a reason, add a small example.</p>
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
                  {q.model?.answer && (
                    <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
                      <p className="text-[12px] font-extrabold uppercase tracking-wide text-speaking">A Band 8 answer</p>
                      <p className="text-[14px] leading-relaxed text-paper">{q.model.answer}</p>
                      {q.model.phrases?.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                          {q.model.phrases.map(([p, m], k) => (
                            <li key={k} className="rounded-[10px] bg-speaking-tint px-2.5 py-1 text-[12px] font-bold"><span className="text-speaking">{p}</span><span className="text-paper-dim"> — {m}</span></li>
                          ))}
                        </ul>
                      )}
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
