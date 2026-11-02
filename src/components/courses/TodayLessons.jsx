import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { groupDisplayName } from '../../lib/groupLook'
import { hhmm, slidesHref, tashkentDate } from '../../lib/courses'

/*
 * "Today's lessons" on the teacher's Home (2026-11-02, migration_88):
 * every group's lesson today with its plan, slides and class files, and
 * whether its homework has gone out yet.
 */
export default function TodayLessons({ onOpenGroup }) {
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const day = tashkentDate()
      const from = new Date(`${day}T00:00:00+05:00`).toISOString()
      const to = new Date(`${day}T23:59:59+05:00`).toISOString()
      const { data: gl, error } = await supabase
        .from('group_lessons')
        .select('id, group_id, plan_id, number, starts_at, ends_at, status, homework_id')
        .gte('starts_at', from)
        .lte('starts_at', to)
        .order('starts_at')
      if (cancelled || error || !gl?.length) return setRows([])
      const [g, pl, cp] = await Promise.all([
        supabase.from('groups').select('id, name').in('id', [...new Set(gl.map((x) => x.group_id))]),
        supabase.from('plan_lessons').select('plan_id, number, title, slides_url, slides_name, materials').in('plan_id', [...new Set(gl.map((x) => x.plan_id))]),
        supabase.from('course_plans').select('id, title').in('id', [...new Set(gl.map((x) => x.plan_id))]),
      ])
      if (cancelled) return
      const gname = Object.fromEntries((g.data || []).map((x) => [x.id, groupDisplayName(x.name)]))
      const ptitle = Object.fromEntries((cp.data || []).map((x) => [x.id, x.title]))
      const lesson = Object.fromEntries((pl.data || []).map((x) => [`${x.plan_id}:${x.number}`, x]))
      setRows(gl.map((x) => ({ ...x, group: gname[x.group_id], plan: ptitle[x.plan_id], lesson: lesson[`${x.plan_id}:${x.number}`] || {} })))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!rows || rows.length === 0) return null
  const now = Date.now()

  return (
    <section aria-label="Today's lessons" className="lg:col-span-12 flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
      <h2 className="font-brand text-[18px] font-semibold text-paper">Today’s lessons</h2>
      <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const live = new Date(r.starts_at).getTime() <= now && new Date(r.ends_at).getTime() > now
          const over = new Date(r.ends_at).getTime() <= now
          return (
            <div key={r.id} className={`flex flex-col gap-2 rounded-[16px] p-4 ${live ? 'bg-[color-mix(in_srgb,var(--color-saffron)_14%,var(--color-panel))] ring-1 ring-saffron' : 'bg-panel-2/60'}`}>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-panel px-2 py-0.5 text-[12px] font-extrabold text-paper">{hhmm(r.starts_at)}–{hhmm(r.ends_at)}</span>
                <button type="button" onClick={() => onOpenGroup?.(r.group_id)} className="focus-ring truncate text-sm font-extrabold text-brass hover:underline">{r.group}</button>
                {live && <span className="ml-auto rounded-lg bg-saffron px-2 py-0.5 text-[11px] font-extrabold text-[#17213a]">Now</span>}
              </div>
              <p className="text-[15px] font-extrabold text-paper">{r.plan} · Lesson {r.number}: {r.lesson.title || 'not written yet'}</p>
              <div className="flex flex-wrap gap-1.5">
                {r.lesson.slides_url && <a href={slidesHref(r.lesson.slides_url, r.lesson.slides_name)} target="_blank" rel="noreferrer" className="rounded-lg bg-speaking-tint px-2 py-1 text-[12px] font-extrabold text-speaking">Slides</a>}
                {(r.lesson.materials || []).map((m, i) => (
                  <a key={i} href={slidesHref(m.url, m.name)} target="_blank" rel="noreferrer" className="rounded-lg bg-panel px-2 py-1 text-[12px] font-extrabold text-brass">{m.name}</a>
                ))}
              </div>
              <p className="text-[12px] font-bold text-mist">{r.status === 'posted' ? 'Homework posted' : over ? 'Homework posting…' : 'Homework posts when class ends'}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
