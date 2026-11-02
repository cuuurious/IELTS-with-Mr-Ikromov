import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { lessonDay, lessonTime, slidesHref } from '../../lib/courses'

/*
 * "My course" for students (2026-11-02, migration_88): where the group is
 * in its course (Foundation · Lesson 14 of 36), when the next lesson is,
 * and the slides of every lesson so far — for anyone who missed class.
 */
export default function StudentCourseCard({ groupId }) {
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!groupId) return undefined
    let cancelled = false
    supabase.rpc('my_course_lessons', { p_group_id: groupId }).then(({ data, error }) => {
      if (!cancelled) setRows(error ? [] : data || [])
    })
    return () => {
      cancelled = true
    }
  }, [groupId])

  if (!rows || rows.length === 0) return null

  const now = Date.now()
  const had = rows.filter((r) => new Date(r.starts_at).getTime() <= now)
  const next = rows.find((r) => new Date(r.starts_at).getTime() > now && r.status === 'planned')
  const total = rows[0].total || rows.length
  const current = had.length ? had[had.length - 1].number : 0
  const pct = total ? Math.round((current / total) * 100) : 0
  const recent = [...had].reverse().slice(0, open ? had.length : 4)

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-4 bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] px-5 py-4 text-white">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">My course</p>
          <p className="font-brand text-[20px] font-semibold leading-tight">{rows[0].plan_title} · Lesson {Math.max(current, 1)} of {total}</p>
          <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-saffron" style={{ width: `${pct}%` }} /></div>
        </div>
        {next && (
          <div className="rounded-[14px] bg-white/15 px-3.5 py-2 text-[13px] font-bold">
            Next: Lesson {next.number}
            <span className="block text-white/85">{lessonTime(next.starts_at)}</span>
          </div>
        )}
      </div>
      {had.length > 0 && (
        <div className="flex flex-col gap-2 p-4">
          <p className="text-[13px] font-extrabold text-paper-dim">Missed a lesson? Study the slides.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {recent.map((r) => (
              <li key={r.number} className="flex items-center gap-3 rounded-[14px] bg-panel-2/60 px-3 py-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] font-brand text-[14px] font-semibold text-brass">{r.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold text-paper">{r.title || `Lesson ${r.number}`}</span>
                  <span className="block text-[12px] font-bold text-mist">{lessonDay(r.starts_at)}</span>
                </span>
                {r.slides_url ? (
                  <a href={slidesHref(r.slides_url, r.slides_name)} target="_blank" rel="noreferrer" className="focus-ring shrink-0 rounded-[12px] bg-speaking-tint px-3 py-1.5 text-[13px] font-extrabold text-speaking">
                    Slides
                  </a>
                ) : (
                  <span className="shrink-0 text-[12px] font-bold text-mist">No slides</span>
                )}
              </li>
            ))}
          </ul>
          {had.length > 4 && (
            <button type="button" onClick={() => setOpen((v) => !v)} className="focus-ring self-start text-[13px] font-extrabold text-brass">
              {open ? 'Show fewer' : `All ${had.length} lessons`}
            </button>
          )}
        </div>
      )}
    </section>
  )
}
