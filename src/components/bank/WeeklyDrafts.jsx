import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { postPagesHomework, shortTitle } from '../../lib/pageBank'
import { qtypeLabel } from '../../lib/questionTypes'
import { lessonTime } from '../../lib/courses'
import { groupColour, groupDisplayName } from '../../lib/groupLook'

/*
 * This week's practice drafts (2026-11-05). For every group: its weakest
 * question type (5+ answers, under 70%) and the next 2 pages of that type
 * it hasn't done, easiest first, due at its next lesson. Nothing is sent
 * until the teacher presses Post (one group) or Post all.
 */
const PER_GROUP = 2

const weekKey = () => {
  const d = new Date()
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return `ielts:weeklyDrafts:${d.toISOString().slice(0, 10)}`
}
const readSkipped = () => {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(weekKey()) || '[]'))
  } catch {
    return new Set()
  }
}

export default function WeeklyDrafts({ pages, given, stats, groups, onPosted }) {
  const { profile } = useAuth()
  const [weak, setWeak] = useState(null) // gid -> [{qtype,pct}]
  const [next, setNext] = useState({})
  const [skipped, setSkipped] = useState(readSkipped)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState({}) // gid -> 'ok' | error text
  const [open, setOpen] = useState(true)

  const gKey = groups.map((g) => g.id).join(',')
  useEffect(() => {
    if (!groups.length) return
    let cancelled = false
    Promise.all(
      groups.map((g) =>
        Promise.all([
          supabase.rpc('group_weak_spots', { p_group_id: g.id }),
          supabase.rpc('next_group_lesson', { p_group_id: g.id }),
        ]).then(([w, n]) => {
          const list = (w.data || [])
            .filter((r) => r.total >= 5)
            .map((r) => ({ qtype: r.qtype, pct: Math.round((100 * r.correct) / r.total) }))
            .filter((r) => r.pct < 70)
            .sort((a, b) => a.pct - b.pct)
          const row = Array.isArray(n.data) ? n.data[0] : n.data
          return [g.id, list, row?.starts_at || null]
        })
      )
    ).then((rows) => {
      if (cancelled) return
      setWeak(Object.fromEntries(rows.map(([id, l]) => [id, l])))
      setNext(Object.fromEntries(rows.map(([id, , s]) => [id, s])))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gKey])

  const drafts = useMemo(() => {
    if (!weak || !pages) return []
    return groups
      .map((g, i) => {
        for (const w of weak[g.id] || []) {
          const fresh = pages
            .filter((p) => p.question_type === w.qtype && !given[p.url]?.has(g.id))
            .sort((a, b) => {
              const sa = stats[a.url]
              const sb = stats[b.url]
              const ea = sa && sa.tries >= 3 ? sa.avg : null
              const eb = sb && sb.tries >= 3 ? sb.avg : null
              if (ea != null && eb != null) return eb - ea
              return (a.position ?? 0) - (b.position ?? 0)
            })
            .slice(0, PER_GROUP)
          if (fresh.length) return { g, i, w, pages: fresh }
        }
        return null
      })
      .filter(Boolean)
      .filter((d) => !skipped.has(d.g.id))
  }, [weak, pages, groups, given, stats, skipped])

  if (!weak || (!drafts.length && !Object.keys(done).length)) return null

  const dueFor = (gid) => {
    if (next[gid]) return next[gid]
    const d = new Date()
    d.setDate(d.getDate() + 2)
    d.setHours(23, 59, 0, 0)
    return d.toISOString()
  }

  const post = async (d) => {
    setBusy(d.g.id)
    try {
      await postPagesHomework({
        groupId: d.g.id,
        pages: d.pages,
        title: `${qtypeLabel(d.w.qtype)} practice`,
        dueIso: dueFor(d.g.id),
        teacherId: profile?.id,
        telegramLinked: Boolean(d.g.telegram_chat_id),
      })
      setDone((m) => ({ ...m, [d.g.id]: 'ok' }))
      skip(d.g.id)
      onPosted?.()
    } catch (e) {
      setDone((m) => ({ ...m, [d.g.id]: e.message }))
    } finally {
      setBusy('')
    }
  }
  const skip = (gid) =>
    setSkipped((prev) => {
      const n = new Set(prev).add(gid)
      try {
        window.localStorage.setItem(weekKey(), JSON.stringify([...n]))
      } catch {
        /* private window */
      }
      return n
    })
  const postAll = async () => {
    for (const d of drafts) await post(d)
  }

  return (
    <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="focus-ring min-w-0 flex-1 text-left">
          <p className="font-brand text-[17px] font-semibold text-paper">This week’s practice drafts {open ? '' : '›'}</p>
          <p className="text-xs font-semibold text-mist">Ready for each group from its weakest question type — nothing is sent until you press Post.</p>
        </button>
        {drafts.length > 1 && (
          <button type="button" onClick={postAll} disabled={Boolean(busy)} className="focus-ring h-10 rounded-[14px] bg-brass px-4 text-sm font-extrabold text-onbrass disabled:opacity-50">
            Post all {drafts.length}
          </button>
        )}
      </div>
      {open && (
        <ul className="grid gap-2 md:grid-cols-2">
          {drafts.map((d) => {
            const c = groupColour(d.i)
            return (
              <li key={d.g.id} className="flex flex-col gap-2 rounded-[16px] bg-panel-2 p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-lg px-2 py-0.5 text-[12px] font-extrabold ${c.tint} ${c.text}`}>{groupDisplayName(d.g.name)}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-extrabold text-paper">{qtypeLabel(d.w.qtype)}</span>
                  <span className={`shrink-0 rounded-lg px-1.5 py-0.5 text-[11px] font-extrabold ${d.w.pct < 50 ? 'bg-urgent-tint text-coral' : 'bg-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-panel))] text-amber'}`}>{d.w.pct}%</span>
                </div>
                <p className="truncate text-[12px] font-semibold text-paper-dim">{d.pages.map((p) => shortTitle(p.title)).join(' · ')}</p>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-mist">Due {next[d.g.id] ? `next lesson · ${lessonTime(next[d.g.id])}` : 'in 2 days'}</span>
                  {done[d.g.id] && done[d.g.id] !== 'ok' && <span className="truncate text-[11px] font-bold text-coral">{done[d.g.id]}</span>}
                  <button type="button" onClick={() => skip(d.g.id)} className="focus-ring h-8 rounded-[10px] px-2.5 text-[12px] font-extrabold text-mist hover:text-paper">Skip</button>
                  <button type="button" onClick={() => post(d)} disabled={Boolean(busy)} className="focus-ring h-8 rounded-[10px] bg-panel px-3 text-[12px] font-extrabold text-brass hover:ring-1 hover:ring-brass/50 disabled:opacity-50">
                    {busy === d.g.id ? 'Posting…' : 'Post'}
                  </button>
                </div>
              </li>
            )
          })}
          {Object.entries(done)
            .filter(([, v]) => v === 'ok')
            .map(([gid]) => (
              <li key={`ok-${gid}`} className="rounded-[16px] bg-reading-tint px-3 py-2 text-[12px] font-extrabold text-reading">
                Posted to {groupDisplayName(groups.find((g) => g.id === gid)?.name || '')} ✓
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
