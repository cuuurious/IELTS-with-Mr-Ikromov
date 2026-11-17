import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { lessonDay } from '../../lib/courses'
import { STATE_PILL } from '../../lib/skills'
import { LessonPageLoader } from '../lessons/LessonPage'

/*
 * "By lesson" on the student's Homework page (2026-11-17, migration_131).
 *
 * Every lesson of the group's course with its date. Lessons the teacher
 * has opened show their homework (open it, finish it later, do the tasks
 * again); lessons not opened yet are locked and show only their name.
 * Homework that does not belong to a lesson sits under "Other homework".
 *
 * It loads itself; when the group has no course (or migration_131 is not
 * run yet) it reports 0 lessons and shows nothing, so the plain list is
 * used instead.
 */
const STATE_TEXT = {
  todo: 'To do',
  today: 'Due today',
  overdue: 'Not finished — do it now',
  sent: 'Done',
  late: 'Done (late)',
  marked: 'Marked',
}

export default function StudentLessonTimeline({ groupId, homeworks, stateById, renderHomework, visible, onLoaded }) {
  const [rows, setRows] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  const [reading, setReading] = useState(null)
  const [showAllLocked, setShowAllLocked] = useState(false)

  useEffect(() => {
    if (!groupId) return undefined
    let cancelled = false
    setRows(null)
    onLoaded?.(0)
    supabase.rpc('my_lesson_timeline', { p_group_id: groupId }).then(({ data, error }) => {
      if (cancelled) return
      const list = error ? [] : data || []
      setRows(list)
      onLoaded?.(list.length)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId])

  const hwById = useMemo(() => Object.fromEntries((homeworks || []).map((h) => [h.id, h])), [homeworks])

  const { opened, locked, other, doneCount } = useMemo(() => {
    const list = rows || []
    const used = new Set()
    const o = []
    const l = []
    for (const r of list) {
      const hw = r.homework_id ? hwById[r.homework_id] : null
      if (hw) {
        used.add(hw.id)
        o.push({ ...r, hw })
      } else if (r.status === 'skipped') {
        o.push({ ...r, hw: null, skipped: true })
      } else if (new Date(r.starts_at).getTime() <= Date.now() && r.status === 'posted') {
        // posted, but the homework is not in the list (deleted): show as a plain lesson
        o.push({ ...r, hw: null })
      } else {
        l.push(r)
      }
    }
    o.sort((a, b) => b.number - a.number)
    const rest = (homeworks || []).filter((h) => !used.has(h.id))
    const done = o.filter((r) => r.hw && ['sent', 'late', 'marked'].includes(stateById[r.hw.id]?.key)).length
    return { opened: o, locked: l, other: rest, doneCount: done }
  }, [rows, hwById, homeworks, stateById])

  if (!visible || !rows || rows.length === 0) return null

  const total = rows[0].total || rows.length
  const shownLocked = showAllLocked ? locked : locked.slice(0, 3)

  const pill = (hw) => {
    const k = stateById[hw.id]?.key || 'todo'
    return (
      <span className={`shrink-0 rounded-xl px-2.5 py-1 text-[12px] font-extrabold ${STATE_PILL[k] || STATE_PILL.todo}`}>
        {STATE_TEXT[k] || 'To do'}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] font-bold text-mist">
        {doneCount} of {opened.filter((r) => r.hw).length} open lessons done · {locked.length} locked, your teacher opens them
      </p>

      <ul className="flex flex-col gap-3">
        {opened.map((r) => {
          const key = `l${r.number}`
          const isOpen = openKey === key
          return (
            <li key={key} className="overflow-hidden rounded-[20px] border border-line bg-panel">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] font-brand text-[15px] font-semibold text-brass">{r.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-extrabold text-paper">{r.title || `Lesson ${r.number}`}</span>
                  <span className="block text-[12px] font-bold text-mist">{lessonDay(r.starts_at)}{r.skipped ? ' · no class' : ''}</span>
                </span>
                {r.has_page && (
                  <button type="button" onClick={() => setReading(r)} className="focus-ring shrink-0 rounded-[12px] bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] px-3 py-1.5 text-[13px] font-extrabold text-brass">
                    Lesson
                  </button>
                )}
                {r.hw && (
                  <>
                    {pill(r.hw)}
                    <button type="button" onClick={() => setOpenKey(isOpen ? null : key)} aria-expanded={isOpen} className="focus-ring shrink-0 rounded-[12px] bg-saffron px-3 py-1.5 text-[13px] font-extrabold text-[#17213a]">
                      {isOpen ? 'Close' : ['sent', 'late', 'marked'].includes(stateById[r.hw.id]?.key) ? 'Open again' : 'Homework'}
                    </button>
                  </>
                )}
              </div>
              {isOpen && r.hw && <div className="border-t border-line">{renderHomework(r.hw)}</div>}
            </li>
          )
        })}
      </ul>

      {locked.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-extrabold text-paper-dim">Coming up · opens when your teacher unlocks it</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {shownLocked.map((r) => (
              <li key={r.number} className="flex items-center gap-3 rounded-[14px] border border-dashed border-line bg-panel-2/50 px-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-panel-2 font-brand text-[14px] font-semibold text-mist">🔒</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold text-paper-dim">Lesson {r.number}{r.title ? ` · ${r.title}` : ''}</span>
                  <span className="block text-[12px] font-bold text-mist">{lessonDay(r.starts_at)}</span>
                </span>
              </li>
            ))}
          </ul>
          {locked.length > 3 && (
            <button type="button" onClick={() => setShowAllLocked((v) => !v)} className="focus-ring self-start text-[13px] font-extrabold text-brass">
              {showAllLocked ? 'Show fewer' : `All ${locked.length} coming lessons`}
            </button>
          )}
        </div>
      )}

      {other.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-extrabold text-paper-dim">Other homework (not part of a lesson)</p>
          <ul className="flex flex-col gap-3">
            {other.map((h) => {
              const key = `h${h.id}`
              const isOpen = openKey === key
              return (
                <li key={h.id} className="overflow-hidden rounded-[20px] border border-line bg-panel">
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-paper">{h.title}</span>
                    {pill(h)}
                    <button type="button" onClick={() => setOpenKey(isOpen ? null : key)} aria-expanded={isOpen} className="focus-ring shrink-0 rounded-[12px] bg-saffron px-3 py-1.5 text-[13px] font-extrabold text-[#17213a]">
                      {isOpen ? 'Close' : 'Homework'}
                    </button>
                  </div>
                  {isOpen && <div className="border-t border-line">{renderHomework(h)}</div>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {reading && <LessonPageLoader planId={reading.plan_id} number={reading.number} onClose={() => setReading(null)} />}
      <span className="sr-only">{total} lessons in this course</span>
    </div>
  )
}
