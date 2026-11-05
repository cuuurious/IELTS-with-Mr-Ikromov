import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { LIMITS, SPEAKING_PARTS, buildSteps, fetchVoice, fmtTime, linesOf, loadSpeakingSet, modelFor, parseSpeakingUrl, setTitle, withMockPart1 } from '../../lib/speaking'
import SpeakingFeedback, { MicIcon } from './SpeakingFeedback'
import { GetReady, targets } from './speakingPrep'

/*
 * SPEAKING TEST SCREEN (2026-11-05). Works like the real test: the
 * examiner asks each question out loud (a natural recorded voice), the
 * student's answer is recorded straight away, and "I've finished" moves
 * on. Part 2 shows the cue card with one minute to prepare and notes,
 * then up to two minutes of speaking. At the end the student hands in;
 * the recordings are marked by AI (band per criterion, comments, their
 * answer at Band 8, "Say it better" sentences, exercises).
 *
 * Props: task (homework task, html_url "speaking:<set>#part"), studentId,
 * onClose, onChanged. `preview` (teachers): no hand-in, model answers at
 * the end.
 */

const pickMime = () => {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m
    } catch {
      /* ignore */
    }
  }
  return ''
}

// A tiny silent sound, played inside the Start tap so phones let the
// examiner's voice play afterwards.
function silentWav() {
  const n = 800
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const w = (o, str) => [...str].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
  w(0, 'RIFF')
  v.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 16000, true)
  v.setUint32(28, 32000, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  w(36, 'data')
  v.setUint32(40, n * 2, true)
  let bin = ''
  new Uint8Array(buf).forEach((x) => (bin += String.fromCharCode(x)))
  return `data:audio/wav;base64,${btoa(bin)}`
}

// A slim live microphone level (so students see they are being heard).
function Level({ analyser, on }) {
  const [bars, setBars] = useState(Array(14).fill(0.08))
  useEffect(() => {
    if (!analyser || !on) {
      setBars(Array(14).fill(0.08))
      return undefined
    }
    const data = new Uint8Array(analyser.frequencyBinCount)
    let raf
    const tick = () => {
      analyser.getByteFrequencyData(data)
      const step = Math.floor(data.length / 28)
      setBars(Array.from({ length: 14 }, (_, i) => Math.max(0.08, Math.min(1, data[(i + 1) * step] / 200))))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [analyser, on])
  return (
    <span className="flex h-7 items-center gap-[3px]" aria-hidden="true">
      {bars.map((b, i) => (
        <span key={i} className="w-[4px] rounded-full bg-coral transition-[height] duration-75" style={{ height: `${Math.round(6 + b * 22)}px` }} />
      ))}
    </span>
  )
}

// The examiner "speaking" — soft moving bars, no robot face.
function Voice({ on }) {
  return (
    <span className="flex h-6 items-end gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={`w-[4px] rounded-full bg-white/90 ${on ? 'animate-pulse' : ''}`} style={{ height: on ? `${10 + ((i * 7) % 14)}px` : '6px', animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  )
}

export default function SpeakingTask({ task, studentId, onClose, onChanged, preview = false, mock = null }) {
  // mock (2026-11-05): a speaking mock ({ id, status, band, results }) from
  // speaking_mocks instead of a homework task; marked the same way.
  const table = mock ? 'speaking_mocks' : 'homework_attempts'
  const markBody = (id) => (mock ? { action: 'speaking_task', mockId: id } : { action: 'speaking_task', attemptId: id })
  const ref = useMemo(() => parseSpeakingUrl(task.html_url), [task.html_url])
  const [set, setSet] = useState(null)
  const [stage, setStage] = useState('loading') // loading | intro | run | review | saving | feedback | error
  const [error, setError] = useState('')
  const [voice, setVoice] = useState(null) // text -> url (null while loading)
  const [idx, setIdx] = useState(0)
  const [speaking, setSpeaking] = useState(false)
  const [takes, setTakes] = useState({}) // key -> { blob, url, secs }
  const [recKey, setRecKey] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [prepLeft, setPrepLeft] = useState(LIMITS.prep)
  const [notes, setNotes] = useState({})
  const [showText, setShowText] = useState(true)
  const [attempt, setAttempt] = useState(null) // latest handed-in attempt (results)
  const [analyser, setAnalyser] = useState(null)

  const streamRef = useRef(null)
  const audioRef = useRef(null)
  const recRef = useRef(null)
  const chunksRef = useRef([])
  const startedAtRef = useRef(0)
  const timerRef = useRef(null)
  const ctxRef = useRef(null)
  const stepsRef = useRef([])
  const idxRef = useRef(0)
  const stoppedRef = useRef(false)

  const part = ref?.part || 'full'
  // Homework (2026-11-05): before each question a "Get ready" step with the
  // words, grammar and a quick practice from its Band 8 answer. Mocks and
  // the teacher preview keep the real-test flow.
  const coached = !mock && !preview
  const steps = useMemo(() => {
    if (!set) return []
    const base = buildSteps(set.content, part)
    if (!coached) return base
    const has = (key) => {
      const m = modelFor(set.content, key)
      return Boolean(m?.phrases?.length || m?.grammar?.length)
    }
    const out = []
    base.forEach((st, i) => {
      const nx = base[i + 1]
      if (st.type === 'say' && nx?.type === 'answer' && !nx.long && has(nx.key)) out.push({ type: 'ready', key: nx.key, q: nx.q })
      if (st.type === 'say' && nx?.type === 'cue') {
        const long = base.find((x) => x.type === 'answer' && x.long)
        if (long && has(long.key)) out.push({ type: 'ready', key: long.key, q: long.q, long: true })
      }
      out.push(st)
    })
    return out
  }, [set, part, coached])
  stepsRef.current = steps
  const answerSteps = useMemo(() => steps.filter((s) => s.type === 'answer'), [steps])
  const step = steps[idx] || null

  // ---------- load the set and the latest handed-in try ----------
  useEffect(() => {
    let cancelled = false
    if (!ref) {
      setError('This speaking test link is broken.')
      setStage('error')
      return undefined
    }
    ;(async () => {
      try {
        let s = await loadSpeakingSet(ref.setId)
        // A mock on a Part 2 & 3 topic gets its Part 1 from the Part 1 bank.
        if (mock && ref.part === 'full') s = await withMockPart1(s, mock.id).catch(() => s)
        if (cancelled) return
        setSet(s)
        if (mock?.results?.speaking) {
          setAttempt({ id: mock.id, attempt_no: 1, submitted_at: mock.submitted_at, band: mock.band, results: mock.results })
          setStage('feedback')
          return
        }
        if (!preview && !mock && task.id && studentId) {
          const { data } = await supabase
            .from('homework_attempts')
            .select('id, attempt_no, submitted_at, band, results')
            .eq('task_id', task.id)
            .eq('user_id', studentId)
            .not('submitted_at', 'is', null)
            .order('submitted_at', { ascending: false })
            .limit(1)
          if (cancelled) return
          const last = data?.[0]
          if (last?.results?.speaking) {
            setAttempt(last)
            setStage('feedback')
            return
          }
        }
        setStage('intro')
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not open the test.')
          setStage('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ref, task.id, studentId, preview, mock])

  // Prepare the examiner's voice while the student reads the intro.
  useEffect(() => {
    if (!set || stage !== 'intro' || voice) return
    let cancelled = false
    // Borrowed Part 1 topics (mocks) are voiced from their own sets.
    const borrowed = (set.content?.part1 || []).filter((t) => t.from)
    Promise.all([
      fetchVoice(set.id, linesOf(steps)),
      ...borrowed.map((t) => fetchVoice(t.from, [t.intro, ...(t.questions || []).map((q) => q.q)].map((x) => String(x || '').replace(/\s+/g, ' ').trim()).filter(Boolean))),
    ]).then((all) => !cancelled && setVoice(Object.assign({}, ...all)))
    const t = setTimeout(() => !cancelled && setVoice((v) => v || {}), 45000)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [set, stage, steps, voice])

  // While marking, check every few seconds.
  useEffect(() => {
    if (stage !== 'feedback' || attempt?.results?.ai?.status !== 'processing') return undefined
    const t = setInterval(async () => {
      const { data } = await supabase.from(table).select(mock ? 'id, submitted_at, band, results' : 'id, attempt_no, submitted_at, band, results').eq('id', attempt.id).maybeSingle()
      if (data && data.results?.ai?.status !== 'processing') {
        setAttempt(data)
        onChanged?.()
      }
    }, 5000)
    return () => clearInterval(t)
  }, [stage, attempt, onChanged, table])

  // ---------- clean up ----------
  const stopAll = useCallback(() => {
    stoppedRef.current = true
    clearInterval(timerRef.current)
    try {
      audioRef.current?.pause()
    } catch {
      /* ignore */
    }
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* ignore */
    }
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
    } catch {
      /* ignore */
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    try {
      ctxRef.current?.close()
    } catch {
      /* ignore */
    }
    ctxRef.current = null
    setAnalyser(null)
  }, [])
  useEffect(() => stopAll, [stopAll])

  // ---------- the engine ----------
  const goTo = useCallback((i) => {
    idxRef.current = i
    setIdx(i)
  }, [])

  const next = useCallback(() => {
    if (stoppedRef.current) return
    const i = idxRef.current + 1
    if (i >= stepsRef.current.length) {
      stopAll()
      setStage('review')
      return
    }
    goTo(i)
  }, [goTo, stopAll])

  const say = useCallback(
    (text) => {
      setSpeaking(true)
      const done = () => {
        setSpeaking(false)
        setTimeout(next, 350)
      }
      const url = voice?.[text]
      const a = audioRef.current
      if (url && a) {
        a.onended = done
        a.onerror = () => fallback()
        a.src = url
        a.play().catch(() => fallback())
        return
      }
      fallback()
      function fallback() {
        try {
          const synth = window.speechSynthesis
          if (!synth) throw new Error('no voice')
          synth.cancel()
          const u = new SpeechSynthesisUtterance(text)
          u.lang = 'en-GB'
          const v = synth.getVoices().find((x) => /en-GB/i.test(x.lang) && /natural|google|female|libby|sonia/i.test(x.name)) || synth.getVoices().find((x) => /en-GB/i.test(x.lang))
          if (v) u.voice = v
          u.rate = 0.95
          u.onend = done
          u.onerror = done
          synth.speak(u)
        } catch {
          setTimeout(done, Math.min(9000, 1200 + text.length * 55))
        }
      }
    },
    [voice, next]
  )

  const finishAnswer = useCallback(() => {
    const rec = recRef.current
    clearInterval(timerRef.current)
    if (rec && rec.state !== 'inactive') rec.stop()
    else next()
  }, [next])

  const startAnswer = useCallback(
    (s) => {
      const stream = streamRef.current
      if (!stream) {
        next()
        return
      }
      const mime = pickMime()
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data)
      rec.onstop = () => {
        const secs = (Date.now() - startedAtRef.current) / 1000
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || 'audio/webm' })
        setTakes((prev) => {
          if (prev[s.key]?.url) URL.revokeObjectURL(prev[s.key].url)
          return { ...prev, [s.key]: { blob, url: URL.createObjectURL(blob), secs } }
        })
        recRef.current = null
        setRecKey(null)
        next()
      }
      recRef.current = rec
      startedAtRef.current = Date.now()
      setElapsed(0)
      setRecKey(s.key)
      rec.start(1000)
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        const e = (Date.now() - startedAtRef.current) / 1000
        setElapsed(e)
        if (e >= s.limit) finishAnswer()
      }, 250)
    },
    [next, finishAnswer]
  )

  // Run each step when it comes up.
  useEffect(() => {
    if (stage !== 'run' || !step) return undefined
    if (step.type === 'section') {
      const t = setTimeout(next, 50)
      return () => clearTimeout(t)
    }
    if (step.type === 'say') {
      say(step.text)
      return undefined
    }
    if (step.type === 'answer') {
      startAnswer(step)
      return undefined
    }
    if (step.type === 'cue') {
      setPrepLeft(step.limit)
      const started = Date.now()
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        const left = step.limit - (Date.now() - started) / 1000
        setPrepLeft(left)
        if (left <= 0) {
          clearInterval(timerRef.current)
          next()
        }
      }, 250)
      return () => clearInterval(timerRef.current)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, idx])

  const begin = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext
        const ctx = new Ctx()
        const src = ctx.createMediaStreamSource(stream)
        const an = ctx.createAnalyser()
        an.fftSize = 256
        src.connect(an)
        ctxRef.current = ctx
        setAnalyser(an)
      } catch {
        /* the level bars are optional */
      }
    } catch {
      setError('Allow the microphone, then press Start again. (In the browser bar: the lock or microphone icon → Allow.)')
      return
    }
    // Unlock audio on phones inside this tap.
    try {
      const a = audioRef.current
      a.src = silentWav()
      await a.play().catch(() => {})
      a.pause()
    } catch {
      /* ignore */
    }
    stoppedRef.current = false
    setTakes({})
    setNotes({})
    goTo(0)
    setStage('run')
  }

  const leave = () => {
    const busy = stage === 'run' || ((stage === 'review' || stage === 'saving') && Object.keys(takes).length && !preview)
    if (busy && !window.confirm(stage === 'run' ? 'Stop the test? Your answers so far will be lost.' : 'Your answers are not handed in yet. Leave and lose them?')) return false
    stopAll()
    onClose?.()
    return true
  }

  // Phone / browser Back closes the test (with the same question).
  const leaveRef = useRef(leave)
  leaveRef.current = leave
  useEffect(() => {
    const marker = { ieltsSpeaking: Date.now() }
    try {
      window.history.pushState(marker, '')
    } catch {
      /* ignore */
    }
    let gone = false
    const onPop = () => {
      if (gone) return
      if (leaveRef.current() === false) {
        try {
          window.history.pushState(marker, '')
        } catch {
          /* ignore */
        }
      } else gone = true
    }
    window.addEventListener('popstate', onPop)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('popstate', onPop)
      document.body.style.overflow = prev
      if (!gone && window.history.state?.ieltsSpeaking === marker.ieltsSpeaking) {
        gone = true
        window.history.back()
      }
    }
  }, [])

  // ---------- hand in ----------
  const handIn = async () => {
    setStage('saving')
    setError('')
    try {
      const answers = []
      for (const s of answerSteps) {
        const t = takes[s.key]
        if (!t?.blob?.size) continue
        const ext = /mp4|aac|m4a/.test(t.blob.type) ? 'm4a' : 'webm'
        const path = `${studentId}/speaking/${mock ? `mock-${mock.id}` : task.id}-${Date.now()}-${s.key}.${ext}`
        const { error: upErr } = await supabase.storage.from('submissions').upload(path, t.blob, { contentType: t.blob.type || 'audio/webm' })
        if (upErr) throw upErr
        answers.push({ key: s.key, part: s.part, q: s.q, url: supabase.storage.from('submissions').getPublicUrl(path).data.publicUrl, secs: Math.round(t.secs) })
      }
      if (!answers.length) throw new Error('Nothing was recorded. Check the microphone and take the test again.')
      const results = { speaking: { setId: set.id, set_number: set.number, part, answers, notes } }
      const { data, error: rpcError } = mock
        ? await supabase.rpc('submit_speaking_mock', { p_id: mock.id, p_set: set.id, p_details: results })
        : await supabase.rpc('submit_homework_score', { p_task_id: task.id, p_score: null, p_max: null, p_details: results })
      if (rpcError) throw rpcError
      const row = (Array.isArray(data) ? data[0] : data) || {}
      if (!row.id) throw new Error('Could not save the attempt. Try again.')
      const saved = { id: row.id, attempt_no: row.attempt_no || 1, submitted_at: row.submitted_at || new Date().toISOString(), band: null, results: { ...results, ai: { status: 'processing' } } }
      setAttempt(saved)
      setStage('feedback')
      onChanged?.()
      // Mark it (about a minute). The screen also checks every 5 s.
      const { data: res, error: fnErr } = await supabase.functions.invoke('ai-grading', { body: markBody(row.id) })
      if (fnErr || res?.error) {
        let msg = res?.error || fnErr?.message || 'Marking failed.'
        try {
          const body = await fnErr?.context?.json?.()
          if (body?.error) msg = body.error
        } catch {
          /* ignore */
        }
        setAttempt((a) => ({ ...a, results: { ...a.results, ai: { status: 'error', error: msg } } }))
      } else if (res?.ai) {
        setAttempt((a) => ({ ...a, band: res.ai.overall_band, results: { ...a.results, ai: res.ai } }))
      }
      onChanged?.()
    } catch (e) {
      setError(e?.message || 'Could not hand it in.')
      setStage('review')
    }
  }

  const markAgain = async () => {
    if (!attempt?.id) return
    setAttempt((a) => ({ ...a, results: { ...a.results, ai: { status: 'processing' } } }))
    const { data: res, error: fnErr } = await supabase.functions.invoke('ai-grading', { body: markBody(attempt.id) })
    if (res?.ai) setAttempt((a) => ({ ...a, band: res.ai.overall_band, results: { ...a.results, ai: res.ai } }))
    else setAttempt((a) => ({ ...a, results: { ...a.results, ai: { status: 'error', error: res?.error || fnErr?.message || 'Marking failed.' } } }))
    onChanged?.()
  }

  // ---------- screen ----------
  const answeredCount = answerSteps.filter((s) => takes[s.key]).length
  const current = step?.type === 'answer' ? answerSteps.findIndex((s) => s.key === step.key) + 1 : answeredCount
  const partNow = (() => {
    for (let i = idx; i >= 0; i -= 1) if (steps[i]?.type === 'section') return steps[i].part
    return part === 'part2' ? 2 : part === 'part3' ? 3 : 1
  })()
  const lastQuestion = (() => {
    for (let i = idx; i >= 0; i -= 1) if (steps[i]?.type === 'say' && steps[i + 1]?.type === 'answer') return steps[i].text
    return ''
  })()
  const c = set?.content || {}
  const title = set ? setTitle(set, part) : 'Speaking test'
  // A Part 2 & 3 topic opened as a whole (no Part 1) is not a full test.
  const partInfo = part === 'full' && set && !(set.content?.part1 || []).some((t) => (t.questions || []).length) ? { label: 'Parts 2 & 3', minutes: '8–9 min' } : SPEAKING_PARTS[part]

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-ink">
      <audio ref={audioRef} preload="auto" className="hidden" />
      <div className="registan-band flex shrink-0 items-center gap-2 px-2 py-2 text-white sm:gap-3 sm:px-4">
        <button type="button" onClick={leave} className="focus-ring flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-white/15 px-3 text-sm font-extrabold text-white transition hover:bg-white/25">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className="hidden truncate text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/70 sm:block">{preview ? 'Teacher preview · Speaking' : mock ? 'Speaking mock' : 'Speaking'} · {partInfo?.label}</p>
          <p className="truncate text-[14px] font-extrabold text-white sm:text-[15px]">{title}</p>
        </div>
        {stage === 'run' && (
          <span className="grid h-10 min-w-[64px] shrink-0 place-items-center rounded-[12px] bg-white px-2.5 font-brand text-[14px] font-semibold text-speaking">
            {current || 0}/{answerSteps.length}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5 sm:py-8">
          {stage === 'loading' && <p className="text-sm font-semibold text-mist">Opening…</p>}
          {stage === 'error' && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}

          {stage === 'intro' && set && (
            <section className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-5 sm:p-6">
              <div>
                <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-speaking">IELTS Speaking · {partInfo?.label} · {partInfo?.minutes}</p>
                <h2 className="mt-1 font-brand text-[22px] font-semibold leading-tight text-paper">{part === 'part2' ? c.part2?.cue : part === 'part3' ? `Discussion: ${c.part3?.theme || ''}` : part === 'part1' ? (c.part1 || []).map((t) => t.topic).join(' · ') : set.topics || set.title}</h2>
              </div>
              <ul className="flex flex-col gap-2 text-[14px] font-semibold text-paper-dim">
                {[
                  'The examiner asks each question out loud. Your answer is recorded straight away.',
                  <>Answer like in the real test, then press <b className="text-paper">I’ve finished</b>. {part === 'part3' ? 'Give your opinion, a reason and an example.' : part === 'part2' ? 'Use your notes.' : partInfo?.label === 'Parts 2 & 3' ? 'Part 3: give your opinion, a reason and an example.' : 'Part 1: 2–4 sentences with a reason.'}</>,
                  ...(part === 'full' || part === 'part2' ? ['Part 2: one minute to make notes, then speak for up to two minutes.'] : []),
                  'Find a quiet place and use headphones if you can.',
                ].map((t, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-speaking-tint text-[12px] font-extrabold text-speaking">{i + 1}</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={begin} disabled={!voice} className="focus-ring inline-flex h-12 items-center gap-2 rounded-[14px] bg-saffron px-6 text-[15px] font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-60">
                  <MicIcon className="h-5 w-5" />
                  {voice ? 'Start the test' : 'Getting the examiner ready…'}
                </button>
                <span className="text-[12px] font-semibold text-mist">{voice ? `${answerSteps.length} questions · the microphone will ask for permission` : 'The first time a test is opened this takes up to a minute.'}</span>
              </div>
            </section>
          )}

          {stage === 'run' && step?.type === 'ready' && (
            <>
              <section className="registan-band flex flex-col gap-1.5 rounded-[24px] p-5 text-white sm:p-6">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Get ready · Part {partNow}{step.long ? ' · long turn' : ''}</p>
                <p className="font-brand text-[19px] font-semibold leading-snug sm:text-[22px]">{step.long ? c.part2?.cue : step.q}</p>
                <p className="text-[13px] font-semibold text-white/85">Learn these first — the examiner asks when you press the button.</p>
              </section>
              <GetReady key={step.key} q={{ key: step.key, q: step.q, model: modelFor(c, step.key) }} onReady={next} readyLabel={step.long ? 'I’m ready — show me the card' : 'I’m ready — ask me'} />
            </>
          )}

          {stage === 'run' && step && step.type !== 'ready' && (
            <>
              <section className="registan-band flex flex-col gap-3 rounded-[24px] p-5 text-white sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/20 font-brand text-[16px] font-semibold">E</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Examiner · Part {partNow}</p>
                    <p className="text-[13px] font-semibold text-white/85">{speaking ? 'Speaking…' : step.type === 'answer' ? 'Listening to you' : step.type === 'cue' ? 'Preparation time' : ''}</p>
                  </div>
                  <Voice on={speaking} />
                </div>
                {showText && (step.type === 'say' || step.type === 'answer') && (
                  <p className="font-brand text-[19px] font-semibold leading-snug sm:text-[22px]">{step.type === 'say' ? step.text : step.long ? 'Talk about the topic on the card.' : lastQuestion || step.q}</p>
                )}
                <button type="button" onClick={() => setShowText((v) => !v)} className={`focus-ring self-start rounded-[10px] bg-white/15 px-2.5 py-1 text-[12px] font-extrabold text-white hover:bg-white/25 ${step.type === 'cue' ? 'hidden' : ''}`}>
                  {showText ? 'Hide the words' : 'Show the words'}
                </button>
              </section>

              {(step.type === 'cue' || (step.type === 'answer' && step.long) || (step.type === 'say' && partNow === 2 && steps[idx - 1]?.type === 'cue')) && c.part2?.cue && (
                <section className="flex flex-col gap-3 rounded-[20px] border-2 border-paper/80 bg-white p-5 text-[#17213a]">
                  <p className="text-[18px] font-extrabold leading-snug">{c.part2.cue}</p>
                  <div>
                    <p className="text-[14px] font-bold">You should say:</p>
                    <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5 text-[15px]">
                      {(c.part2.bullets || []).map((b, i) => <li key={i}>{b}</li>)}
                    </ul>
                    {c.part2.explain && <p className="mt-1 text-[15px]">{c.part2.explain}</p>}
                  </div>
                </section>
              )}

              {step.type === 'cue' && (
                <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4">
                  <div className="flex items-center gap-3">
                    <span className="font-brand text-[28px] font-semibold text-speaking">{fmtTime(prepLeft)}</span>
                    <p className="min-w-0 flex-1 text-[13px] font-semibold text-mist">Make notes — key words only.</p>
                    <button type="button" onClick={() => { clearInterval(timerRef.current); next() }} className="focus-ring h-10 rounded-[12px] bg-panel-2 px-3 text-[13px] font-extrabold text-paper hover:brightness-95">
                      I’m ready
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(c.part2.notes?.length ? c.part2.notes : [...(c.part2.bullets || []), 'Why / how I feel']).slice(0, 4).map((n, i) => (
                      <label key={i} className="flex flex-col gap-1">
                        <span className="text-[11px] font-extrabold uppercase tracking-wide text-mist">{n}</span>
                        <textarea value={notes[i] || ''} onChange={(e) => setNotes((o) => ({ ...o, [i]: e.target.value }))} rows={2} className="focus-ring rounded-[12px] border border-line bg-panel-2/50 px-3 py-2 text-[14px] text-paper" />
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {step.type === 'answer' && (
                <section className="flex flex-col gap-3 rounded-[20px] border-2 border-coral/60 bg-panel p-4">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 shrink-0 animate-pulse rounded-full bg-coral" aria-hidden="true" />
                    <span className="font-brand text-[22px] font-semibold text-paper">{fmtTime(elapsed)}</span>
                    <span className="text-[12px] font-bold text-mist">/ {fmtTime(step.limit)}</span>
                    <span className="ml-auto"><Level analyser={analyser} on={recKey === step.key} /></span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-panel-2">
                    <div className={`h-full rounded ${step.long && elapsed < 60 ? 'bg-saffron' : 'bg-speaking'}`} style={{ width: `${Math.min(100, (elapsed / step.limit) * 100)}%` }} />
                  </div>
                  {coached && targets({ model: modelFor(c, step.key) }).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-extrabold text-paper-dim">Try to use:</span>
                      {targets({ model: modelFor(c, step.key) }).slice(0, 8).map((t) => (
                        <span key={t.label} className="rounded-[10px] bg-speaking-tint px-2 py-0.5 text-[12px] font-bold text-speaking">{t.label}</span>
                      ))}
                    </div>
                  )}
                  {step.long && Object.values(notes).some((n) => n?.trim()) && (
                    <div className="grid gap-1.5 rounded-[12px] bg-panel-2/60 p-2.5 text-[13px] text-paper sm:grid-cols-2">
                      {Object.entries(notes).filter(([, v]) => v?.trim()).map(([k, v]) => <p key={k} className="whitespace-pre-wrap">• {v}</p>)}
                    </div>
                  )}
                  <p className="text-[12px] font-semibold text-mist">
                    {step.long ? (elapsed < 60 ? 'Keep going — aim for at least 1½ minutes.' : elapsed < 90 ? 'Good. Keep developing the last point.' : 'Great length. Finish your idea.') : step.part === 1 ? 'Answer, give a reason, add a small example.' : step.part === 3 ? 'Give your opinion, a reason and an example or a contrast.' : 'One or two sentences.'}
                  </p>
                  <button type="button" onClick={finishAnswer} disabled={elapsed < 1.5} className="focus-ring h-12 rounded-[14px] bg-saffron text-[15px] font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50">
                    I’ve finished
                  </button>
                </section>
              )}
            </>
          )}

          {(stage === 'review' || stage === 'saving') && (
            <section className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-5 sm:p-6">
              <div>
                <p className="font-brand text-[20px] font-semibold text-paper">{preview ? 'End of the test' : 'Well done — that’s the end of the test'}</p>
                <p className="text-[13px] font-semibold text-mist">{answeredCount} of {answerSteps.length} answers recorded. {preview ? 'Model answers are below each question.' : 'Listen back if you like, then hand in for your band and feedback.'}</p>
              </div>
              <ol className="flex flex-col gap-2.5">
                {answerSteps.map((s, i) => (
                  <li key={s.key} className="flex flex-col gap-2 rounded-[16px] bg-panel-2/60 p-3">
                    <p className="text-[13px] font-extrabold text-paper"><span className="text-speaking">{i + 1}.</span> {s.q}</p>
                    {takes[s.key]?.url ? <audio src={takes[s.key].url} controls className="h-9 w-full" /> : <p className="text-[12px] font-bold text-coral">Not recorded</p>}
                    {preview && modelFor(c, s.key)?.answer && <p className="text-[13px] leading-relaxed text-paper-dim"><b className="text-speaking">Model: </b>{modelFor(c, s.key).answer}</p>}
                  </li>
                ))}
              </ol>
              {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
              <div className="flex flex-wrap gap-2">
                {!preview && (
                  <button type="button" onClick={handIn} disabled={stage === 'saving' || !answeredCount} className="focus-ring h-12 flex-1 rounded-[14px] bg-saffron px-6 text-[15px] font-extrabold text-[#17213a] hover:brightness-105 disabled:opacity-50">
                    {stage === 'saving' ? 'Handing in…' : 'Hand in for marking'}
                  </button>
                )}
                <button type="button" onClick={() => { setTakes({}); setStage('intro') }} disabled={stage === 'saving'} className="focus-ring h-12 rounded-[14px] bg-panel-2 px-5 text-[14px] font-extrabold text-paper hover:brightness-95 disabled:opacity-50">
                  Start again
                </button>
              </div>
            </section>
          )}

          {stage === 'feedback' && attempt && (
            <>
              {attempt.results?.ai?.status === 'error' && (
                <button type="button" onClick={markAgain} className="focus-ring h-11 self-start rounded-[14px] bg-speaking px-5 text-sm font-extrabold text-white">Mark it again</button>
              )}
              <SpeakingFeedback set={set} results={attempt.results} onAgain={mock ? null : () => { setTakes({}); setStage('intro') }} />
              <p className="text-center text-[12px] font-semibold text-mist">
                {attempt.attempt_no === 1 ? 'Handed in. Your first try counts.' : 'Handed in as a retake. Your first try still counts.'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
