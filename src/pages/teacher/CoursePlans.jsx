import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import MaterialPicker from '../../components/MaterialPicker'
import HomeworkTasksEditor from '../../components/homework/HomeworkTasksEditor'
import EmptyState from '../../components/EmptyState'
import { SkillIcon } from '../../components/SkillArt'
import { uploadMaterial } from '../../lib/materials'
import { TASK_KINDS } from '../../lib/homeworkTasks'
import { slidesHref } from '../../lib/courses'

/*
 * COURSE PLANS (2026-11-02, migration_88).
 * A course (e.g. "Foundation", 3 months) is a list of numbered lessons.
 * Each lesson: title, goal, slides students can study if they miss the
 * lesson, the teacher's class files, and the homework that is posted
 * automatically when the lesson ends. Groups follow a plan from their
 * group page.
 */
const input = 'focus-ring w-full rounded-[14px] border border-line bg-panel px-3.5 py-2.5 text-sm font-semibold text-paper placeholder:text-mist'

export default function CoursePlans() {
  const [plans, setPlans] = useState(null)
  const [counts, setCounts] = useState({})
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const [p, l, g] = await Promise.all([
      supabase.from('course_plans').select('*').order('sort_order').order('created_at'),
      supabase.from('plan_lessons').select('plan_id, title'),
      supabase.from('group_courses').select('plan_id, group_id'),
    ])
    if (p.error) {
      setError(/course_plans/.test(p.error.message) ? 'Run migration_88_course_plans.sql in Supabase first.' : p.error.message)
      setPlans([])
      return
    }
    setPlans(p.data || [])
    const c = {}
    ;(l.data || []).forEach((r) => {
      const x = (c[r.plan_id] ||= { lessons: 0, written: 0, groups: 0 })
      x.lessons += 1
      if (r.title?.trim()) x.written += 1
    })
    ;(g.data || []).forEach((r) => ((c[r.plan_id] ||= { lessons: 0, written: 0, groups: 0 }).groups += 1))
    setCounts(c)
  }
  useEffect(() => {
    load()
  }, [])

  if (open) return <PlanEditor plan={open} plans={plans || []} onBack={() => { setOpen(null); load() }} />
  if (plans === null) return <p className="text-sm font-semibold text-mist">Loading…</p>

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm font-semibold text-paper-dim">Write each course once, lesson by lesson. Groups follow it, and every lesson’s homework is posted the moment class ends.</p>
        <button type="button" onClick={() => setCreating(true)} className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] hover:brightness-105">
          + New course
        </button>
      </div>
      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
      {creating && <NewPlan onCancel={() => setCreating(false)} onCreated={(p) => { setCreating(false); setOpen(p) }} />}

      {plans.length === 0 && !creating ? (
        <EmptyState icon="check" title="No courses yet" text="Start with Foundation: 36 numbered lessons you fill in one by one." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((p, i) => {
            const c = counts[p.id] || { lessons: 0, written: 0, groups: 0 }
            const pct = c.lessons ? Math.round((c.written / c.lessons) * 100) : 0
            const grad = i % 2 === 0 ? 'linear-gradient(135deg,#2456b0,#1a9bb5)' : 'linear-gradient(135deg,#0f6e63,#22a596)'
            return (
              <button key={p.id} type="button" onClick={() => setOpen(p)} className="focus-ring flex flex-col overflow-hidden rounded-[20px] border border-line bg-panel text-left transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(36,86,176,0.12)]">
                <div className="relative p-5 text-white" style={{ background: grad }}>
                  <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">{p.weeks ? `${p.weeks} weeks` : 'Course'}</p>
                  <p className="mt-1 font-brand text-[22px] font-semibold leading-tight">{p.title}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-saffron" style={{ width: `${pct}%` }} /></div>
                  <p className="mt-1.5 text-[12px] font-bold text-white/85">{c.written} of {c.lessons} lessons written</p>
                </div>
                <div className="grid grid-cols-2 gap-2 p-4">
                  <div className="rounded-[12px] bg-panel-2/70 px-3 py-2"><div className="font-brand text-[20px] font-semibold text-paper">{c.lessons}</div><div className="text-[12px] font-extrabold text-mist">lessons</div></div>
                  <div className="rounded-[12px] bg-panel-2/70 px-3 py-2"><div className="font-brand text-[20px] font-semibold text-paper">{c.groups}</div><div className="text-[12px] font-extrabold text-mist">groups follow it</div></div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function NewPlan({ onCancel, onCreated }) {
  const [title, setTitle] = useState('Foundation')
  const [weeks, setWeeks] = useState(12)
  const [perWeek, setPerWeek] = useState(3)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = Math.max(1, Number(weeks) || 0) * Math.max(1, Number(perWeek) || 0)
  const create = async () => {
    setBusy(true)
    setError('')
    const { data, error: e } = await supabase.from('course_plans').insert({ title: title.trim() || 'Course', weeks: Number(weeks) || null }).select('*').single()
    if (e) {
      setBusy(false)
      return setError(e.message)
    }
    const rows = Array.from({ length: Math.min(total, 300) }, (_, i) => ({ plan_id: data.id, number: i + 1 }))
    const { error: e2 } = await supabase.from('plan_lessons').insert(rows)
    setBusy(false)
    if (e2) return setError(e2.message)
    onCreated(data)
  }
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
      <p className="font-brand text-[18px] font-semibold text-paper">New course</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">Name<input value={title} onChange={(e) => setTitle(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">Weeks<input type="number" min="1" value={weeks} onChange={(e) => setWeeks(e.target.value)} className={input} /></label>
        <label className="flex flex-col gap-1 text-[13px] font-extrabold text-paper-dim">Lessons a week<input type="number" min="1" max="7" value={perWeek} onChange={(e) => setPerWeek(e.target.value)} className={input} /></label>
      </div>
      <p className="text-sm font-semibold text-mist">Makes {total} empty lessons, numbered 1–{total}. You can add or remove lessons later.</p>
      {error && <p className="text-sm font-bold text-coral">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={create} disabled={busy} className="focus-ring h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] disabled:opacity-50">{busy ? 'Creating…' : 'Create course'}</button>
        <button type="button" onClick={onCancel} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>
      </div>
    </div>
  )
}

function PlanEditor({ plan: initial, plans, onBack }) {
  const [plan, setPlan] = useState(initial)
  const [lessons, setLessons] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [saved, setSaved] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const { data } = await supabase.from('plan_lessons').select('*').eq('plan_id', plan.id).order('number')
    setLessons(data || [])
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id])

  const savePlan = async (patch) => {
    setPlan((p) => ({ ...p, ...patch }))
    const { error: e } = await supabase.from('course_plans').update(patch).eq('id', plan.id)
    setSaved(e ? '' : 'Saved')
    if (e) setError(e.message)
  }

  const addLesson = async () => {
    const n = (lessons?.length ? lessons[lessons.length - 1].number : 0) + 1
    const { data, error: e } = await supabase.from('plan_lessons').insert({ plan_id: plan.id, number: n }).select('*').single()
    if (e) return setError(e.message)
    setLessons((prev) => [...prev, data])
    setOpenId(data.id)
  }

  const removeLesson = async (l) => {
    const { error: e } = await supabase.from('plan_lessons').delete().eq('id', l.id)
    if (e) return setError(e.message)
    // Close the gap: every later lesson moves up one number.
    for (const x of lessons.filter((y) => y.number > l.number).sort((a, b) => a.number - b.number)) {
      await supabase.from('plan_lessons').update({ number: x.number - 1 }).eq('id', x.id)
    }
    setOpenId(null)
    load()
  }

  const deletePlan = async () => {
    const { count } = await supabase.from('group_courses').select('group_id', { count: 'exact', head: true }).eq('plan_id', plan.id)
    if (count > 0) return setError(`${count} group${count === 1 ? ' follows' : 's follow'} this course. Move them to another course first.`)
    const { error: e } = await supabase.from('course_plans').delete().eq('id', plan.id)
    if (e) setError(e.message)
    else onBack()
  }

  const written = (lessons || []).filter((l) => l.title?.trim()).length

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="focus-ring w-fit text-sm font-bold text-mist hover:text-paper">← All courses</button>

      <div className="flex flex-col gap-3 rounded-[24px] bg-[linear-gradient(135deg,#2456b0,#1a9bb5)] p-5 text-white sm:p-6">
        <input
          defaultValue={plan.title}
          onBlur={(e) => e.target.value.trim() && e.target.value !== plan.title && savePlan({ title: e.target.value.trim() })}
          className="w-full rounded-[12px] border-0 !bg-transparent px-0 font-brand text-[26px] font-semibold !text-white outline-none placeholder:text-white/60 focus:!bg-white/10"
          aria-label="Course name"
        />
        <textarea
          defaultValue={plan.description}
          onBlur={(e) => e.target.value !== plan.description && savePlan({ description: e.target.value })}
          rows={2}
          placeholder="What this course is for (one or two lines)"
          className="w-full resize-none rounded-[14px] border-0 px-3 py-2 text-sm font-semibold !text-white outline-none placeholder:text-white/60"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        />
        <div className="flex flex-wrap items-center gap-3 text-[13px] font-bold">
          <span className="rounded-xl bg-white/15 px-3 py-1.5">{written} of {lessons?.length || 0} lessons written</span>
          <label className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-1.5">
            After this course
            <select value={plan.next_plan_id || ''} onChange={(e) => savePlan({ next_plan_id: e.target.value || null })} className="rounded-lg bg-white px-2 py-1 text-[13px] font-bold text-[#17213a]">
              <option value="">—</option>
              {plans.filter((p) => p.id !== plan.id).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          {saved && <span className="text-white/80">{saved}</span>}
        </div>
      </div>

      {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}

      {lessons === null ? (
        <p className="text-sm font-semibold text-mist">Loading lessons…</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {lessons.map((l) => (
            <li key={l.id}>
              {openId === l.id ? (
                <LessonEditor
                  lesson={l}
                  planTitle={plan.title}
                  onClose={() => setOpenId(null)}
                  onSaved={(row) => setLessons((prev) => prev.map((x) => (x.id === row.id ? row : x)))}
                  onRemove={() => removeLesson(l)}
                />
              ) : (
                <LessonRow lesson={l} onOpen={() => setOpenId(l.id)} />
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" onClick={addLesson} className="focus-ring h-11 rounded-[14px] border-2 border-dashed border-line px-5 text-sm font-extrabold text-brass hover:bg-panel">+ Add a lesson</button>
        <button type="button" onClick={deletePlan} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-extrabold text-coral hover:bg-urgent-tint">Delete course</button>
      </div>
    </div>
  )
}

function LessonRow({ lesson: l, onOpen }) {
  const tasks = Array.isArray(l.tasks) ? l.tasks : []
  const empty = !l.title?.trim()
  return (
    <button type="button" onClick={onOpen} className={`focus-ring flex w-full items-center gap-3 rounded-[16px] border px-3 py-2.5 text-left transition hover:bg-panel-2 ${empty ? 'border-dashed border-line bg-panel/60' : 'border-line bg-panel'}`}>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl font-brand text-[15px] font-semibold ${empty ? 'bg-panel-2 text-mist' : 'bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-brass'}`}>{l.number}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[15px] font-extrabold ${empty ? 'text-mist' : 'text-paper'}`}>{empty ? 'Not written yet' : l.title}</span>
        {!empty && l.goal && <span className="block truncate text-[13px] font-semibold text-mist">{l.goal}</span>}
      </span>
      <span className="hidden shrink-0 flex-wrap gap-1.5 text-[11px] font-extrabold sm:flex">
        {l.slides_url && <span className="rounded-lg bg-speaking-tint px-2 py-0.5 text-speaking">Slides</span>}
        {(l.materials || []).length > 0 && <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">{l.materials.length} class file{l.materials.length === 1 ? '' : 's'}</span>}
        {tasks.map((t, i) => {
          const m = TASK_KINDS[t.kind] || TASK_KINDS.reading
          return <span key={i} className={`rounded-lg px-2 py-0.5 ${m.tint} ${m.text}`}>{m.short}</span>
        })}
        {(l.homework_title || l.homework_text) && !tasks.length && <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">Homework</span>}
      </span>
    </button>
  )
}

function LessonEditor({ lesson, planTitle, onClose, onSaved, onRemove }) {
  const { profile } = useAuth()
  const [f, setF] = useState({
    title: lesson.title || '',
    goal: lesson.goal || '',
    slides_url: lesson.slides_url || '',
    slides_name: lesson.slides_name || '',
    materials: Array.isArray(lesson.materials) ? lesson.materials : [],
    homework_title: lesson.homework_title || '',
    homework_text: lesson.homework_text || '',
    tasks: Array.isArray(lesson.tasks) ? lesson.tasks : [],
    min_files: lesson.min_files ?? 0,
    enable_speaking: lesson.enable_speaking || false,
    ai_eval: lesson.ai_eval || false,
  })
  const [picker, setPicker] = useState(null) // 'slides' | 'materials'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => setF((p) => ({ ...p, ...patch }))

  const uploadSlides = async (file) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const m = await uploadMaterial(file, { userId: profile?.id })
      set({ slides_url: m.url, slides_name: m.file_name || m.title })
    } catch (err) {
      setError(err?.message || 'Could not upload the slides.')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    setBusy(true)
    setError('')
    const patch = {
      ...f,
      title: f.title.trim(),
      goal: f.goal.trim(),
      slides_url: f.slides_url || null,
      slides_name: f.slides_name || null,
      min_files: Math.max(0, Number(f.min_files) || 0),
      tasks: f.tasks.map(({ id, ...t }) => t),
    }
    const { data, error: e } = await supabase.from('plan_lessons').update(patch).eq('id', lesson.id).select('*').single()
    setBusy(false)
    if (e) return setError(e.message)
    onSaved(data)
    onClose()
  }

  const preview = useMemo(() => `${planTitle} · Lesson ${lesson.number}: ${f.homework_title || f.title || 'Homework'}`, [planTitle, lesson.number, f.homework_title, f.title])

  return (
    <div className="flex flex-col gap-4 rounded-[20px] border-2 border-brass bg-panel p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brass font-brand text-[16px] font-semibold text-onbrass">{lesson.number}</span>
        <input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={`Lesson ${lesson.number} title (e.g. Reading: True / False / Not Given)`} className={`${input} font-brand text-[16px]`} />
      </div>
      <textarea value={f.goal} onChange={(e) => set({ goal: e.target.value })} rows={2} placeholder="Goal: what students can do after this lesson" className={input} />

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Slides */}
        <div className="flex flex-col gap-2 rounded-[16px] bg-speaking-tint/60 p-4">
          <p className="text-[13px] font-extrabold text-speaking">Slides for self-study</p>
          <p className="text-[12px] font-semibold text-paper-dim">Students get them with the homework, so a student who missed class can catch up.</p>
          {f.slides_url ? (
            <div className="flex items-center gap-2 rounded-[12px] bg-panel px-3 py-2">
              <a href={slidesHref(f.slides_url, f.slides_name)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper hover:text-brass">{f.slides_name || 'Slides'}</a>
              <button type="button" onClick={() => set({ slides_url: '', slides_name: '' })} className="focus-ring rounded-lg px-2 text-xs font-bold text-coral">Remove</button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <label className="focus-ring inline-flex h-10 cursor-pointer items-center rounded-[14px] bg-speaking px-3.5 text-[13px] font-extrabold text-white">
                Upload PowerPoint / PDF
                <input type="file" accept=".ppt,.pptx,.pdf" className="hidden" onChange={(e) => uploadSlides(e.target.files?.[0])} />
              </label>
              <button type="button" onClick={() => setPicker('slides')} className="focus-ring h-10 rounded-[14px] border border-line bg-panel px-3.5 text-[13px] font-extrabold text-paper">From the Library</button>
            </div>
          )}
        </div>
        {/* Class files */}
        <div className="flex flex-col gap-2 rounded-[16px] bg-panel-2/70 p-4">
          <p className="text-[13px] font-extrabold text-paper">Class files (only you see these)</p>
          <ul className="flex flex-col gap-1">
            {f.materials.map((m, i) => (
              <li key={i} className="flex items-center gap-2 rounded-[12px] bg-panel px-3 py-1.5">
                <a href={slidesHref(m.url, m.name)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-bold text-paper hover:text-brass">{m.name}</a>
                <button type="button" onClick={() => set({ materials: f.materials.filter((_, j) => j !== i) })} className="focus-ring rounded-lg px-2 text-xs font-bold text-coral">×</button>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setPicker('materials')} className="focus-ring h-10 self-start rounded-[14px] border border-line bg-panel px-3.5 text-[13px] font-extrabold text-paper">+ Add from the Library</button>
        </div>
      </div>

      {/* Homework */}
      <div className="flex flex-col gap-3 rounded-[16px] border border-line p-4">
        <div>
          <p className="font-brand text-[16px] font-semibold text-paper">Homework</p>
          <p className="text-[12px] font-semibold text-mist">Posted when class ends, due at the start of the next lesson. Students see: “{preview}”</p>
        </div>
        <input value={f.homework_title} onChange={(e) => set({ homework_title: e.target.value })} placeholder="Homework title (leave empty to use the lesson title)" className={input} />
        <textarea value={f.homework_text} onChange={(e) => set({ homework_text: e.target.value })} rows={3} placeholder="Instructions for students" className={input} />
        <HomeworkTasksEditor groupId={null} tasks={f.tasks} onChange={(tasks) => set({ tasks })} />
        <div className="flex flex-wrap items-center gap-3 text-[13px] font-bold text-paper">
          <label className="flex items-center gap-2 rounded-[12px] bg-panel-2 px-3 py-2">
            Pictures / files to upload, at least
            <input type="number" min="0" max="10" value={f.min_files} onChange={(e) => set({ min_files: e.target.value })} className="w-14 rounded-lg border border-line bg-panel px-2 py-1" />
          </label>
          <label className="flex items-center gap-2 rounded-[12px] bg-panel-2 px-3 py-2">
            <input type="checkbox" checked={f.enable_speaking} onChange={(e) => set({ enable_speaking: e.target.checked })} /> Speaking recording
          </label>
          <label className="flex items-center gap-2 rounded-[12px] bg-panel-2 px-3 py-2">
            <input type="checkbox" checked={f.ai_eval} onChange={(e) => set({ ai_eval: e.target.checked })} /> AI feedback
          </label>
        </div>
      </div>

      {error && <p className="text-sm font-bold text-coral">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" onClick={onRemove} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-extrabold text-coral hover:bg-urgent-tint">Delete lesson</button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] disabled:opacity-50">{busy ? 'Saving…' : 'Save lesson'}</button>
        </div>
      </div>

      <MaterialPicker
        open={Boolean(picker)}
        onClose={() => setPicker(null)}
        onPick={(rows) => {
          const mats = (rows || []).map((m) => ({ name: m.title || m.file_name || m.name, url: m.url }))
          if (picker === 'slides' && mats[0]) set({ slides_url: mats[0].url, slides_name: rows[0].file_name || mats[0].name })
          if (picker === 'materials') set({ materials: [...f.materials, ...mats] })
          setPicker(null)
        }}
      />
    </div>
  )
}

export function SkillDot({ kind }) {
  const m = TASK_KINDS[kind] || TASK_KINDS.reading
  return <SkillIcon skill={m.skill} className={`h-4 w-4 ${m.text}`} />
}
