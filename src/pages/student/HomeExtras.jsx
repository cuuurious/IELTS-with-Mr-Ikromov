import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { VocabArt } from '../../components/SkillArt'

/*
 * Extra cards for the student Home (2026-10-06), ideas taken from
 * multilevelrecord.com's home page and built on our own data:
 *   - Word of the day: one word from the student's own word lists,
 *     the same word all day, a different one tomorrow.
 *   - Learning curve: average word-test score per week, last 8 weeks.
 *   - When you practise: morning / afternoon / evening / night split of
 *     word tests, reviews and homework hand-ins over the last 60 days.
 * Read-only; RLS already limits every query to the student's own rows
 * (word list items: only lists shared with their group).
 */

const DAY = 86400000

function Card({ className = '', children }) {
  return <section className={`rounded-[22px] border border-line bg-panel ${className}`}>{children}</section>
}

function dayNumber(d = new Date()) {
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY)
}

export function useStudyActivity(studentId) {
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    const since = new Date(Date.now() - 60 * DAY).toISOString()
    Promise.all([
      supabase.from('wordlist_attempts').select('percentage, score, total, created_at').eq('student_id', studentId).gte('created_at', since),
      supabase.from('word_review_sessions').select('correct, total, created_at').eq('student_id', studentId).gte('created_at', since),
      supabase
        .from('submissions')
        .select('homework_id, submitted_at')
        .eq('student_id', studentId)
        .eq('status', 'done')
        .gte('submitted_at', since),
      // Completions survive a teacher reset — count those hand-ins too.
      supabase
        .from('homework_completions')
        .select('homework_id, completed_at')
        .eq('student_id', studentId)
        .gte('completed_at', since),
    ])
      .then(([tests, reviews, subs, comps]) => {
        if (cancelled) return
        const seen = new Set((subs.data || []).map((s) => s.homework_id))
        const merged = [...(subs.data || [])]
        for (const c of comps.data || []) {
          if (seen.has(c.homework_id)) continue
          seen.add(c.homework_id)
          merged.push({ homework_id: c.homework_id, submitted_at: c.completed_at })
        }
        setData({ tests: tests.data || [], reviews: reviews.data || [], subs: merged })
      })
      .catch(() => {
        if (!cancelled) setData({ tests: [], reviews: [], subs: [] })
      })
    return () => {
      cancelled = true
    }
  }, [studentId])
  return data
}

/* ---------------- Word of the day ---------------- */

export function WordOfTheDay({ onNavigate, className = '' }) {
  const [word, setWord] = useState(undefined)
  const [flipped, setFlipped] = useState(false)

  // 2026-10-06: used to download up to 2000 words to show one. Now it
  // counts the words, then fetches just the one for today (same
  // id order, so the pick is stable for the day).
  useEffect(() => {
    let cancelled = false

    const withWord = (query) => query.not('word', 'is', null).neq('word', '')

    const load = async () => {
      try {
        const { count, error: countError } = await withWord(
          supabase.from('wordlist_items').select('id', { count: 'exact', head: true })
        )
        if (countError) throw countError
        if (!count) {
          if (!cancelled) setWord(null)
          return
        }

        const n = dayNumber() % count
        const { data, error } = await withWord(
          supabase
            .from('wordlist_items')
            .select('id, word, definition, uzbek_translation, example_sentence')
        )
          .order('id')
          .range(n, n)
        if (error) throw error

        if (!cancelled) setWord(data?.[0] || null)
      } catch {
        if (!cancelled) setWord(null)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [])

  if (word === null) return null

  return (
    <Card className={`flex flex-col gap-3 p-6 ${className}`}>
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-vocab">Word of the day</h2>
        <span className="text-[13px] text-mist">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
        </span>
      </div>
      {word === undefined ? (
        <div className="h-24 animate-pulse rounded-xl bg-panel-2" />
      ) : (
        <>
          <p className="text-[26px] font-semibold leading-tight tracking-[-0.02em]">{word.word}</p>
          {word.definition && <p className="text-[15px] leading-relaxed text-paper-dim">{word.definition}</p>}
          {word.example_sentence && (
            <p className="rounded-xl bg-vocab-tint px-3.5 py-2.5 text-sm italic leading-relaxed text-vocab">“{word.example_sentence}”</p>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {word.uzbek_translation && (
              <button
                type="button"
                onClick={() => setFlipped((f) => !f)}
                aria-pressed={flipped}
                className="focus-ring inline-flex h-9 items-center rounded-[10px] border border-line px-3 text-sm font-medium hover:bg-panel-2"
              >
                {flipped ? word.uzbek_translation : 'Show in Uzbek'}
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('wordlists')}
              className="focus-ring inline-flex h-9 items-center rounded-[10px] px-3 text-sm font-medium text-paper-dim hover:text-paper"
            >
              Word lists
            </button>
          </div>
        </>
      )}
    </Card>
  )
}

/* ---------------- Learning curve ---------------- */

function weekStart(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const day = (x.getDay() + 6) % 7 // Monday = 0
  x.setDate(x.getDate() - day)
  return x
}

export function LearningCurve({ activity, onNavigate, className = '' }) {
  const weeks = useMemo(() => {
    if (!activity) return null
    const thisWeek = weekStart(new Date())
    const buckets = Array.from({ length: 8 }, (_, i) => {
      const start = new Date(thisWeek)
      start.setDate(start.getDate() - (7 - i) * 7)
      return { start, scores: [] }
    })
    const add = (when, pct) => {
      if (pct == null || Number.isNaN(pct)) return
      const t = new Date(when).getTime()
      for (let i = buckets.length - 1; i >= 0; i--) {
        if (t >= buckets[i].start.getTime()) {
          buckets[i].scores.push(pct)
          return
        }
      }
    }
    for (const a of activity.tests) add(a.created_at, a.percentage != null ? Number(a.percentage) : a.total ? (a.score / a.total) * 100 : null)
    for (const r of activity.reviews) add(r.created_at, r.total ? (r.correct / r.total) * 100 : null)
    return buckets.map((b) => ({
      start: b.start,
      avg: b.scores.length ? Math.round(b.scores.reduce((x, y) => x + y, 0) / b.scores.length) : null,
      n: b.scores.length,
    }))
  }, [activity])

  const points = (weeks || []).map((w, i) => ({ ...w, i })).filter((w) => w.avg != null)
  const last = points[points.length - 1]
  const first = points[0]
  const change = points.length >= 2 ? last.avg - first.avg : null

  const W = 320
  const H = 120
  const x = (i) => 12 + (i / 7) * (W - 24)
  const y = (v) => H - 14 - (v / 100) * (H - 28)
  const path = points.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.avg).toFixed(1)}`).join(' ')
  const area = points.length >= 2 ? `${path} L${x(last.i).toFixed(1)} ${H - 14} L${x(first.i).toFixed(1)} ${H - 14} Z` : ''

  return (
    <Card className={`flex flex-col gap-3 p-6 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">Your learning curve</h2>
        <span className="text-[13px] text-mist">Word tests, last 8 weeks</span>
      </div>
      {!weeks ? (
        <div className="h-[140px] animate-pulse rounded-xl bg-panel-2" />
      ) : points.length === 0 ? (
        <div className="flex flex-1 items-center gap-4 rounded-2xl bg-vocab-tint p-4">
          <VocabArt front="progress" back="o‘sish" className="h-20 w-36 shrink-0" />
          <div className="flex flex-col gap-2">
            <p className="text-sm text-vocab">Take a few word tests and your curve appears here.</p>
            <button
              type="button"
              onClick={() => onNavigate('wordlists')}
              className="focus-ring w-fit rounded-[10px] bg-panel px-3 py-1.5 text-sm font-semibold text-vocab"
            >
              Open word lists
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-end gap-3">
            <span className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{last.avg}%</span>
            <span className="pb-1 text-sm text-mist">
              {change == null
                ? 'average this week'
                : change > 0
                  ? `up ${change} points since ${first.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                  : change < 0
                    ? `down ${-change} points since ${first.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                    : 'steady'}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[130px] w-full" role="img" aria-label={`Weekly word-test average: ${points.map((p) => `${p.avg}%`).join(', ')}`}>
            {[25, 50, 75, 100].map((g) => (
              <line key={g} x1="12" x2={W - 12} y1={y(g)} y2={y(g)} style={{ stroke: 'var(--color-line)' }} strokeWidth="1" />
            ))}
            {area && <path d={area} style={{ fill: 'var(--color-vocab-tint)' }} />}
            <path d={path} fill="none" style={{ stroke: 'var(--color-vocab)' }} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p) => (
              <circle key={p.i} cx={x(p.i)} cy={y(p.avg)} r={p === last ? 5 : 3.5} style={{ fill: p === last ? 'var(--color-vocab)' : 'var(--color-panel)', stroke: 'var(--color-vocab)' }} strokeWidth="2">
                <title>{`Week of ${p.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${p.avg}% (${p.n} ${p.n === 1 ? 'test' : 'tests'})`}</title>
              </circle>
            ))}
          </svg>
        </>
      )}
    </Card>
  )
}

/* ---------------- When you practise ---------------- */

const SLOTS = [
  { key: 'morning', label: 'Morning', range: '5–12', from: 5, to: 12, tone: 'bg-vocab' },
  { key: 'afternoon', label: 'Afternoon', range: '12–17', from: 12, to: 17, tone: 'bg-writing' },
  { key: 'evening', label: 'Evening', range: '17–22', from: 17, to: 22, tone: 'bg-speaking' },
  { key: 'night', label: 'Night', range: '22–5', from: 22, to: 29, tone: 'bg-listening' },
]

export function PracticeTime({ activity, className = '' }) {
  const split = useMemo(() => {
    if (!activity) return null
    const counts = Object.fromEntries(SLOTS.map((s) => [s.key, 0]))
    const times = [
      ...activity.tests.map((a) => a.created_at),
      ...activity.reviews.map((r) => r.created_at),
      ...activity.subs.map((s) => s.submitted_at),
    ].filter(Boolean)
    for (const t of times) {
      let h = new Date(t).getHours()
      if (h < 5) h += 24
      const slot = SLOTS.find((s) => h >= s.from && h < s.to) || SLOTS[3]
      counts[slot.key] += 1
    }
    return { counts, total: times.length }
  }, [activity])

  const top = split?.total ? SLOTS.reduce((a, b) => (split.counts[b.key] > split.counts[a.key] ? b : a)) : null

  return (
    <Card className={`flex flex-col gap-4 p-6 ${className}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[17px] font-semibold">When you study</h2>
        <span className="text-[13px] text-mist">Last 60 days</span>
      </div>
      {!split ? (
        <div className="h-[110px] animate-pulse rounded-xl bg-panel-2" />
      ) : split.total === 0 ? (
        <p className="text-sm text-mist">Your study times will show here after a few word tests or homeworks.</p>
      ) : (
        <>
          <p className="text-[15px] leading-snug">
            You study most in the <strong className="font-semibold">{top.label.toLowerCase()}</strong>.
          </p>
          <div className="flex h-3 overflow-hidden rounded-full bg-panel-2" aria-hidden="true">
            {SLOTS.map((s) =>
              split.counts[s.key] ? (
                <span key={s.key} className={s.tone} style={{ width: `${(split.counts[s.key] / split.total) * 100}%` }} />
              ) : null
            )}
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {SLOTS.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.tone}`} />
                <span className="flex-1 leading-tight text-paper-dim">
                  {s.label}
                  <span className="block text-xs text-mist">{s.range}</span>
                </span>
                <span className="font-semibold tabular-nums">{Math.round((split.counts[s.key] / split.total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}
