import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { lessonTime } from '../../lib/courses'

/*
 * One lesson, student by student (2026-11-02, migration_91): attendance,
 * the lesson's homework (done / late / not done) and the in-site score.
 */
const ATT = {
  present: ['Came', 'bg-sage/15 text-sage'],
  late: ['Late', 'bg-saffron/20 text-brass'],
  absent: ['Absent', 'bg-urgent-tint text-coral'],
  excused: ['Excused', 'bg-panel-2 text-paper-dim'],
}
const HW = {
  done: ['Done', 'bg-sage/15 text-sage'],
  late: ['Late', 'bg-saffron/20 text-brass'],
  missed: ['Not done', 'bg-urgent-tint text-coral'],
  open: ['Not yet', 'bg-panel-2 text-paper-dim'],
}

export default function LessonStatsModal({ lesson, title, stats, onClose, onMark }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.rpc('lesson_student_stats', { p_group_lesson_id: lesson.id }).then(({ data, error: err }) => {
      if (err) setError(/lesson_student_stats/.test(err.message) ? 'Run migration_91 first.' : err.message)
      setRows(err ? [] : data || [])
    })
  }, [lesson.id])

  const tiles = [
    ['Came', stats?.marked ? `${stats.came}/${stats.marked}` : '—'],
    ['Homework done', lesson.homework_id ? `${stats?.hw_done ?? 0}/${stats?.members ?? 0}` : '—'],
    ['Average score', stats?.avg_pct != null ? `${stats.avg_pct}%` : '—'],
  ]

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/60 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[28px] bg-ink sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Lesson stats">
        <div className="registan-band flex items-center gap-3 px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Lesson {lesson.number} · {lessonTime(lesson.starts_at)}</p>
            <p className="truncate font-brand text-[19px] font-semibold text-white">{title || `Lesson ${lesson.number}`}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 place-items-center rounded-[14px] bg-white/15 hover:bg-white/25">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2">
            {tiles.map(([l, v]) => (
              <div key={l} className="rounded-[16px] bg-panel px-3 py-2.5">
                <p className="text-[12px] font-extrabold text-mist">{l}</p>
                <p className="font-brand text-[22px] font-semibold text-paper">{v}</p>
              </div>
            ))}
          </div>
          {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}
          <ul className="flex flex-col divide-y divide-line rounded-[16px] bg-panel">
            {rows === null && <li className="p-4 text-sm font-semibold text-mist">Loading…</li>}
            {(rows || []).map((r) => {
              const a = ATT[r.attendance]
              const h = HW[r.hw_state]
              return (
                <li key={r.student_id} className="flex items-center gap-2 px-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{r.full_name}</span>
                  <span className={`w-[72px] shrink-0 rounded-lg px-2 py-0.5 text-center text-[11px] font-extrabold ${a ? a[1] : 'text-mist'}`}>{a ? a[0] : 'Not marked'}</span>
                  <span className={`w-[72px] shrink-0 rounded-lg px-2 py-0.5 text-center text-[11px] font-extrabold ${h ? h[1] : 'text-mist'}`}>{h ? h[0] : 'No HW'}</span>
                  <span className="w-11 shrink-0 text-right text-[13px] font-extrabold text-paper-dim">{r.avg_pct != null ? `${r.avg_pct}%` : '—'}</span>
                </li>
              )
            })}
          </ul>
          <button type="button" onClick={onMark} className="focus-ring h-10 self-start rounded-[14px] border border-line bg-panel px-4 text-[13px] font-extrabold text-brass hover:border-brass">
            Mark attendance
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
