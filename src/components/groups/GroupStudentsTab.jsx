import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { getSubmissionStatus } from '../StampBadge'
import { gradeTone, percentOf, summariseAttempts } from '../../lib/homeworkTasks'
import { qtypeLabel } from '../../lib/questionTypes'
import WeakSpots from '../WeakSpots'

/*
 * Group page → Students tab (2026-11-05).
 * One card per student: homework done, average score (first tries of
 * in-site tasks), attendance, missed-in-a-row and their weakest question
 * type. "Needs a word" students come first.
 */
const MIN_ANSWERS = 5

function Stat({ label, value, tone = 'text-paper' }) {
  return (
    <div className="min-w-0 rounded-[12px] bg-panel-2 px-2.5 py-1.5">
      <p className={`truncate text-[15px] font-extrabold leading-tight ${tone}`}>{value}</p>
      <p className="truncate text-[11px] font-bold text-mist">{label}</p>
    </div>
  )
}

export default function GroupStudentsTab({ groupId, roster, homeworks, submissions, accent, busyAction, onRemove }) {
  const [search, setSearch] = useState('')
  const [avg, setAvg] = useState({}) // user id -> %
  const [att, setAtt] = useState({}) // user id -> { came, total }
  const [weak, setWeak] = useState({}) // user id -> label

  const hwKey = homeworks.map((h) => h.id).join(',')
  const rosterKey = roster.map((r) => r.id).join(',')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ids = homeworks.map((h) => h.id)
      if (ids.length) {
        const { data: t } = await supabase.from('homework_tasks').select('id').in('homework_id', ids)
        if (t?.length) {
          const { data: a } = await supabase
            .from('homework_attempts')
            .select('id, task_id, user_id, attempt_no, submitted_at, score, max_score')
            .in('task_id', t.map((x) => x.id))
            .not('submitted_at', 'is', null)
          const groups = {}
          ;(a || []).forEach((x) => {
            const k = `${x.task_id}_${x.user_id}`
            ;(groups[k] = groups[k] || []).push(x)
          })
          const sums = {}
          Object.entries(groups).forEach(([k, list]) => {
            const pct = percentOf(summariseAttempts(list).first)
            if (pct == null) return
            const uid = k.slice(k.indexOf('_') + 1)
            sums[uid] = sums[uid] || { s: 0, n: 0 }
            sums[uid].s += pct
            sums[uid].n += 1
          })
          if (!cancelled) setAvg(Object.fromEntries(Object.entries(sums).map(([u, v]) => [u, Math.round(v.s / v.n)])))
        }
      }
      // Attendance (migration_89) — quiet if not run yet.
      const { data: gl } = await supabase.from('group_lessons').select('id').eq('group_id', groupId)
      if (gl?.length) {
        const { data: rows } = await supabase.from('lesson_attendance').select('student_id, status').in('group_lesson_id', gl.map((x) => x.id))
        const m = {}
        ;(rows || []).forEach((r) => {
          if (r.status === 'excused') return
          m[r.student_id] = m[r.student_id] || { came: 0, total: 0 }
          m[r.student_id].total += 1
          if (r.status === 'present' || r.status === 'late') m[r.student_id].came += 1
        })
        if (!cancelled) setAtt(m)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, hwKey])

  // Weakest question type per student (one small call each).
  useEffect(() => {
    let cancelled = false
    Promise.all(
      roster.map((st) =>
        supabase.rpc('weak_spots', { p_user_id: st.id }).then(({ data, error }) => {
          if (error) return [st.id, null]
          const w = (data || [])
            .filter((r) => r.total >= MIN_ANSWERS)
            .map((r) => ({ ...r, pct: Math.round((100 * r.correct) / r.total) }))
            .sort((a, b) => a.pct - b.pct)[0]
          return [st.id, w && w.pct < 60 ? `${qtypeLabel(w.qtype)} · ${w.pct}%` : null]
        })
      )
    ).then((pairs) => !cancelled && setWeak(Object.fromEntries(pairs)))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey])

  const rows = useMemo(() => {
    const now = Date.now()
    const pastDue = homeworks
      .filter((h) => h.due_date && new Date(h.due_date).getTime() <= now)
      .sort((a, b) => new Date(b.due_date) - new Date(a.due_date))
    return roster
      .map((st) => {
        const states = pastDue.map((h) => getSubmissionStatus(submissions[`${h.id}_${st.id}`], h.due_date))
        const done = homeworks.filter((h) => ['done', 'late'].includes(getSubmissionStatus(submissions[`${h.id}_${st.id}`], h.due_date))).length
        let streak = 0
        for (const x of states) {
          if (x === 'overdue') streak += 1
          else break
        }
        const last4 = states.slice(0, 4)
        const missed = last4.filter((x) => x === 'overdue').length
        const late = last4.filter((x) => x === 'late').length
        const reason = streak >= 2 ? `${streak} missed in a row` : missed >= 2 ? `${missed} of last 4 missed` : late >= 2 ? `Late ${late} times` : null
        return { st, done, streak, reason, weight: streak * 10 + missed * 3 + late }
      })
      .sort((a, b) => b.weight - a.weight || (a.st.full_name || '').localeCompare(b.st.full_name || ''))
  }, [roster, homeworks, submissions])

  const q = search.trim().toLowerCase()
  const shown = q ? rows.filter(({ st }) => `${st.full_name || ''} ${st.username || ''}`.toLowerCase().includes(q)) : rows
  const needWord = rows.filter((r) => r.reason).length

  if (!roster.length) {
    return (
      <section className="rounded-[20px] border border-dashed border-line bg-panel px-5 py-10 text-center">
        <p className="font-brand text-[17px] font-semibold text-paper">No students yet</p>
        <p className="mt-1 text-sm font-semibold text-mist">Share the group’s join code; students appear here once you approve them.</p>
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search students…"
          className="focus-ring h-11 min-w-0 flex-1 rounded-[14px] border border-line bg-panel px-4 text-sm text-paper placeholder:text-mist/70"
        />
        <p className="shrink-0 px-1 text-xs font-extrabold text-mist">
          {q ? `${shown.length} of ${roster.length}` : `${roster.length} students`}
          {needWord > 0 && <span className="ml-2 rounded-lg bg-urgent-tint px-2 py-0.5 text-coral">{needWord} need a word</span>}
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shown.map(({ st, done, streak, reason }) => {
          const a = avg[st.id]
          const tone = gradeTone(a ?? null)
          const at = att[st.id]
          const attPct = at?.total ? Math.round((at.came / at.total) * 100) : null
          return (
            <li key={st.id} className={`flex flex-col gap-3 rounded-[20px] border bg-panel p-4 ${reason ? 'border-coral/40' : 'border-line'}`}>
              <div className="flex items-center gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-extrabold ${accent.tint} ${accent.text}`}>
                  {st.full_name?.charAt(0)?.toUpperCase() || '?'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-extrabold text-paper">{st.full_name || st.username}</p>
                  <p className="truncate text-xs font-semibold text-mist">@{st.username}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(st)}
                  disabled={busyAction === `remove-${st.id}`}
                  title="Remove student from this group"
                  aria-label={`Remove ${st.full_name || st.username} from this group`}
                  className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-xl text-mist transition hover:bg-urgent-tint hover:text-coral disabled:opacity-40"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <Stat label="done" value={`${done}/${homeworks.length}`} />
                <Stat label="avg" value={a == null ? '—' : `${a}%`} tone={a == null ? 'text-mist' : tone.text} />
                <Stat label="came" value={attPct == null ? '—' : `${attPct}%`} tone={attPct == null ? 'text-mist' : attPct < 75 ? 'text-coral' : 'text-paper'} />
                <Stat label="misses" value={streak} tone={streak >= 2 ? 'text-coral' : 'text-paper'} />
              </div>
              {(reason || weak[st.id]) && (
                <div className="flex flex-wrap gap-1.5">
                  {reason && <span className={`rounded-lg px-2 py-1 text-[12px] font-extrabold ${reason.startsWith('Late') ? 'bg-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-panel))] text-amber' : 'bg-urgent-tint text-coral'}`}>{reason}</span>}
                  {weak[st.id] && <span className="rounded-lg bg-panel-2 px-2 py-1 text-[12px] font-extrabold text-paper-dim">Weak: {weak[st.id]}</span>}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <WeakSpots groupId={groupId} title="Class weak spots" compact />
    </div>
  )
}
