import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { lessonTime } from '../../lib/courses'
import HomeworkTasksEditor from '../homework/HomeworkTasksEditor'
import MaterialPicker, { PickedMaterialsList } from '../MaterialPicker'

/*
 * CHANGE A LESSON'S HOMEWORK FOR ONE GROUP (2026-11-11).
 * Before the lesson's homework is posted by itself, the teacher can
 * change it for this group only: the title, what to do, the tasks done in
 * the site, and extra files from the Materials Library (on top of the
 * slides). It is kept in group_lessons.override; the course plan itself
 * is not changed, so other groups still get the plan's homework.
 * migration_125 makes post_group_lesson attach the extra files.
 * After it is posted, the group page opens the normal Edit homework window.
 */
export default function LessonHomeworkModal({ lesson, planId, onClose, onSaved }) {
  const [plan, setPlan] = useState(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [tasks, setTasks] = useState([])
  const [extra, setExtra] = useState([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const ov = lesson.override || {}
  const changed = ['homework_title', 'homework_text', 'tasks', 'extra'].some((k) => k in ov)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('plan_lessons')
      .select('title, homework_title, homework_text, tasks')
      .eq('plan_id', planId)
      .eq('number', lesson.number)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const p = data || {}
        setPlan(p)
        setTitle(ov.homework_title ?? p.homework_title ?? '')
        setText(ov.homework_text ?? p.homework_text ?? '')
        const list = Array.isArray(ov.tasks) ? ov.tasks : Array.isArray(p.tasks) ? p.tasks : []
        setTasks(list.map((t, i) => ({ ...t, id: t.id || `t${i}-${Math.random().toString(36).slice(2, 7)}` })))
        setExtra((Array.isArray(ov.extra) ? ov.extra : []).map((m, i) => ({ ...m, id: m.id || `m${i}` })))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id, planId])

  const save = async (reset = false) => {
    setBusy(true)
    setError('')
    const next = { ...ov }
    if (reset) {
      delete next.homework_title
      delete next.homework_text
      delete next.tasks
      delete next.extra
    } else {
      next.homework_title = title.trim()
      next.homework_text = text
      next.tasks = tasks.map(({ id, ...t }) => t) // eslint-disable-line no-unused-vars
      next.extra = extra.map((m) => ({ url: m.url, name: m.name || m.title || m.file_name, material_id: m.material_id || null, mime_type: m.mime_type || null, size_bytes: m.size_bytes || null }))
    }
    const { error: e } = await supabase.from('group_lessons').update({ override: next }).eq('id', lesson.id)
    setBusy(false)
    if (e) {
      setError(e.message)
      return
    }
    onSaved?.()
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-panel shadow-xl sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Lesson homework">
        <div className="registan-band px-5 py-4 text-white">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Homework · Lesson {lesson.number} · this group only</p>
          <p className="truncate font-brand text-[19px] font-semibold text-white">{plan?.title || `Lesson ${lesson.number}`}</p>
          <p className="text-[13px] font-semibold text-white/80">Posts by itself after the lesson · {lessonTime(lesson.starts_at)}</p>
        </div>

        {plan === null ? (
          <p className="py-12 text-center text-sm font-semibold text-mist">Loading…</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            {changed && (
              <p className="rounded-[14px] bg-vocab-tint px-4 py-2 text-[13px] font-bold text-vocab">
                Changed for this group. Other groups still get the course plan’s homework.
              </p>
            )}
            <label className="block">
              <span className="text-sm font-extrabold text-paper">Homework title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={plan.title || 'Homework'} className="focus-ring mt-1.5 h-11 w-full rounded-[14px] border border-line bg-panel-2 px-3 text-[15px] text-paper" />
            </label>
            <label className="block">
              <span className="text-sm font-extrabold text-paper">What to do</span>
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} className="focus-ring mt-1.5 w-full rounded-[14px] border border-line bg-panel-2 px-3 py-2 text-[14px] text-paper" />
            </label>

            <div>
              <p className="mb-1.5 text-sm font-extrabold text-paper">Tasks done in the site</p>
              <HomeworkTasksEditor groupId={lesson.group_id} tasks={tasks} onChange={setTasks} />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-sm font-extrabold text-paper">Extra files for students</p>
                <button type="button" onClick={() => setPicking(true)} className="focus-ring h-9 rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-brass hover:bg-panel-2">
                  + Add from Materials Library
                </button>
              </div>
              {extra.length ? (
                <PickedMaterialsList items={extra} onRemove={(m) => setExtra((list) => list.filter((x) => x.id !== m.id))} />
              ) : (
                <p className="text-[13px] font-semibold text-mist">None yet. The lesson slides are attached anyway.</p>
              )}
            </div>

            {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          {changed ? (
            <button type="button" disabled={busy} onClick={() => save(true)} className="focus-ring h-11 rounded-[14px] px-3 text-sm font-extrabold text-mist hover:text-paper disabled:opacity-50">
              Use the course plan again
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist">Cancel</button>
            <button type="button" disabled={busy || plan === null} onClick={() => save(false)} className="focus-ring h-11 rounded-[14px] bg-saffron px-6 text-sm font-extrabold text-[#17213a] disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      <MaterialPicker
        open={picking}
        onClose={() => setPicking(false)}
        alreadyPickedIds={extra.map((m) => m.material_id).filter(Boolean)}
        onPick={(rows) => {
          const add = (rows || []).map((m) => ({
            id: `m-${m.id}`,
            material_id: m.id,
            url: m.url,
            name: m.title || m.file_name || m.name,
            title: m.title || m.file_name || m.name,
            mime_type: m.mime_type,
            size_bytes: m.size_bytes,
          }))
          setExtra((list) => [...list, ...add.filter((a) => !list.some((x) => x.url === a.url))])
          setPicking(false)
        }}
      />
    </div>,
    document.body
  )
}
