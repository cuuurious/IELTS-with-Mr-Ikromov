import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { lessonTime } from '../../lib/courses'

/*
 * Attendance for one numbered lesson (2026-11-02, migration_89).
 * Everyone starts as "Came"; tap a student to cycle Came → Late → Absent →
 * Excused. Saving notifies absent students once ("study the slides"), and
 * the teacher can text the absent students' parents straight from here.
 */
const STATUSES = [
  { key: 'present', label: 'Came', cls: 'bg-sage/15 text-sage' },
  { key: 'late', label: 'Late', cls: 'bg-saffron/20 text-brass' },
  { key: 'absent', label: 'Absent', cls: 'bg-urgent-tint text-coral' },
  { key: 'excused', label: 'Excused', cls: 'bg-panel-2 text-paper-dim' },
]
const NEXT = { present: 'late', late: 'absent', absent: 'excused', excused: 'present' }
const DEFAULT_SMS = 'Assalomu alaykum! {student} bugun darsga kelmadi. Iltimos, sababini bizga xabar bering. Mr Ikromov'

export default function AttendanceModal({ lesson, groupId, lessonTitle, onClose, onSaved }) {
  const [students, setStudents] = useState(null)
  const [marks, setMarks] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [sms, setSms] = useState(null) // null | { text, sending, result }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase
        .from('group_members')
        .select('student_id, profiles!inner(id, full_name, username, status)')
        .eq('group_id', groupId)
        .eq('profiles.status', 'approved'),
      supabase.from('lesson_attendance').select('student_id, status').eq('group_lesson_id', lesson.id),
    ]).then(([m, a]) => {
      if (cancelled) return
      const list = (m.data || [])
        .map((r) => ({ id: r.student_id, name: (r.profiles?.full_name || r.profiles?.username || 'Student').trim() }))
        .sort((x, y) => x.name.localeCompare(y.name))
      const had = Object.fromEntries((a.data || []).map((r) => [r.student_id, r.status]))
      setStudents(list)
      setMarks(Object.fromEntries(list.map((s) => [s.id, had[s.id] || 'present'])))
      if (a.error && /lesson_attendance/.test(a.error.message)) setError('Run migration_89_attendance_books_weakspots.sql to use attendance.')
    })
    return () => {
      cancelled = true
    }
  }, [groupId, lesson.id])

  const counts = Object.values(marks).reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {})
  const absentIds = Object.entries(marks).filter(([, s]) => s === 'absent').map(([id]) => id)

  const save = async () => {
    setSaving(true)
    setError('')
    const { error: err } = await supabase.rpc('mark_attendance', {
      p_group_lesson_id: lesson.id,
      p_rows: Object.entries(marks).map(([student_id, status]) => ({ student_id, status })),
    })
    setSaving(false)
    if (err) return setError(err.message)
    setSaved(true)
    onSaved?.()
  }

  const sendSms = async () => {
    setSms((s) => ({ ...s, sending: true, result: '' }))
    const { data, error: err } = await supabase.functions.invoke('parent-sms', {
      body: { mode: 'send', kind: 'custom', text: sms.text, studentIds: absentIds },
    })
    const result = err || data?.error ? data?.error || err.message : `SMS sent to ${data.sent} parent${data.sent === 1 ? '' : 's'}${data.failed ? `, ${data.failed} failed` : ''}${data.noPhone ? ` · ${data.noPhone} without a phone number` : ''}`
    setSms((s) => ({ ...s, sending: false, result }))
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/60 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-panel shadow-xl sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Attendance">
        <div className="registan-band px-5 py-4 text-white">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Attendance · Lesson {lesson.number}</p>
          <p className="truncate font-brand text-[19px] font-semibold text-white">{lessonTitle || `Lesson ${lesson.number}`}</p>
          <p className="text-[13px] font-semibold text-white/80">{lessonTime(lesson.starts_at)}</p>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3">
          {STATUSES.map((s) => (
            <span key={s.key} className={`rounded-xl px-2.5 py-1 text-[12px] font-extrabold ${s.cls}`}>
              {s.label} {counts[s.key] || 0}
            </span>
          ))}
          <span className="ml-auto self-center text-[12px] font-bold text-mist">Tap a name to change</span>
        </div>

        <ul className="flex-1 divide-y divide-line overflow-y-auto px-2">
          {students === null && <li className="p-4 text-sm font-semibold text-mist">Loading…</li>}
          {students?.length === 0 && <li className="p-4 text-sm font-semibold text-mist">No students in this group.</li>}
          {students?.map((s) => {
            const st = STATUSES.find((x) => x.key === marks[s.id]) || STATUSES[0]
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSaved(false)
                    setMarks((m) => ({ ...m, [s.id]: NEXT[m[s.id]] || 'present' }))
                  }}
                  className="focus-ring flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-left hover:bg-panel-2/60"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-panel-2 text-[13px] font-extrabold text-paper-dim">{s.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{s.name}</span>
                  <span className={`shrink-0 rounded-xl px-2.5 py-1 text-[12px] font-extrabold ${st.cls}`}>{st.label}</span>
                </button>
              </li>
            )
          })}
        </ul>

        {saved && absentIds.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-line bg-panel-2/40 px-5 py-3">
            {sms === null ? (
              <button type="button" onClick={() => setSms({ text: DEFAULT_SMS, sending: false, result: '' })} className="focus-ring self-start text-[13px] font-extrabold text-brass">
                Text the parents of the {absentIds.length} absent student{absentIds.length === 1 ? '' : 's'}…
              </button>
            ) : (
              <>
                <textarea value={sms.text} onChange={(e) => setSms({ ...sms, text: e.target.value })} rows={3} className="focus-ring rounded-[12px] border border-line bg-panel px-3 py-2 text-sm text-paper" />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={sendSms} disabled={sms.sending || !sms.text.trim()} className="focus-ring h-9 rounded-[12px] bg-brass px-3 text-[13px] font-extrabold text-onbrass disabled:opacity-50">
                    {sms.sending ? 'Sending…' : 'Send SMS'}
                  </button>
                  <span className="text-[12px] font-bold text-mist">{sms.result || '{student} becomes the name'}</span>
                </div>
              </>
            )}
          </div>
        )}

        {error && <p className="mx-5 mt-3 rounded-[14px] bg-urgent-tint px-4 py-2 text-sm font-bold text-coral">{error}</p>}
        <div className="flex gap-2 border-t border-line px-5 py-4">
          <button type="button" onClick={save} disabled={saving || !students?.length} className="focus-ring h-11 flex-1 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] disabled:opacity-50">
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save attendance'}
          </button>
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-[14px] px-4 text-sm font-bold text-mist hover:text-paper">
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
