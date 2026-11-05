import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { weekStart } from '../../lib/homeworkTasks'
import { fetchVoice } from '../../lib/speaking'
import CommonMistakes from '../../components/teacher/CommonMistakes'

/*
 * CLASS SCREEN (2026-11-05). One page for the board in the lesson:
 *   Warm-up  — a Part 1 question with its phrases and grammar, read aloud;
 *   Race     — this week's group race;
 *   Mistakes — the group's common mistakes (migration_108);
 *   Quiz     — "Which is right?" with the group's own sentences.
 * Big text, full screen, keyboard arrows for next.
 */

const TABS = [
  ['warmup', 'Warm-up'],
  ['race', 'Group race'],
  ['mistakes', 'Common mistakes'],
  ['quiz', 'Quiz'],
]

const shuffle = (a) => {
  const x = [...a]
  for (let i = x.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[x[i], x[j]] = [x[j], x[i]]
  }
  return x
}

export default function ClassScreen() {
  const [groups, setGroups] = useState([])
  const [gid, setGid] = useState('')
  const [tab, setTab] = useState('warmup')
  const [full, setFull] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    supabase
      .from('groups')
      .select('id, name')
      .order('created_at')
      .then(({ data }) => {
        setGroups(data || [])
        if (data?.[0]) setGid(data[0].id)
      })
    const onFs = () => setFull(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    else rootRef.current?.requestFullscreen?.().catch(() => {})
  }

  return (
    <div ref={rootRef} className={`flex flex-col gap-4 ${full ? 'h-screen overflow-y-auto bg-ink p-6 sm:p-10' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <select value={gid} onChange={(e) => setGid(e.target.value)} className="focus-ring h-11 rounded-[12px] border border-line bg-panel px-3 text-[15px] font-extrabold text-paper" aria-label="Group">
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`focus-ring h-11 shrink-0 rounded-[12px] px-4 text-[14px] font-extrabold ${tab === k ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim hover:text-paper'}`}>
              {l}
            </button>
          ))}
        </div>
        <button type="button" onClick={toggleFull} className="focus-ring h-11 rounded-[12px] bg-saffron px-4 text-[14px] font-extrabold text-[#17213a]">
          {full ? 'Leave full screen' : 'Full screen'}
        </button>
      </div>
      {tab === 'warmup' && <WarmupBoard />}
      {tab === 'race' && <RaceBoard groupId={gid} />}
      {tab === 'mistakes' && gid && <CommonMistakes groupId={gid} days={14} big />}
      {tab === 'quiz' && gid && <QuizBoard groupId={gid} />}
    </div>
  )
}

function useKeys(onNext, onPrev) {
  useEffect(() => {
    const f = (e) => {
      if (e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return
      if (e.key === 'ArrowRight' || e.key === ' ') onNext?.()
      if (e.key === 'ArrowLeft') onPrev?.()
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [onNext, onPrev])
}

// A Part 1 question for the whole class, with words and grammar to use.
function WarmupBoard() {
  const [qs, setQs] = useState(null)
  const [i, setI] = useState(0)
  const [show, setShow] = useState(false)
  const audio = useRef(null)

  useEffect(() => {
    supabase
      .from('speaking_sets')
      .select('id, content')
      .then(({ data }) => {
        const bank = (data || []).filter((s) => s.content?.warmup)
        const src = bank.length ? bank : data || []
        const all = []
        src.forEach((s) => (s.content?.part1 || []).forEach((t) => (t.questions || []).forEach((q) => q?.q && all.push({ setId: s.id, topic: t.topic, q: q.q, model: q.model || null }))))
        setQs(shuffle(all))
      })
  }, [])

  const q = qs?.[i]
  const next = () => {
    setShow(false)
    setI((x) => (qs?.length ? (x + 1) % qs.length : 0))
  }
  const prev = () => {
    setShow(false)
    setI((x) => (qs?.length ? (x - 1 + qs.length) % qs.length : 0))
  }
  useKeys(next, prev)

  const speak = async () => {
    if (!q) return
    const urls = await fetchVoice(q.setId, [q.q]).catch(() => ({}))
    if (urls?.[q.q] && audio.current) {
      audio.current.src = urls[q.q]
      audio.current.play().catch(() => {})
      return
    }
    try {
      const u = new SpeechSynthesisUtterance(q.q)
      u.lang = 'en-GB'
      window.speechSynthesis.cancel()
      window.speechSynthesis.speak(u)
    } catch {
      /* no voice */
    }
  }

  if (!qs) return <p className="text-sm font-semibold text-mist">Loading…</p>
  if (!q) return <p className="text-sm font-semibold text-mist">No speaking questions yet.</p>
  return (
    <div className="flex flex-col gap-4">
      <audio ref={audio} className="hidden" />
      <section className="registan-band flex flex-col gap-3 rounded-[28px] p-6 text-white sm:p-10">
        <p className="text-[14px] font-extrabold uppercase tracking-[0.14em] text-white/75">Part 1 · {q.topic}</p>
        <p className="font-brand text-[30px] font-semibold leading-tight sm:text-[44px]">{q.q}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={speak} className="focus-ring h-11 rounded-[12px] bg-white/20 px-4 text-[14px] font-extrabold hover:bg-white/30">Read it aloud</button>
          {q.model && (
            <button type="button" onClick={() => setShow((v) => !v)} className="focus-ring h-11 rounded-[12px] bg-white/20 px-4 text-[14px] font-extrabold hover:bg-white/30">
              {show ? 'Hide the band 8 answer' : 'Show the band 8 answer'}
            </button>
          )}
          <button type="button" onClick={next} className="focus-ring h-11 rounded-[12px] bg-saffron px-5 text-[14px] font-extrabold text-[#17213a]">Next question →</button>
        </div>
      </section>
      {q.model && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-2 rounded-[24px] border border-line bg-panel p-5">
            <p className="text-[13px] font-extrabold uppercase tracking-wide text-speaking">Words to use</p>
            {(q.model.phrases || []).map(([p, m], k) => (
              <p key={k} className="text-[22px] leading-snug sm:text-[26px]"><b className="font-extrabold text-paper">{p}</b> <span className="text-[18px] text-paper-dim sm:text-[20px]">— {m}</span></p>
            ))}
          </section>
          <section className="flex flex-col gap-2 rounded-[24px] border border-line bg-panel p-5">
            <p className="text-[13px] font-extrabold uppercase tracking-wide text-speaking">Grammar to use</p>
            {(q.model.grammar || []).map((g, k) => (
              <div key={k}>
                <p className="text-[22px] font-extrabold text-paper sm:text-[26px]">{g.pattern}</p>
                {g.try && <p className="text-[18px] text-paper-dim sm:text-[20px]">{g.try}</p>}
              </div>
            ))}
          </section>
        </div>
      )}
      {show && q.model?.answer && (
        <section className="rounded-[24px] border-2 border-speaking/40 bg-panel p-6">
          <p className="text-[22px] leading-relaxed text-paper sm:text-[26px]">{q.model.answer}</p>
        </section>
      )}
    </div>
  )
}

function RaceBoard({ groupId }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    supabase.rpc('group_race', { p_week_start: weekStart() }).then(({ data }) => setRows(data || []))
  }, [])
  if (!rows) return <p className="text-sm font-semibold text-mist">Loading…</p>
  const ranked = [...rows].sort((a, b) => Number(b.average) - Number(a.average))
  const top = Number(ranked[0]?.average) || 1
  return (
    <section className="flex flex-col gap-3 rounded-[28px] border border-line bg-panel p-5 sm:p-8">
      <p className="font-brand text-[26px] font-semibold text-paper sm:text-[32px]">This week’s group race</p>
      <p className="text-[16px] font-semibold text-mist">Average points per student. The winning group gets bonus coins on Monday.</p>
      <ol className="flex flex-col gap-3">
        {ranked.map((r, i) => (
          <li key={r.group_id} className={`flex items-center gap-4 rounded-[18px] px-4 py-3 ${r.group_id === groupId ? 'bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))] ring-2 ring-saffron' : 'bg-panel-2/70'}`}>
            <span className="w-10 text-center font-brand text-[26px] font-semibold text-brass">{i + 1}</span>
            <span className="w-40 shrink-0 truncate text-[22px] font-extrabold text-paper">{r.name}</span>
            <span className="h-4 min-w-0 flex-1 overflow-hidden rounded-full bg-panel">
              <span className="block h-full rounded-full bg-brass" style={{ width: `${Math.max(4, (100 * Number(r.average)) / top)}%` }} />
            </span>
            <span className="w-20 text-right font-brand text-[24px] font-semibold text-paper">{Math.round(Number(r.average))}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

function QuizBoard({ groupId }) {
  const [cards, setCards] = useState(null)
  const [i, setI] = useState(0)
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState('')

  const load = () => {
    setCards(null)
    setI(0)
    setReveal(false)
    supabase.rpc('group_quiz_cards', { p_group_id: groupId, p_n: 8 }).then(({ data, error: e }) => {
      if (e) setError(/group_quiz_cards/.test(e.message) ? 'Run migration_108 first.' : e.message)
      setCards((data || []).map((c) => ({ ...c, options: shuffle([c.original, c.better]) })))
    })
  }
  useEffect(load, [groupId]) // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => {
    if (!reveal) return setReveal(true)
    setReveal(false)
    setI((x) => x + 1)
  }
  useKeys(next, null)
  const c = useMemo(() => cards?.[i], [cards, i])

  if (error) return <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>
  if (!cards) return <p className="text-sm font-semibold text-mist">Loading…</p>
  if (!cards.length) return <p className="rounded-[20px] border border-line bg-panel p-6 text-center text-sm font-bold text-paper-dim">No marked sentences from this group in the last 30 days yet.</p>
  if (!c) {
    return (
      <section className="flex flex-col items-center gap-4 rounded-[28px] border border-line bg-panel p-10 text-center">
        <p className="font-brand text-[32px] font-semibold text-paper">Quiz done ✓</p>
        <button type="button" onClick={load} className="focus-ring h-12 rounded-[14px] bg-saffron px-6 text-[16px] font-extrabold text-[#17213a]">New quiz</button>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-5 rounded-[28px] border border-line bg-panel p-6 sm:p-10">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[18px] font-extrabold text-mist">Which one is right? · from your own writing and speaking</p>
        <span className="rounded-[12px] bg-panel-2 px-3 py-1 font-brand text-[18px] font-semibold text-paper">{i + 1}/{cards.length}</span>
      </div>
      {c.options.map((o, k) => {
        const right = o === c.better
        return (
          <p key={o} className={`rounded-[20px] px-6 py-5 text-[24px] font-bold leading-snug sm:text-[30px] ${!reveal ? 'bg-panel-2 text-paper' : right ? 'bg-reading-tint text-reading' : 'bg-urgent-tint text-coral line-through'}`}>
            <span className="mr-3 font-brand text-mist">{k === 0 ? 'A' : 'B'}</span>
            {o}
          </p>
        )
      })}
      {reveal && c.why && <p className="rounded-[18px] bg-writing-tint/60 px-6 py-4 text-[20px] font-semibold text-paper sm:text-[24px]">{c.why}</p>}
      <button type="button" onClick={next} className="focus-ring h-14 self-start rounded-[16px] bg-saffron px-8 text-[18px] font-extrabold text-[#17213a]">
        {reveal ? 'Next →' : 'Show the answer'}
      </button>
    </section>
  )
}
