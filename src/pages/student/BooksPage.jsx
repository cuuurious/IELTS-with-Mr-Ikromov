import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { qtypeLabel } from '../../lib/questionTypes'
import { withHelper } from '../../components/homework/HtmlTask'
import TaskShell, { Panel } from '../../components/homework/TaskShell'
import WeakSpots from '../../components/WeakSpots'
import SkillArt, { SkillIcon } from '../../components/SkillArt'

/*
 * Books shelf (2026-11-02, migration_89): Mr Ikromov's thematic Reading and
 * Listening pages, sorted by question type, for self-practice. Every score
 * is saved (book_practice) and feeds the weak-spot report at the top, whose
 * "Practise" button jumps straight to that question type.
 *
 * Reading and Listening only — Writing and Speaking stay homework-only.
 */
export default function BooksPage({ studentId }) {
  const [items, setItems] = useState(null)
  const [tries, setTries] = useState([])
  const [skill, setSkill] = useState('reading')
  const [qtype, setQtype] = useState(null)
  const [open, setOpen] = useState(null)
  const listRef = useRef(null)

  const load = async () => {
    const [m, b] = await Promise.all([
      supabase.from('materials').select('id, title, url, skill, question_type, shelf_order, created_at').eq('on_shelf', true),
      supabase.from('book_practice').select('material_id, score, max_score, created_at').eq('user_id', studentId),
    ])
    setItems(m.error ? [] : m.data || [])
    setTries(b.error ? [] : b.data || [])
  }

  useEffect(() => {
    if (studentId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  const best = useMemo(() => {
    const out = {}
    tries.forEach((t) => {
      const pct = t.score / t.max_score
      if (!out[t.material_id] || pct > out[t.material_id].pct) out[t.material_id] = { pct, score: t.score, max: t.max_score }
    })
    return out
  }, [tries])

  const bySkill = (items || []).filter((i) => i.skill === skill)
  const types = useMemo(() => {
    const map = {}
    bySkill.forEach((i) => {
      const k = i.question_type || 'other'
      map[k] = map[k] || { key: k, total: 0, done: 0 }
      map[k].total += 1
      if (best[i.id]) map[k].done += 1
    })
    return Object.values(map).sort((a, b) => qtypeLabel(a.key).localeCompare(qtypeLabel(b.key)))
  }, [bySkill, best])

  const pages = bySkill
    .filter((i) => (i.question_type || 'other') === qtype)
    .sort((a, b) => (a.shelf_order ?? 1e9) - (b.shelf_order ?? 1e9) || a.title.localeCompare(b.title, undefined, { numeric: true }))

  const practise = (s, q) => {
    setSkill(s === 'listening' ? 'listening' : 'reading')
    setQtype(q)
    setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const counts = {
    reading: (items || []).filter((i) => i.skill === 'reading').length,
    listening: (items || []).filter((i) => i.skill === 'listening').length,
  }

  return (
    <div className="flex flex-col gap-5">
      <WeakSpots userId={studentId} onPractise={practise} title="My weak spots" compact />

      <section ref={listRef} className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-brand text-[18px] font-semibold text-paper">Books shelf</h2>
          {['reading', 'listening'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSkill(s)
                setQtype(null)
              }}
              className={`focus-ring flex items-center gap-2 rounded-[14px] px-3.5 py-2 text-sm font-extrabold transition ${
                skill === s ? (s === 'listening' ? 'bg-listening text-white' : 'bg-reading text-white') : 'bg-panel-2 text-paper-dim hover:text-paper'
              }`}
            >
              <SkillIcon skill={s} className="h-4 w-4" />
              {s === 'listening' ? 'Listening' : 'Reading'}
              <span className="opacity-75">{counts[s]}</span>
            </button>
          ))}
        </div>

        {items === null ? (
          <p className="text-sm font-semibold text-mist">Loading…</p>
        ) : types.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[16px] bg-panel-2/60 px-6 py-10 text-center">
            <SkillArt skill={skill} className="h-24 w-32" />
            <p className="font-brand text-[17px] font-semibold text-paper">No {skill} books on the shelf yet</p>
            <p className="max-w-sm text-sm font-semibold text-mist">Your teacher adds them from the Library. They will appear here, sorted by question type.</p>
          </div>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {types.map((t) => {
              const active = t.key === qtype
              const pct = Math.round((100 * t.done) / t.total)
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setQtype(active ? null : t.key)}
                  className={`focus-ring flex flex-col gap-2 rounded-[16px] p-4 text-left transition hover:-translate-y-0.5 ${
                    active ? 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] ring-2 ring-brass' : 'bg-panel-2/60'
                  }`}
                >
                  <span className="text-[15px] font-extrabold leading-tight text-paper">{qtypeLabel(t.key)}</span>
                  <span className="text-[12px] font-bold text-mist">
                    {t.done} of {t.total} done
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-panel">
                    <span className="block h-full rounded-full bg-sage" style={{ width: `${pct}%` }} />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {qtype && pages.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[13px] font-extrabold text-paper-dim">{qtypeLabel(qtype)} · {pages.length} tasks</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {pages.map((p, i) => {
                const b = best[p.id]
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setOpen(p)}
                      className="focus-ring flex w-full items-center gap-3 rounded-[14px] bg-panel-2/60 px-3 py-2.5 text-left hover:bg-panel-2"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] font-brand text-[13px] font-semibold text-brass">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{p.title}</span>
                      {b ? (
                        <span className={`shrink-0 rounded-xl px-2 py-1 text-[12px] font-extrabold ${b.pct >= 0.75 ? 'bg-sage/15 text-sage' : b.pct >= 0.55 ? 'bg-saffron/20 text-brass' : 'bg-urgent-tint text-coral'}`}>
                          {b.score}/{b.max}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[12px] font-bold text-mist">Start</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>

      {open &&
        createPortal(
          <BookPlayer
            item={open}
            onClose={() => setOpen(null)}
            onSaved={(row) => setTries((prev) => [...prev, row])}
          />,
          document.body
        )}
    </div>
  )
}

function BookPlayer({ item, onClose, onSaved }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState('')
  const [score, setScore] = useState(null)
  const [saved, setSaved] = useState(null) // the score key last saved
  const scoreRef = useRef(null)
  const savedRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetch(item.url)
      .then((r) => {
        if (!r.ok) throw new Error('This page could not be opened.')
        return r.text()
      })
      .then((text) => !cancelled && setHtml(withHelper(text)))
      .catch((err) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [item.url])

  const save = async (s) => {
    if (!s) return
    const key = `${s.score}/${s.max}`
    if (savedRef.current === key) return
    savedRef.current = key
    const { data, error: err } = await supabase
      .from('book_practice')
      .insert({ material_id: item.id, score: s.score, max_score: s.max })
      .select('material_id, score, max_score, created_at')
      .single()
    if (err) {
      savedRef.current = null
      setError('Your score could not be saved. Try again.')
      return
    }
    setSaved(key)
    onSaved?.(data)
  }

  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data
      if (d && d.type === 'ielts-workshop-score' && Number(d.max) > 0 && Number(d.max) <= 200) {
        const s = { score: Number(d.score), max: Number(d.max) }
        scoreRef.current = s
        setScore(s)
        save(s)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  const kind = item.skill === 'listening' ? 'listening' : 'reading'

  return (
    <TaskShell kind={kind} title={item.title} subtitle={`Books shelf · ${qtypeLabel(item.question_type)}`} onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <Panel className="flex items-center gap-3">
          <span className={`grid h-12 min-w-[64px] place-items-center rounded-2xl px-3 font-brand text-[18px] font-semibold ${score ? 'bg-reading-tint text-reading' : 'bg-panel-2 text-mist'}`}>
            {score ? `${score.score}/${score.max}` : '—'}
          </span>
          <p className="text-sm font-bold text-paper-dim">
            {score && saved === `${score.score}/${score.max}` ? 'Score saved. It counts toward your weak-spot report.' : 'Press Submit at the end of the task — your score is saved by itself.'}
          </p>
        </Panel>
        {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
        <div className="overflow-hidden rounded-[20px] border border-line bg-white">
          {html ? (
            <iframe title={item.title} srcDoc={html} sandbox="allow-scripts allow-forms allow-modals allow-popups" className="block h-[78vh] w-full" />
          ) : (
            !error && <p className="p-6 text-sm font-semibold text-mist">Opening…</p>
          )}
        </div>
      </div>
    </TaskShell>
  )
}
