import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { lessonDay, slidesHref } from '../../lib/courses'
import { STATE_PILL } from '../../lib/skills'
import { LessonPageLoader } from '../lessons/LessonPage'

/*
 * "By lesson" on the student's Homework page (2026-11-17, migrations
 * 131 + 132).
 *
 * Every lesson of the group's course with its date. A lesson the teacher
 * has opened is a small dashboard: its goal, the lesson page, the files
 * used in class (opened right here), and its homework — finish it later,
 * do the tasks again. Lessons not opened yet are locked and show only
 * their name. A weekly "do this again" list comes from the marks, and a
 * student who has handed everything in can ask for the next lesson.
 *
 * It loads itself; when the group has no course (or migration_131 is not
 * run yet) it reports 0 lessons and shows nothing, so the plain list is
 * used instead. Everything from migration_132 degrades quietly.
 */
const STATE_TEXT = {
  todo: 'To do',
  today: 'Due today',
  overdue: 'Not finished — do it now',
  sent: 'Done',
  late: 'Done (late)',
  marked: 'Marked',
}

const DONE_KEYS = ['sent', 'late', 'marked']

// A file used in class, opened inside the site.
function FileViewer({ file, onClose }) {
  const url = file.url
  const href = slidesHref(url, file.name)
  const clean = String(url || '').split('?')[0].toLowerCase()
  let body
  if (/\.(png|jpe?g|gif|webp|avif|svg)$/.test(clean)) body = <img src={url} alt={file.name} className="mx-auto max-h-full max-w-full object-contain" />
  else if (/\.(mp3|m4a|wav|ogg|aac)$/.test(clean)) body = <audio src={url} controls className="mx-auto mt-10 w-full max-w-xl" />
  else if (/\.(mp4|webm|mov)$/.test(clean)) body = <video src={url} controls className="mx-auto max-h-full max-w-full" />
  else body = <iframe src={href} title={file.name} className="h-full w-full rounded-xl bg-white" />
  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-ink/90 p-3 sm:p-6" role="dialog" aria-label={file.name}>
      <div className="mb-3 flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-[15px] font-extrabold text-white">{file.name}</p>
        <a href={url} target="_blank" rel="noreferrer" className="focus-ring rounded-[12px] bg-white/15 px-3 py-1.5 text-[13px] font-extrabold text-white">Open in a new tab</a>
        <button type="button" onClick={onClose} className="focus-ring rounded-[12px] bg-saffron px-4 py-1.5 text-[13px] font-extrabold text-[#17213a]">Close</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </div>,
    document.body
  )
}

export default function StudentLessonTimeline({ groupId, homeworks, stateById, renderHomework, visible, onLoaded }) {
  const [rows, setRows] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  const [reading, setReading] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [showAllLocked, setShowAllLocked] = useState(false)
  const [info, setInfo] = useState({}) // lesson number -> lesson_materials answer (null = none)
  const [recap, setRecap] = useState([])
  const [askMsg, setAskMsg] = useState('')
  const [asking, setAsking] = useState(false)

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
    // Weekly "do this again" list (migration_132) — quiet if not run yet.
    supabase.rpc('my_recap', { p_group_id: groupId }).then(({ data, error }) => {
      if (!cancelled && !error) setRecap(data || [])
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
      } else if (r.status === 'posted') {
        // opened, but it has no homework (or it was deleted): a plain lesson
        o.push({ ...r, hw: null })
      } else {
        l.push(r)
      }
    }
    o.sort((a, b) => b.number - a.number)
    const rest = (homeworks || []).filter((h) => !used.has(h.id))
    const done = o.filter((r) => r.hw && DONE_KEYS.includes(stateById[r.hw.id]?.key)).length
    return { opened: o, locked: l, other: rest, doneCount: done }
  }, [rows, hwById, homeworks, stateById])

  const loadInfo = async (number) => {
    if (number in info) return
    setInfo((p) => ({ ...p, [number]: null }))
    const { data, error } = await supabase.rpc('lesson_materials', { p_group_id: groupId, p_number: number })
    setInfo((p) => ({ ...p, [number]: error ? null : data || null }))
  }

  const toggleLesson = (r) => {
    const key = `l${r.number}`
    if (openKey === key) {
      setOpenKey(null)
      return
    }
    setOpenKey(key)
    loadInfo(r.number)
  }

  const goToLesson = (number) => {
    const key = `l${number}`
    setOpenKey(key)
    loadInfo(number)
    setTimeout(() => document.getElementById(`lesson-row-${number}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const askNext = async () => {
    setAsking(true)
    setAskMsg('')
    const { data, error } = await supabase.rpc('request_next_lesson', { p_group_id: groupId })
    setAsking(false)
    if (error) return setAskMsg('Could not send the request. Try again in a minute.')
    if (data?.ok) return setAskMsg(`Sent. Mr Ikromov will see that you asked for Lesson ${data.number}.`)
    if (data?.reason === 'unfinished') return setAskMsg(`Hand in your open homework first (${data.count} left), then ask again.`)
    setAskMsg('There is no next lesson to open yet.')
  }

  if (!visible || !rows || rows.length === 0) return null

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
      {recap.length > 0 && (
        <section className="rounded-[20px] border border-line bg-[color-mix(in_srgb,var(--color-saffron)_10%,var(--color-panel))] p-4">
          <p className="font-brand text-[16px] font-semibold text-paper">Recommended for you this week</p>
          <p className="text-[12px] font-bold text-mist">From your marks. Doing a task again can earn a few coins.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {recap.map((r, i) => (
              <li key={`${r.kind}-${r.task_id || r.lesson_number}-${i}`} className="flex flex-wrap items-center gap-3 rounded-[14px] bg-panel px-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-extrabold text-paper">
                  {r.kind === 'lesson' ? `Recap Lesson ${r.lesson_number}` : `Solve again: ${r.title}`}
                  <span className="block text-[12px] font-bold text-mist">
                    {r.kind === 'lesson' ? `Average ${r.pct}% in this lesson` : `Lesson ${r.lesson_number} · you got ${r.pct}%`}
                  </span>
                </span>
                <button type="button" onClick={() => goToLesson(r.lesson_number)} className="focus-ring shrink-0 rounded-[12px] bg-saffron px-3 py-1.5 text-[13px] font-extrabold text-[#17213a]">
                  Open
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[13px] font-bold text-mist">
        {doneCount} of {opened.filter((r) => r.hw).length} open lessons done · {locked.length} locked, your teacher opens them
      </p>

      <ul className="flex flex-col gap-3">
        {opened.map((r) => {
          const key = `l${r.number}`
          const isOpen = openKey === key
          const meta = info[r.number]
          const files = Array.isArray(meta?.materials) ? meta.materials : []
          const done = r.hw && DONE_KEYS.includes(stateById[r.hw.id]?.key)
          return (
            <li key={key} id={`lesson-row-${r.number}`} className="overflow-hidden rounded-[20px] border border-line bg-panel">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] font-brand text-[15px] font-semibold text-brass">{r.number}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-extrabold text-paper">{r.title || `Lesson ${r.number}`}</span>
                  <span className="block text-[12px] font-bold text-mist">{lessonDay(r.starts_at)}{r.skipped ? ' · no class' : ''}</span>
                </span>
                {r.hw && pill(r.hw)}
                <button type="button" onClick={() => toggleLesson(r)} aria-expanded={isOpen} className="focus-ring shrink-0 rounded-[12px] bg-saffron px-3 py-1.5 text-[13px] font-extrabold text-[#17213a]">
                  {isOpen ? 'Close' : done ? 'Open again' : 'Open lesson'}
                </button>
              </div>

              {isOpen && (
                <div className="flex flex-col gap-4 border-t border-line p-4">
                  <div className="flex flex-col gap-3 rounded-[16px] bg-panel-2/60 p-4">
                    {meta?.goal && <p className="text-sm font-bold text-paper-dim"><span className="font-extrabold text-paper">Goal: </span>{meta.goal}</p>}
                    <div className="flex flex-wrap gap-2">
                      {r.has_page && (
                        <button type="button" onClick={() => setReading(r)} className="focus-ring rounded-[12px] bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] px-3 py-1.5 text-[13px] font-extrabold text-brass">
                          Lesson page
                        </button>
                      )}
                      {meta?.slides_url && (
                        <button type="button" onClick={() => setViewing({ name: meta.slides_name || `Lesson ${r.number} slides`, url: meta.slides_url })} className="focus-ring rounded-[12px] bg-speaking-tint px-3 py-1.5 text-[13px] font-extrabold text-speaking">
                          Slides
                        </button>
                      )}
                    </div>
                    {files.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-[12px] font-extrabold uppercase tracking-wide text-mist">Materials used in class</p>
                        <div className="flex flex-wrap gap-2">
                          {files.map((f, i) => (
                            <button key={i} type="button" onClick={() => setViewing({ name: f.name || 'File', url: f.url })} className="focus-ring max-w-full truncate rounded-[12px] border border-line bg-panel px-3 py-1.5 text-[13px] font-extrabold text-paper hover:border-brass/50">
                              {f.name || 'File'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {meta === null && !r.has_page && <p className="text-[12px] font-bold text-mist">Loading…</p>}
                    {meta && !meta.goal && !meta.slides_url && files.length === 0 && !r.has_page && (
                      <p className="text-[12px] font-bold text-mist">Your teacher has not added materials to this lesson yet.</p>
                    )}
                  </div>

                  {r.hw ? (
                    <div className="overflow-hidden rounded-[16px] border border-line">{renderHomework(r.hw)}</div>
                  ) : (
                    <p className="text-[13px] font-bold text-mist">{r.skipped ? 'There was no class this day.' : 'This lesson has no homework.'}</p>
                  )}
                </div>
              )}
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
          <div className="flex flex-wrap items-center gap-3">
            {locked.length > 3 && (
              <button type="button" onClick={() => setShowAllLocked((v) => !v)} className="focus-ring text-[13px] font-extrabold text-brass">
                {showAllLocked ? 'Show fewer' : `All ${locked.length} coming lessons`}
              </button>
            )}
            <button type="button" onClick={askNext} disabled={asking} className="focus-ring rounded-[12px] border border-brass/50 px-3 py-1.5 text-[13px] font-extrabold text-brass hover:bg-panel-2 disabled:opacity-50">
              {asking ? 'Sending…' : 'Finished early? Ask for the next lesson'}
            </button>
          </div>
          {askMsg && <p className="text-[13px] font-bold text-paper-dim">{askMsg}</p>}
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
      {viewing && <FileViewer file={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
