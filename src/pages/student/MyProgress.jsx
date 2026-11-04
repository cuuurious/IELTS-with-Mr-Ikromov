import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { SkillIcon } from '../../components/SkillArt'
import WeakSpots from '../../components/WeakSpots'
import { tashkentDay } from '../../lib/homeworkTasks'

/*
 * MY PROGRESS — student (2026-11-02).
 * Every scored task done on the site (homework tasks: tests, practice pages,
 * word lists, shadowing; plus Books shelf practice and released mock
 * bands): the last 30 days at a glance, a 10-week chart per skill, weak
 * spots and the latest results.
 */
const SKILLS = {
  reading: { label: 'Reading', color: '#13807c', tint: 'bg-reading-tint', text: 'text-reading', icon: 'reading' },
  listening: { label: 'Listening', color: '#1f4e8c', tint: 'bg-listening-tint', text: 'text-listening', icon: 'listening' },
  writing: { label: 'Writing', color: '#9a5b12', tint: 'bg-writing-tint', text: 'text-writing', icon: 'writing' },
  vocab: { label: 'Words', color: '#8a6100', tint: 'bg-vocab-tint', text: 'text-vocab', icon: 'vocab' },
  speaking: { label: 'Shadowing', color: '#6a3f99', tint: 'bg-speaking-tint', text: 'text-speaking', icon: 'speaking' },
}
const DAY = 86400000

function skillOfTask(t) {
  if (!t) return 'reading'
  if (t.kind === 'reading' || t.kind === 'listening') return t.kind
  if (t.kind === 'wordlist') return 'vocab'
  if (t.kind === 'shadowing') return 'speaking'
  if (t.skill === 'listening' || t.skill === 'writing') return t.skill
  return 'reading'
}

export default function MyProgress({ studentId }) {
  const [items, setItems] = useState(null)
  const [mocks, setMocks] = useState([])

  useEffect(() => {
    if (!studentId) return undefined
    let cancelled = false
    ;(async () => {
      const since = new Date(Date.now() - 180 * DAY).toISOString()
      const [att, book, mk] = await Promise.all([
        supabase
          .from('homework_attempts')
          .select('id, task_id, homework_id, attempt_no, submitted_at, score, max_score, band, late')
          .eq('user_id', studentId)
          .not('submitted_at', 'is', null)
          .gte('submitted_at', since)
          .order('submitted_at', { ascending: false })
          .limit(500),
        supabase.from('book_practice').select('material_id, score, max_score, created_at').eq('user_id', studentId).gte('created_at', since).limit(500),
        supabase.from('mock_attempts').select('id, band, submitted_at, released_at, exam_id').eq('user_id', studentId).not('released_at', 'is', null).order('submitted_at', { ascending: false }).limit(20),
      ])
      const rows = att.data || []
      const taskIds = [...new Set(rows.map((r) => r.task_id).filter(Boolean))]
      const hwIds = [...new Set(rows.map((r) => r.homework_id).filter(Boolean))]
      const matIds = [...new Set((book.data || []).map((b) => b.material_id))]
      const [tasks, hws, mats] = await Promise.all([
        taskIds.length ? supabase.from('homework_tasks').select('*').in('id', taskIds) : { data: [] },
        hwIds.length ? supabase.from('homeworks').select('id, title').in('id', hwIds) : { data: [] },
        matIds.length ? supabase.from('materials').select('id, title, skill').in('id', matIds) : { data: [] },
      ])
      if (cancelled) return
      const taskById = Object.fromEntries((tasks.data || []).map((t) => [t.id, t]))
      const hwById = Object.fromEntries((hws.data || []).map((h) => [h.id, h]))
      const matById = Object.fromEntries((mats.data || []).map((m) => [m.id, m]))
      const list = [
        ...rows.map((r) => {
          const t = taskById[r.task_id]
          return {
            id: r.id,
            at: r.submitted_at,
            skill: skillOfTask(t),
            title: t?.title || hwById[r.homework_id]?.title || 'Homework test',
            where: hwById[r.homework_id]?.title || 'Homework',
            score: r.score,
            max: r.max_score,
            band: r.band,
            retake: (r.attempt_no || 1) > 1,
          }
        }),
        ...(book.data || []).map((b, i) => ({
          id: `b${i}`,
          at: b.created_at,
          skill: matById[b.material_id]?.skill === 'listening' ? 'listening' : 'reading',
          title: matById[b.material_id]?.title || 'Books shelf',
          where: 'Books shelf',
          score: b.score,
          max: b.max_score,
        })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at))
      setItems(list)
      setMocks((mk.data || []).filter((m) => m.band != null))
    })()
    return () => {
      cancelled = true
    }
  }, [studentId])

  const view = useMemo(() => {
    if (!items) return null
    const now = Date.now()
    const scored = items.filter((i) => i.score != null && i.max > 0)
    const pct = (i) => (100 * i.score) / i.max
    const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, i) => s + pct(i), 0) / arr.length) : null)
    const last30 = scored.filter((i) => now - new Date(i.at) < 30 * DAY)
    const prev30 = scored.filter((i) => now - new Date(i.at) >= 30 * DAY && now - new Date(i.at) < 60 * DAY)
    // Days in a row with at least one task (today or yesterday to count).
    const days = new Set(items.map((i) => tashkentDay(new Date(i.at))))
    let streak = 0
    const d = new Date()
    if (!days.has(tashkentDay(d))) d.setDate(d.getDate() - 1)
    while (days.has(tashkentDay(d))) {
      streak += 1
      d.setDate(d.getDate() - 1)
    }
    // 10 weeks, Monday-based, oldest first.
    const monday = new Date()
    monday.setHours(0, 0, 0, 0)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    const weeks = Array.from({ length: 10 }, (_, k) => new Date(monday.getTime() - (9 - k) * 7 * DAY))
    const series = Object.keys(SKILLS)
      .map((k) => {
        const pts = weeks.map((w) => {
          const inWeek = scored.filter((i) => i.skill === k && new Date(i.at) >= w && new Date(i.at) < new Date(w.getTime() + 7 * DAY))
          return avg(inWeek)
        })
        return { k, pts }
      })
      .filter((s) => s.pts.some((p) => p != null))
    const bySkill = Object.keys(SKILLS)
      .map((k) => {
        const mine = scored.filter((i) => i.skill === k)
        return { k, n: mine.length, avg: avg(mine), recent: avg(mine.slice(0, 5)) }
      })
      .filter((s) => s.n > 0)
    return { done30: items.filter((i) => now - new Date(i.at) < 30 * DAY).length, avg30: avg(last30), avgPrev: avg(prev30), streak, weeks, series, bySkill, best: [...bySkill].sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0))[0] }
  }, [items])

  if (!view) return <p className="text-sm font-semibold text-mist">Loading…</p>

  const trend = view.avg30 != null && view.avgPrev != null ? view.avg30 - view.avgPrev : null

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Tasks in 30 days" value={view.done30} />
        <Tile
          label="Average score · 30 days"
          value={view.avg30 != null ? `${view.avg30}%` : '—'}
          sub={trend == null ? null : trend === 0 ? 'same as the month before' : `${trend > 0 ? '▲' : '▼'} ${Math.abs(trend)}% vs the month before`}
          subTone={trend > 0 ? 'text-sage' : trend < 0 ? 'text-coral' : 'text-mist'}
        />
        <Tile label="Days in a row" value={view.streak} sub={view.streak ? 'keep it going' : 'do one task today'} />
        <Tile label="Strongest" value={view.best ? SKILLS[view.best.k].label : '—'} sub={view.best ? `${view.best.avg}% average` : 'no scores yet'} />
      </div>

      <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto font-brand text-[18px] font-semibold text-paper">Last 10 weeks</h2>
          {view.series.map((s) => (
            <span key={s.k} className="flex items-center gap-1.5 text-[12px] font-extrabold text-paper-dim">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: SKILLS[s.k].color }} />
              {SKILLS[s.k].label}
            </span>
          ))}
        </div>
        {view.series.length ? <Chart weeks={view.weeks} series={view.series} /> : <p className="rounded-[14px] bg-panel-2/60 px-4 py-6 text-center text-sm font-semibold text-mist">Your scores will appear here after your first tasks.</p>}
      </section>

      {view.bySkill.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.bySkill.map((s) => {
            const look = SKILLS[s.k]
            return (
              <div key={s.k} className={`flex items-center gap-4 rounded-[20px] px-4 py-4 ${look.tint}`}>
                <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/70 ${look.text}`}>
                  <SkillIcon skill={look.icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className={`text-[13px] font-extrabold ${look.text}`}>{look.label}</p>
                  <p className="font-brand text-[24px] font-semibold leading-none text-paper">{s.avg}%</p>
                  <p className="text-[12px] font-bold text-paper-dim">{s.n} tasks · last 5: {s.recent}%</p>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {mocks.length > 0 && (
        <section className="flex flex-wrap items-center gap-2 rounded-[20px] border border-line bg-panel p-4">
          <span className="text-sm font-extrabold text-paper-dim">Mock test bands:</span>
          {mocks.map((m) => (
            <span key={m.id} className="rounded-xl bg-panel-2 px-2.5 py-1 text-[13px] font-extrabold text-paper">
              {Number(m.band).toFixed(1)} · {new Date(m.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </span>
          ))}
        </section>
      )}

      <WeakSpots userId={studentId} title="My weak spots" compact />

      <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-5">
        <h2 className="font-brand text-[18px] font-semibold text-paper">Latest results</h2>
        {items.length === 0 ? (
          <p className="text-sm font-semibold text-mist">Nothing yet — your homework tasks will show up here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {items.slice(0, 25).map((i) => {
              const look = SKILLS[i.skill]
              const p = i.score != null && i.max > 0 ? Math.round((100 * i.score) / i.max) : null
              return (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${look.tint} ${look.text}`}>
                    <SkillIcon skill={look.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-extrabold text-paper">{i.title}</span>
                    <span className="block truncate text-[12px] font-bold text-mist">
                      {new Date(i.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · {i.where}
                      {i.retake ? ' · retake' : ''}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-xl px-2.5 py-1 text-[13px] font-extrabold ${p == null ? 'bg-panel-2 text-mist' : p >= 75 ? 'bg-sage/15 text-sage' : p >= 55 ? 'bg-saffron/20 text-brass' : 'bg-urgent-tint text-coral'}`}>
                    {p == null ? 'Done' : `${i.score}/${i.max}${i.band ? ` · ${Number(i.band).toFixed(1)}` : ''}`}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

function Tile({ label, value, sub, subTone = 'text-mist' }) {
  return (
    <div className="flex flex-col gap-1 rounded-[20px] border border-line bg-panel px-4 py-4">
      <span className="text-[12px] font-extrabold text-mist">{label}</span>
      <span className="font-brand text-[28px] font-semibold leading-none text-paper">{value}</span>
      {sub && <span className={`text-[12px] font-bold ${subTone}`}>{sub}</span>}
    </div>
  )
}

// Weekly average per skill: one line each, 0–100%.
function Chart({ weeks, series }) {
  const W = 520, H = 210, L = 30, R = 12, T = 10, B = 26
  const x = (k) => L + (k * (W - L - R)) / (weeks.length - 1)
  const y = (v) => T + ((100 - v) * (H - T - B)) / 100
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-auto w-full max-w-2xl" role="img" aria-label="Weekly average score by skill">
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-line" strokeWidth="1" />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="12" fill="currentColor" className="text-mist">{v}</text>
        </g>
      ))}
      {weeks.map((w, k) =>
        k % 2 === 1 || k === weeks.length - 1 ? (
          <text key={k} x={x(k)} y={H - 6} textAnchor={k === weeks.length - 1 ? "end" : "middle"} fontSize="12" fill="currentColor" className="text-mist">
            {w.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
          </text>
        ) : null
      )}
      {series.map((s) => {
        const color = SKILLS[s.k].color
        const segs = []
        let cur = []
        s.pts.forEach((v, k) => {
          if (v == null) {
            if (cur.length) segs.push(cur)
            cur = []
          } else cur.push([x(k), y(v)])
        })
        if (cur.length) segs.push(cur)
        return (
          <g key={s.k}>
            {segs.map((seg, i) => (
              <polyline key={i} points={seg.map((p) => p.join(',')).join(' ')} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {s.pts.map((v, k) => (v == null ? null : <circle key={k} cx={x(k)} cy={y(v)} r="3.5" fill={color} />))}
          </g>
        )
      })}
    </svg>
  )
}
