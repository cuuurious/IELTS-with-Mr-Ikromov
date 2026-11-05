import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { qtypeLabel } from '../../lib/questionTypes'
import { cleanQs, withHelper } from '../../components/homework/HtmlTask'
import PageFrame from '../../components/homework/PageFrame'
import { needsWorkshop, openWorkshop, useWorkshopGate } from '../../lib/workshopGate'
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
  // Pages the student starred (migration_97); null = not available yet.
  const [favs, setFavs] = useState(null)
  useEffect(() => {
    if (!studentId) return
    supabase
      .from('page_favourites')
      .select('material_id')
      .eq('user_id', studentId)
      .then(({ data, error }) => setFavs(error ? null : new Set((data || []).map((r) => r.material_id))))
  }, [studentId])
  const toggleFav = async (id) => {
    if (!favs) return
    const on = favs.has(id)
    setFavs((prev) => {
      const n = new Set(prev)
      if (on) n.delete(id)
      else n.add(id)
      return n
    })
    const { error } = on
      ? await supabase.from('page_favourites').delete().eq('user_id', studentId).eq('material_id', id)
      : await supabase.from('page_favourites').insert({ material_id: id })
    if (error)
      setFavs((prev) => {
        const n = new Set(prev)
        if (on) n.add(id)
        else n.delete(id)
        return n
      })
  }

  const load = async () => {
    const [m, b, gs] = await Promise.all([
      supabase.from('materials').select('id, title, url, skill, question_type, collection, shelf_order, created_at').eq('on_shelf', true),
      supabase.from('book_practice').select('material_id, score, max_score, created_at').eq('user_id', studentId),
      // Sets the teacher put on the shelf for this student's group(s) only
      // (migration_96). None picked for the group: every set on the shelf.
      supabase.from('group_shelf').select('collection'),
    ])
    const only = new Set((gs.error ? [] : gs.data || []).map((r) => r.collection))
    const list = m.error ? [] : m.data || []
    setItems(only.size ? list.filter((i) => only.has(i.collection)) : list)
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
                  <li key={p.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setOpen(p)}
                      className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-[14px] bg-panel-2/60 px-3 py-2.5 text-left hover:bg-panel-2"
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
                    {favs && (
                      <button
                        type="button"
                        onClick={() => toggleFav(p.id)}
                        aria-pressed={favs.has(p.id)}
                        aria-label={favs.has(p.id) ? 'Remove the star' : 'Star this page — I liked it'}
                        title={favs.has(p.id) ? 'You starred this' : 'Liked it? Star it'}
                        className={`focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[12px] text-lg transition ${favs.has(p.id) ? 'text-amber' : 'text-mist/60 hover:text-amber'}`}
                      >
                        {favs.has(p.id) ? '★' : '☆'}
                      </button>
                    )}
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
            studentId={studentId}
            onClose={() => setOpen(null)}
            onSaved={(row) => setTries((prev) => [...prev, row])}
          />,
          document.body
        )}
    </div>
  )
}

function BookPlayer({ item, studentId, onClose, onSaved }) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState('')
  const [score, setScore] = useState(null)
  const [saved, setSaved] = useState(null) // the score key last saved
  const scoreRef = useRef(null)
  const savedRef = useRef(null)
  // Thematic Reading: the score only counts once the Workshop is finished (2026-11-05).
  const gate = useWorkshopGate(item.url, studentId, needsWorkshop(item.url, html))
  const gateRef = useRef(gate)
  gateRef.current = gate

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
    if (!s || !gateRef.current.complete) return
    const key = `${s.score}/${s.max}`
    if (savedRef.current === key) return
    savedRef.current = key
    const row = { material_id: item.id, score: s.score, max_score: s.max }
    let { data, error: err } = await supabase
      .from('book_practice')
      .insert(s.qs?.length ? { ...row, details: { qs: s.qs } } : row)
      .select('material_id, score, max_score, created_at')
      .single()
    // Before migration_97 there is no details column: save the score alone.
    if (err && s.qs?.length && /details/.test(err.message || '')) {
      ;({ data, error: err } = await supabase.from('book_practice').insert(row).select('material_id, score, max_score, created_at').single())
    }
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
        const s = { score: Number(d.score), max: Number(d.max), qs: cleanQs(d.qs) }
        scoreRef.current = s
        setScore(s)
        save(s)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])


  useEffect(() => {
    if (gate.complete && scoreRef.current) save(scoreRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate.complete])

  const waiting = gate.on && !gate.complete
  return (
    <PageFrame
      title={item.title}
      kicker={`Practice · ${qtypeLabel(item.question_type)}`}
      html={html}
      error={error}
      onClose={onClose}
      score={score}
      status={
        score && saved === `${score.score}/${score.max}`
          ? 'Score saved. It counts toward your weak-spot report.'
          : waiting
            ? `${gate.label} — finish every Workshop part and your score is saved.${score ? ' Your score is waiting.' : ''}`
            : 'Press Submit at the end — your score is saved by itself.'
      }
      action={
        <>
          {gate.on && (
            <button
              type="button"
              onClick={openWorkshop}
              title="Finish every Workshop part — then the page counts as done"
              className={`focus-ring h-10 shrink-0 rounded-[12px] px-3 text-sm font-extrabold ${waiting ? 'bg-saffron text-[#17213a]' : 'bg-white/15 text-white'} hover:brightness-105`}
            >
              {waiting ? (<><span className="sm:hidden">Workshop</span><span className="hidden sm:inline">{gate.label}</span></>) : '✓ Workshop'}
            </button>
          )}
          {score && saved === `${score.score}/${score.max}` ? (
            <span className="hidden h-10 shrink-0 items-center rounded-[12px] bg-white/15 px-3 text-xs font-extrabold text-white sm:flex">✓ Saved</span>
          ) : null}
        </>
      }
    />
  )
}
