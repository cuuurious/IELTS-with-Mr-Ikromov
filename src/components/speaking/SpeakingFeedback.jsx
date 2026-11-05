import { useMemo, useRef, useState } from 'react'
import SkillAudioPlayer from '../SkillAudioPlayer'
import { BandRing } from '../homework/TaskShell'
import { matchPercent } from '../homework/ShadowingTask'
import { modelFor } from '../../lib/speaking'
import { UsedCheck, targets } from './speakingPrep'
import { TeacherBandNote } from '../homework/TeacherBand'

/*
 * Speaking feedback (2026-11-05): the AI band and what to do next, for
 * one handed-in speaking test. Students see it straight after marking;
 * teachers see the same in the gradebook.
 *   Your answers  recording, what we heard, a comment, your answer at
 *                 Band 8, and the book's model answer with its phrases
 *   Say it better your own sentences said better — say them aloud
 *   Practice      short exercises for the weakest skill
 *   Phrases       the set's phrases and grammar for these questions
 */

const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null
const PART_LABEL = { 1: 'Part 1', 2: 'Part 2', 3: 'Part 3' }

const bandTone = (b) => (b == null ? 'text-mist' : b >= 7 ? 'text-reading' : b >= 5.5 ? 'text-listening' : 'text-coral')

// Record yourself saying a line (and, where the browser can, check it).
export function SayItButton({ target, label = 'Say it' }) {
  const [state, setState] = useState('idle') // idle | rec
  const [take, setTake] = useState(null) // { url, pct, said }
  const ref = useRef(null)

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks = []
      let said = ''
      let recog = null
      if (Recognition && target) {
        recog = new Recognition()
        recog.lang = 'en-GB'
        recog.continuous = true
        recog.interimResults = false
        recog.onresult = (e) => {
          said = Array.from(e.results)
            .map((r) => r[0]?.transcript || '')
            .join(' ')
        }
        try {
          recog.start()
        } catch {
          recog = null
        }
      }
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const done = () => {
          const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
          setTake((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url)
            return { url: URL.createObjectURL(blob), said, pct: recog && target ? matchPercent(target, said) : null }
          })
        }
        if (recog) {
          recog.onend = done
          try {
            recog.stop()
          } catch {
            done()
          }
        } else done()
      }
      ref.current = rec
      rec.start()
      setState('rec')
    } catch {
      setTake({ url: null, error: 'Allow the microphone to record yourself.' })
    }
  }
  const stop = () => {
    ref.current?.stop()
    ref.current = null
    setState('idle')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={state === 'rec' ? stop : start}
          className={`focus-ring inline-flex h-9 items-center gap-2 rounded-[12px] px-3 text-[13px] font-extrabold text-white transition ${state === 'rec' ? 'animate-pulse bg-coral' : 'bg-speaking hover:brightness-110'}`}
        >
          <MicIcon />
          {state === 'rec' ? 'Stop' : take?.url ? 'Again' : label}
        </button>
        {take?.pct != null && (
          <span className={`rounded-[10px] px-2 py-1 text-[12px] font-extrabold ${take.pct >= 80 ? 'bg-reading-tint text-reading' : take.pct >= 50 ? 'bg-listening-tint text-listening' : 'bg-urgent-tint text-coral'}`}>{take.pct}% match</span>
        )}
        {take?.error && <span className="text-[12px] font-bold text-coral">{take.error}</span>}
      </div>
      {take?.url && <audio src={take.url} controls className="h-9 w-full max-w-sm" />}
      {take?.said && <p className="text-[12px] font-semibold text-mist">We heard: “{take.said}”</p>}
    </div>
  )
}

export function MicIcon({ className = 'h-4 w-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

function Phrases({ list }) {
  if (!list?.length) return null
  return (
    <ul className="flex flex-wrap gap-1.5">
      {list.map(([p, m], i) => (
        <li key={i} className="rounded-[10px] bg-speaking-tint px-2.5 py-1 text-[12px] font-bold text-paper" title={m}>
          <span className="font-extrabold text-speaking">{p}</span>
          {m && <span className="text-paper-dim"> — {m}</span>}
        </li>
      ))}
    </ul>
  )
}

function ModelBox({ model }) {
  const [open, setOpen] = useState(false)
  if (!model?.answer) return null
  return (
    <div className="rounded-[14px] border border-line bg-panel">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="focus-ring flex w-full items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-left text-[13px] font-extrabold text-paper">
        Model answer from the book
        <span className="text-mist">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-3">
          {model.sections?.length ? (
            model.sections.map((s, i) => (
              <p key={i} className="text-[14px] leading-relaxed text-paper">
                <span className="mr-1.5 rounded-md bg-panel-2 px-1.5 py-0.5 text-[11px] font-extrabold uppercase text-mist">{s.label}</span>
                {s.text}
              </p>
            ))
          ) : (
            <p className="text-[14px] leading-relaxed text-paper">{model.answer}</p>
          )}
          <Phrases list={model.phrases} />
        </div>
      )}
    </div>
  )
}

export default function SpeakingFeedback({ set, results, onAgain = null, teacher = false }) {
  const [tab, setTab] = useState('answers')
  const ai = results?.ai || null
  const answers = useMemo(() => results?.speaking?.answers || [], [results])
  const content = set?.content || {}
  const heard = useMemo(() => Object.fromEntries((ai?.transcripts || []).map((t) => [t.key, t.text])), [ai])
  const aiAns = useMemo(() => Object.fromEntries((ai?.answers || []).map((a) => [a.key, a])), [ai])

  const phrases = useMemo(() => {
    const seen = new Set()
    const ph = []
    const gr = []
    answers.forEach((a) => {
      const m = modelFor(content, a.key)
      ;(m?.phrases || []).forEach((p) => {
        if (seen.has(p[0])) return
        seen.add(p[0])
        ph.push(p)
      })
      ;(m?.grammar || []).forEach((g) => gr.push(g))
    })
    return { ph, gr }
  }, [answers, content])

  const tabs = [
    ['answers', 'Your answers'],
    ...(ai?.say_it_better?.length ? [['better', 'Say it better']] : []),
    ...(ai?.exercises?.length ? [['practice', 'Practice']] : []),
    ...(phrases.ph.length || phrases.gr.length || ai?.useful_collocations?.length ? [['phrases', 'Phrases & grammar']] : []),
  ]

  return (
    <div className="flex flex-col gap-4">
      {!teacher && <TeacherBandNote teacher={results?.teacher} />}
      {ai?.status === 'done' ? (
        <section className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-4 sm:p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <BandRing value={ai.overall_band != null ? Number(ai.overall_band).toFixed(1) : null} label="AI band" tone="#6a3f99" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="font-brand text-[19px] font-semibold text-paper">{teacher ? 'AI estimate' : 'Your speaking band'}</p>
              {ai.summary && <p className="text-[14px] leading-relaxed text-paper-dim">{ai.summary}</p>}
              <p className="text-[12px] font-semibold text-mist">An estimate from your recordings. {teacher ? 'Pronunciation is judged from the transcript only.' : 'Mr Ikromov can listen and change it.'}</p>
            </div>
            {onAgain && (
              <button type="button" onClick={onAgain} className="focus-ring h-11 shrink-0 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105">
                Take it again
              </button>
            )}
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {(ai.criteria || []).map((c) => (
              <li key={c.name} className="flex flex-col gap-1 rounded-[16px] bg-panel-2/70 p-3">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-[13px] font-extrabold text-paper">{c.name}</span>
                  <span className={`font-brand text-[18px] font-semibold ${bandTone(c.band)}`}>{Number(c.band).toFixed(1)}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-panel">
                  <div className="h-full rounded bg-speaking" style={{ width: `${Math.max(0, Math.min(100, (Number(c.band) / 9) * 100))}%` }} />
                </div>
                <p className="text-[13px] leading-relaxed text-paper-dim">{c.comment}</p>
              </li>
            ))}
          </ul>
          {(ai.strengths?.length > 0 || ai.improvements?.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {ai.strengths?.length > 0 && (
                <div className="rounded-[16px] bg-reading-tint/60 p-3">
                  <p className="mb-1 text-[12px] font-extrabold uppercase tracking-wide text-reading">What went well</p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-paper">{ai.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
              {ai.improvements?.length > 0 && (
                <div className="rounded-[16px] bg-urgent-tint/60 p-3">
                  <p className="mb-1 text-[12px] font-extrabold uppercase tracking-wide text-coral">Work on</p>
                  <ul className="flex list-disc flex-col gap-1 pl-4 text-[13px] text-paper">{ai.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </section>
      ) : ai?.status === 'processing' ? (
        <section className="flex items-center gap-3 rounded-[20px] border border-line bg-panel p-5">
          <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-[3px] border-speaking border-t-transparent" aria-hidden="true" />
          <p className="text-sm font-bold text-paper">Marking your recordings… this takes about a minute.</p>
        </section>
      ) : ai?.status === 'error' ? (
        <section className="rounded-[20px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">Marking did not finish: {ai.error}</section>
      ) : null}

      {tabs.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
          {tabs.map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`focus-ring h-10 shrink-0 rounded-[12px] px-4 text-[13px] font-extrabold transition ${tab === k ? 'bg-speaking text-white' : 'bg-panel text-paper-dim hover:text-paper'}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {tab === 'answers' && (
        <ol className="flex flex-col gap-3">
          {answers.map((a, i) => {
            const x = aiAns[a.key]
            const said = heard[a.key]
            return (
              <li key={a.key} className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-panel p-4">
                <div className="flex items-start gap-3">
                  <span className="grid h-8 min-w-8 shrink-0 place-items-center rounded-[10px] bg-speaking-tint px-1.5 text-[12px] font-extrabold text-speaking">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-mist">{PART_LABEL[a.part]}{a.key === 'p2-round' ? ' · rounding-off' : ''}</p>
                    <p className="text-[15px] font-extrabold leading-snug text-paper">{a.q}</p>
                  </div>
                </div>
                {a.url && <SkillAudioPlayer src={a.url} label={teacher ? 'Recording' : 'Your answer'} sublabel={a.secs ? `${Math.round(a.secs)} s` : ''} download={teacher} />}
                {said != null && <p className="text-[13px] leading-relaxed text-paper-dim"><span className="font-extrabold text-mist">We heard: </span>{said || '(nothing — was the microphone on?)'}</p>}
                {said && said.trim().split(/\s+/).length > 3 && targets({ model: modelFor(content, a.key) }).length > 0 && <UsedCheck q={{ key: a.key, model: modelFor(content, a.key) }} said={said} />}
                {x?.comment && <p className="text-[13px] font-semibold leading-relaxed text-paper">{x.comment}</p>}
                {x?.better && (
                  <div className="rounded-[14px] bg-speaking-tint/60 px-3 py-2.5">
                    <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-speaking">Your answer at Band 8</p>
                    <p className="text-[14px] leading-relaxed text-paper">{x.better}</p>
                    {!teacher && (
                      <div className="mt-2">
                        <SayItButton target={x.better} label="Say this version" />
                      </div>
                    )}
                  </div>
                )}
                <ModelBox model={modelFor(content, a.key)} />
              </li>
            )
          })}
        </ol>
      )}

      {tab === 'better' && (
        <ul className="flex flex-col gap-3">
          {(ai?.say_it_better || []).map((s, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
              <p className="text-[14px] text-mist line-through decoration-coral/60">{s.original}</p>
              <p className="text-[16px] font-extrabold leading-snug text-paper">{s.better}</p>
              {s.why && <p className="text-[12px] font-bold text-speaking">{s.why}</p>}
              {!teacher && <SayItButton target={s.better} />}
            </li>
          ))}
          {!teacher && <li className="px-1 text-[12px] font-semibold text-mist">Say each one aloud 3 times, then use it in your next answer.</li>}
        </ul>
      )}

      {tab === 'practice' && (
        <ul className="flex flex-col gap-3">
          {(ai?.exercises || []).map((ex, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
              <p className="font-brand text-[16px] font-semibold text-paper">{ex.title}</p>
              <p className="text-[13px] font-semibold text-paper-dim">{ex.instructions}</p>
              <ol className="flex flex-col gap-2">
                {(ex.items || []).map((it, j) => (
                  <li key={j} className="flex flex-col gap-2 rounded-[14px] bg-panel-2/70 p-3">
                    <p className="text-[14px] font-bold text-paper">{j + 1}. {it}</p>
                    {!teacher && <SayItButton target="" label="Answer" />}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}

      {tab === 'phrases' && (
        <div className="flex flex-col gap-3">
          {phrases.ph.length > 0 && (
            <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
              <p className="font-brand text-[16px] font-semibold text-paper">Phrases from this test</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {phrases.ph.map(([p, m]) => (
                  <li key={p} className="rounded-[12px] bg-panel-2/70 px-3 py-2 text-[13px]">
                    <span className="font-extrabold text-speaking">{p}</span>
                    <span className="text-paper-dim"> — {m}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {phrases.gr.length > 0 && (
            <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
              <p className="font-brand text-[16px] font-semibold text-paper">Grammar to borrow</p>
              <ul className="flex flex-col gap-2">
                {phrases.gr.map((g, i) => (
                  <li key={i} className="rounded-[12px] bg-panel-2/70 px-3 py-2 text-[13px]">
                    <p className="font-extrabold text-paper">{g.pattern}</p>
                    {g.use && <p className="text-paper-dim">{g.use}</p>}
                    {g.example && <p className="italic text-paper">“{g.example}”</p>}
                    {g.try && <p className="mt-1 font-bold text-speaking">Try: {g.try}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(ai?.useful_collocations?.length > 0 || ai?.grammar_structures?.length > 0) && (
            <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4">
              <p className="font-brand text-[16px] font-semibold text-paper">For your next answers</p>
              <ul className="flex flex-col gap-2">
                {[...(ai.useful_collocations || []), ...(ai.grammar_structures || [])].map((t, i) => (
                  <li key={i} className="rounded-[12px] bg-panel-2/70 px-3 py-2 text-[13px]">
                    <p className="font-extrabold text-paper">{t.tip}</p>
                    <p className="italic text-paper-dim">{t.example}</p>
                    <p className="text-mist">{t.why}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
