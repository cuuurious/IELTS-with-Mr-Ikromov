import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { WEEKDAYS, hhmm, lessonDay, lessonTime, slidesHref, tashkentDate } from '../../lib/courses'
import AttendanceModal from './AttendanceModal'

/*
 * A group's course (2026-11-02, migration_88): which course it follows,
 * lesson days and times, and the lesson timeline. Each lesson's homework
 * is posted by itself when the lesson ends; the teacher can post early,
 * move a lesson (holiday — later lessons shift) or switch auto-posting off.
 */
export default function GroupCoursePanel({ groupId, accent, onPosted }) {
  const [course, setCourse] = useState(undefined) // undefined loading, null none, false not set up
  const [plans, setPlans] = useState([])
  const [lessons, setLessons] = useState([])
  const [titles, setTitles] = useState({})
  const [editing, setEditing] = useState(false) // false | true | { suggest: planId }
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [attendance, setAttendance] = useState({}) // group_lesson_id -> { came, total }
  const [marking, setMarking] = useState(null) // lesson being marked

  const load = async () => {
    const [c, p] = await Promise.all([
      supabase.from('group_courses').select('*').eq('group_id', groupId).maybeSingle(),
      supabase.from('course_plans').select('id, title, next_plan_id').order('sort_order').order('created_at'),
    ])
    if (c.error && /group_courses/.test(c.error.message)) {
      setCourse(false)
      return
    }
    setPlans(p.data || [])
    setCourse(c.data || null)
    if (c.data) {
      const [l, t] = await Promise.all([
        supabase.from('group_lessons').select('*').eq('group_id', groupId).eq('plan_id', c.data.plan_id).order('number'),
        supabase.from('plan_lessons').select('number, title, slides_url, slides_name, materials').eq('plan_id', c.data.plan_id),
      ])
      setLessons(l.data || [])
      setTitles(Object.fromEntries((t.data || []).map((r) => [r.number, r])))
      // Attendance counts (migration_89) — quietly empty before it is run.
      const startedIds = (l.data || []).filter((x) => new Date(x.starts_at).getTime() <= Date.now()).map((x) => x.id)
      if (startedIds.length) {
        const { data: att } = await supabase.from('lesson_attendance').select('group_lesson_id, status').in('group_lesson_id', startedIds)
        const map = {}
        ;(att || []).forEach((r) => {
          map[r.group_lesson_id] = map[r.group_lesson_id] || { came: 0, total: 0 }
          map[r.group_lesson_id].total += 1
          if (r.status === 'present' || r.status === 'late') map[r.group_lesson_id].came += 1
        })
        setAttendance(map)
      }
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  const plan = plans.find((p) => p.id === course?.plan_id)
  const total = Object.keys(titles).length
  const now = Date.now()
  const done = lessons.filter((l) => l.status === 'posted').length
  const next = lessons.find((l) => l.status === 'planned')
  const today = lessons.filter((l) => tashkentDate(new Date(l.starts_at)) === tashkentDate())

  const shown = useMemo(() => {
    if (showAll) return lessons
    const i = lessons.findIndex((l) => l.status === 'planned')
    const from = Math.max(0, (i === -1 ? lessons.length : i) - 2)
    return lessons.slice(from, from + 8)
  }, [lessons, showAll])

  const act = async (key, fn) => {
    setBusy(key)
    setError('')
    const { error: e } = await fn()
    setBusy('')
    if (e) setError(e.message)
    await load()
    if (!e && key.startsWith('post')) onPosted?.()
  }

  if (course === undefined) return null
  if (course === false) {
    return <p className="rounded-[20px] bg-panel-2 px-5 py-4 text-sm font-bold text-mist">Run migration_88_course_plans.sql to use course plans.</p>
  }

  if (!course || editing) {
    return (
      <CourseSetup
        groupId={groupId}
        plans={plans}
        current={course}
        suggestPlanId={editing?.suggest}
        onCancel={course ? () => setEditing(false) : null}
        onSaved={async () => {
          setEditing(false)
          await load()
        }}
      />
    )
  }

  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-panel">
      <div className="flex flex-wrap items-center gap-4 bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] px-5 py-4 text-white sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Course</p>
          <p className="font-brand text-[22px] font-semibold leading-tight">{plan?.title || 'Course'} · Lesson {Math.min(done + 1, total || 1)} of {total}</p>
          <div className="mt-2 h-2 max-w-md overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-saffron" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1.5 text-[13px] font-bold text-white/85">
            {course.days.map((d) => WEEKDAYS[d - 1]?.short).join(', ')} · {course.start_time.slice(0, 5)}–{course.end_time.slice(0, 5)}
            {next ? ` · next: ${lessonTime(next.starts_at)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => act('auto', () => supabase.from('group_courses').update({ auto_post: !course.auto_post }).eq('group_id', groupId))}
            className={`focus-ring h-10 rounded-[14px] px-3.5 text-[13px] font-extrabold ${course.auto_post ? 'bg-white text-brass' : 'bg-white/15 text-white'}`}
          >
            {course.auto_post ? 'Auto homework: on' : 'Auto homework: off'}
          </button>
          <button type="button" onClick={() => setEditing(true)} className="focus-ring h-10 rounded-[14px] bg-white/15 px-3.5 text-[13px] font-extrabold text-white hover:bg-white/25">Days & times</button>
        </div>
      </div>

      {today.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-[color-mix(in_srgb,var(--color-saffron)_12%,var(--color-panel))] px-5 py-3 sm:px-6">
          <span className="font-brand text-[15px] font-semibold text-amber">Today</span>
          {today.map((l) => {
            const t = titles[l.number] || {}
            return (
              <span key={l.id} className="flex flex-wrap items-center gap-2 text-sm font-bold text-paper">
                Lesson {l.number}: {t.title || 'not written yet'} · {hhmm(l.starts_at)}
                {t.slides_url && <a href={slidesHref(t.slides_url, t.slides_name)} target="_blank" rel="noreferrer" className="rounded-lg bg-speaking-tint px-2 py-0.5 text-[12px] font-extrabold text-speaking">Slides</a>}
                {(t.materials || []).map((m, i) => (
                  <a key={i} href={slidesHref(m.url, m.name)} target="_blank" rel="noreferrer" className="rounded-lg bg-panel px-2 py-0.5 text-[12px] font-extrabold text-brass">{m.name}</a>
                ))}
              </span>
            )
          })}
        </div>
      )}

      {error && <p className="mx-5 mt-3 rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}

      <ol className="flex flex-col gap-1.5 p-4 sm:p-5">
        {shown.map((l) => {
          const t = titles[l.number] || {}
          const isNext = next?.id === l.id
          const past = new Date(l.ends_at).getTime() < now
          const started = new Date(l.starts_at).getTime() <= now
          const att = attendance[l.id]
          return (
            <li key={l.id} className={`flex flex-wrap items-center gap-3 rounded-[14px] px-3 py-2 ${isNext ? 'bg-[color-mix(in_srgb,var(--color-brass)_9%,var(--color-panel))] ring-1 ring-brass/40' : 'bg-panel-2/50'}`}>
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl font-brand text-[14px] font-semibold ${l.status === 'posted' ? 'bg-reading text-white' : isNext ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim'}`}>{l.number}</span>
              <span className="w-36 shrink-0 whitespace-nowrap text-[13px] font-bold text-mist">{lessonDay(l.starts_at)} · {hhmm(l.starts_at)}</span>
              <span className={`min-w-0 flex-1 truncate text-sm font-extrabold ${t.title ? 'text-paper' : 'text-mist'}`}>{t.title || 'Not written yet'}</span>
              {started && (
                <button
                  type="button"
                  onClick={() => setMarking(l)}
                  title="Mark who came"
                  className={`focus-ring h-8 rounded-[10px] px-2.5 text-[12px] font-extrabold ${att ? 'bg-sage/15 text-sage' : 'border border-dashed border-brass/60 text-brass hover:bg-panel'}`}
                >
                  {att ? `${att.came}/${att.total} came` : 'Attendance'}
                </button>
              )}
              {l.status === 'posted' ? (
                <span className="rounded-lg bg-reading-tint px-2 py-1 text-[12px] font-extrabold text-reading">{l.homework_id ? 'Homework posted' : 'Done'}</span>
              ) : (
                <span className="flex gap-1.5">
                  {!past && (
                    <button type="button" disabled={busy} onClick={() => act(`move${l.id}`, () => supabase.rpc('postpone_group_lesson', { p_group_lesson_id: l.id }))} title="Holiday or no class: this and later lessons move to the next lesson day" className="focus-ring h-8 rounded-[10px] border border-line bg-panel px-2.5 text-[12px] font-extrabold text-paper hover:bg-panel-2 disabled:opacity-50">
                      {busy === `move${l.id}` ? '…' : 'No class'}
                    </button>
                  )}
                  {(isNext || past) && <button type="button" disabled={busy} onClick={() => act(`post${l.id}`, () => supabase.rpc('post_group_lesson', { p_group_lesson_id: l.id, p_force: false }))} className="focus-ring h-8 rounded-[10px] bg-brass px-2.5 text-[12px] font-extrabold text-onbrass disabled:opacity-50">
                    {busy === `post${l.id}` ? 'Posting…' : 'Post homework now'}
                  </button>}
                </span>
              )}
            </li>
          )
        })}
        {lessons.length === 0 && <li className="text-sm font-semibold text-mist">This course has no lessons yet — write them in Classroom → Course plans.</li>}
      </ol>
      {lessons.length > 8 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="focus-ring mx-5 mb-4 text-[13px] font-extrabold text-brass">
          {showAll ? 'Show fewer' : `Show all ${lessons.length} lessons`}
        </button>
      )}
      {!next && lessons.length > 0 && plan?.next_plan_id && (
        <div className="mx-5 mb-4 flex flex-wrap items-center gap-3 rounded-[14px] bg-reading-tint px-4 py-3">
          <span className="text-sm font-extrabold text-reading">Course finished. Next: {plans.find((p) => p.id === plan.next_plan_id)?.title}</span>
          <button type="button" onClick={() => setEditing({ suggest: plan.next_plan_id })} className="focus-ring h-9 rounded-[12px] bg-reading px-3 text-[13px] font-extrabold text-white">Start it</button>
        </div>
      )}
      {marking && (
        <AttendanceModal
          lesson={marking}
          groupId={groupId}
          lessonTitle={titles[marking.number]?.title}
          onClose={() => setMarking(null)}
          onSaved={load}
        />
      )}
    </section>
  )
}

function CourseSetup({ groupId, plans, current, suggestPlanId, onCancel, onSaved }) {
  const [planId, setPlanId] = useState(suggestPlanId || current?.plan_id || plans[0]?.id || '')
  const [start, setStart] = useState(current?.start_date || tashkentDate())
  const [days, setDays] = useState(current?.days || [1, 3, 5])
  const [from, setFrom] = useState(current?.start_time?.slice(0, 5) || '15:00')
  const [to, setTo] = useState(current?.end_time?.slice(0, 5) || '16:30')
  const [first, setFirst] = useState(current?.first_lesson || 1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    if (!planId) return setError('Make a course in Classroom → Course plans first.')
    if (!days.length) return setError('Pick at least one lesson day.')
    if (to <= from) return setError('The lesson must end after it starts.')
    setBusy(true)
    setError('')
    const changingPlan = current && current.plan_id !== planId
    const row = { group_id: groupId, plan_id: planId, start_date: changingPlan ? tashkentDate() : start, days: [...days].sort(), start_time: from, end_time: to, first_lesson: Number(first) || 1, updated_at: new Date().toISOString() }
    if (changingPlan) row.holidays = []
    const { error: e } = await supabase.from('group_courses').upsert(row, { onConflict: 'group_id' })
    if (e) {
      setBusy(false)
      return setError(e.message)
    }
    const { error: e2 } = await supabase.rpc('schedule_group_course', { p_group_id: groupId })
    setBusy(false)
    if (e2) return setError(e2.message)
    onSaved()
  }

  const field = 'focus-ring rounded-[12px] border border-line bg-panel px-3 py-2 text-sm font-bold text-paper'

  return (
    <section className="flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-5 sm:p-6">
      <div>
        <h2 className="font-brand text-[18px] font-semibold text-paper">{current ? 'Course, days and times' : 'Follow a course'}</h2>
        <p className="text-[13px] font-semibold text-mist">Homework of each lesson is posted when the lesson ends and is due at the start of the next one.</p>
      </div>
      {plans.length === 0 ? (
        <p className="rounded-[14px] bg-panel-2 px-4 py-3 text-sm font-bold text-mist">No courses yet — make one in Classroom → Course plans.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">
            Course
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={field}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">
              First lesson date
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">
              Start from lesson
              <input type="number" min="1" value={first} onChange={(e) => setFirst(e.target.value)} className={field} />
            </label>
          </div>
          <div className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">
            Lesson days
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => {
                const on = days.includes(d.n)
                return (
                  <button key={d.n} type="button" onClick={() => setDays((prev) => (on ? prev.filter((x) => x !== d.n) : [...prev, d.n]))} aria-pressed={on}
                    className={`focus-ring h-10 w-12 rounded-[12px] text-[13px] font-extrabold ${on ? 'bg-brass text-onbrass' : 'bg-panel-2 text-paper-dim'}`}>
                    {d.short}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">Starts<input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className={field} /></label>
            <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">Ends (homework posts then)<input type="time" value={to} onChange={(e) => setTo(e.target.value)} className={field} /></label>
          </div>
        </div>
      )}
      {error && <p className="text-sm font-bold text-coral">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || !plans.length} className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] disabled:opacity-50">{busy ? 'Saving…' : current ? 'Save and re-date lessons' : 'Start the course'}</button>
        {onCancel && <button type="button" onClick={onCancel} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>}
      </div>
    </section>
  )
}
