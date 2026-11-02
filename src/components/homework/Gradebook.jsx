import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import SkillAudioPlayer from '../SkillAudioPlayer'
import { supabase } from '../../lib/supabaseClient'
import { SkillIcon } from '../SkillArt'
import { TASK_KINDS, TASK_SELECT, gradeLabel, gradeTone, percentOf, summariseAttempts, taskTitle } from '../../lib/homeworkTasks'
import WeakSpots from '../WeakSpots'

/*
 * GRADEBOOK (2026-11-02) — every in-site homework task of a group:
 * students down the side, tasks across the top, the first-try grade in
 * each cell (the one that counts), coloured by how well it went, with a
 * small number when there were retakes. Tap a student for their own
 * page: averages per skill and every grade.
 */
export default function Gradebook({ roster, homeworks, accent }) {
  const [tasks, setTasks] = useState([])
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [student, setStudent] = useState(null)
  const [showAll, setShowAll] = useState(false)

  const hwIds = useMemo(() => homeworks.map((h) => h.id), [homeworks])
  const hwById = useMemo(() => Object.fromEntries(homeworks.map((h) => [h.id, h])), [homeworks])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hwIds.length) {
        setTasks([])
        setAttempts([])
        setLoading(false)
        return
      }
      setLoading(true)
      const { data: t, error } = await supabase.from('homework_tasks').select(`homework_id, ${TASK_SELECT}`).in('homework_id', hwIds)
      if (cancelled) return
      if (error || !t?.length) {
        setTasks([])
        setAttempts([])
        setLoading(false)
        return
      }
      const { data: a } = await supabase
        .from('homework_attempts')
        .select('id, task_id, user_id, attempt_no, mode, submitted_at, score, max_score, band, late')
        .in('task_id', t.map((x) => x.id))
        .not('submitted_at', 'is', null)
      if (cancelled) return
      setTasks(t)
      setAttempts(a || [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [hwIds])

  // Oldest homework first, tasks in their own order.
  const columns = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => {
      const ha = hwById[a.homework_id]
      const hb = hwById[b.homework_id]
      const d = new Date(ha?.created_at || 0) - new Date(hb?.created_at || 0)
      return d || a.position - b.position
    })
    return showAll ? sorted : sorted.slice(-8)
  }, [tasks, hwById, showAll])

  const cell = (taskId, userId) => summariseAttempts(attempts.filter((a) => a.task_id === taskId && a.user_id === userId))

  const rowAverage = (userId) => {
    const pcts = columns.map((t) => percentOf(cell(t.id, userId).first)).filter((p) => p != null)
    return pcts.length ? Math.round(pcts.reduce((n, p) => n + p, 0) / pcts.length) : null
  }

  if (loading) return null

  return (
    <section className="rounded-[20px] border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 sm:px-6">
        <div>
          <h2 className={`font-brand text-[18px] font-semibold ${accent?.text || 'text-paper'}`}>Grades</h2>
          <p className="text-[13px] font-semibold text-paper-dim">Tasks done in the site. First try counts; the small number is retakes.</p>
        </div>
        {tasks.length > 8 && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="focus-ring h-9 rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-paper hover:bg-panel-2">
            {showAll ? 'Last 8 tasks' : `All ${tasks.length} tasks`}
          </button>
        )}
      </div>

      {tasks.length === 0 ? (
        <div className="m-5 flex items-center gap-4 rounded-[20px] bg-panel-2/70 px-5 py-5 sm:m-6">
          <div className="flex gap-1.5" aria-hidden="true">
            {['reading', 'listening', 'wordlist'].map((k) => (
              <span key={k} className={`grid h-11 w-11 place-items-center rounded-2xl ${TASK_KINDS[k].tint} ${TASK_KINDS[k].text}`}>
                <SkillIcon skill={TASK_KINDS[k].skill} className="h-5 w-5" />
              </span>
            ))}
          </div>
          <p className="text-sm font-bold text-paper-dim">No in-site tasks yet. Add a test, word list, workshop or shadowing clip when you post homework.</p>
        </div>
      ) : (
        <div className="overflow-x-auto px-3 pb-4 pt-3 sm:px-4">
          <table className="w-full border-separate border-spacing-1.5 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-panel px-2 text-left text-[12px] font-extrabold text-mist">Student</th>
                <th className="px-1 text-[12px] font-extrabold text-mist">Avg</th>
                {columns.map((t) => {
                  const meta = TASK_KINDS[t.kind] || TASK_KINDS.reading
                  return (
                    <th key={t.id} className="min-w-[72px] px-1 align-bottom" title={`${hwById[t.homework_id]?.title || ''} — ${taskTitle(t)}`}>
                      <span className={`mx-auto grid h-8 w-8 place-items-center rounded-xl ${meta.tint} ${meta.text}`}>
                        <SkillIcon skill={meta.skill} className="h-4 w-4" />
                      </span>
                      <span className="mt-1 block max-w-[84px] truncate text-[11px] font-bold text-paper-dim">{taskTitle(t)}</span>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {roster.map((st) => {
                const avg = rowAverage(st.id)
                const avgTone = gradeTone(avg)
                return (
                  <tr key={st.id}>
                    <td className="sticky left-0 z-10 bg-panel px-1">
                      <button type="button" onClick={() => setStudent(st)} className="focus-ring max-w-[180px] truncate rounded-lg px-1.5 py-1 text-left text-[14px] font-extrabold text-paper hover:bg-panel-2">
                        {st.full_name || st.username}
                      </button>
                    </td>
                    <td>
                      <span className={`grid h-10 place-items-center rounded-xl px-2 text-[13px] font-extrabold ${avgTone.bg} ${avgTone.text}`}>{avg == null ? '—' : `${avg}%`}</span>
                    </td>
                    {columns.map((t) => {
                      const s = cell(t.id, st.id)
                      const pct = percentOf(s.first)
                      const tone = gradeTone(s.first ? pct ?? 100 : null)
                      return (
                        <td key={t.id}>
                          <span
                            className={`relative grid h-10 place-items-center rounded-xl text-[13px] font-extrabold ${s.first ? `${tone.bg} ${tone.text}` : 'bg-panel-2/60 text-mist'}`}
                            title={s.first ? `${gradeLabel(s.first)}${s.first.late ? ' · late' : ''}${s.tries > 1 ? ` · ${s.tries} tries` : ''}` : 'Not done'}
                          >
                            {s.first ? (s.first.band != null ? Number(s.first.band).toFixed(1) : pct != null ? `${pct}%` : '✓') : '—'}
                            {s.tries > 1 && (
                              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-paper px-1 text-[10px] font-extrabold text-panel">{s.tries - 1}</span>
                            )}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {student && (
        <StudentGrades
          student={student}
          tasks={tasks}
          attempts={attempts.filter((a) => a.user_id === student.id)}
          hwById={hwById}
          onClose={() => setStudent(null)}
        />
      )}
    </section>
  )
}

function StudentGrades({ student, tasks, attempts, hwById, onClose }) {
  const rows = tasks
    .map((t) => ({ t, s: summariseAttempts(attempts.filter((a) => a.task_id === t.id)), hw: hwById[t.homework_id] }))
    .sort((a, b) => new Date(b.hw?.created_at || 0) - new Date(a.hw?.created_at || 0))

  const skills = ['reading', 'listening', 'wordlist', 'html', 'shadowing']
    .map((k) => {
      const pcts = rows.filter((r) => r.t.kind === k).map((r) => percentOf(r.s.first)).filter((p) => p != null)
      return pcts.length ? { k, avg: Math.round(pcts.reduce((n, p) => n + p, 0) / pcts.length), n: pcts.length } : null
    })
    .filter(Boolean)
  const done = rows.filter((r) => r.s.first).length
  const bands = rows.filter((r) => r.s.first?.band != null)

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[24px] bg-ink sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
        <div className="registan-band flex items-center gap-3 px-5 py-4 text-white">
          <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-white/20 font-brand text-lg font-bold">
            {student.avatar_url ? <img src={student.avatar_url} alt="" className="h-full w-full object-cover" /> : (student.full_name || '?').charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-brand text-[20px] font-semibold">{student.full_name || student.username}</p>
            <p className="text-[13px] font-bold text-white/80">{done} of {rows.length} tasks done</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 place-items-center rounded-[14px] bg-white/15 hover:bg-white/25">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          {skills.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {skills.map(({ k, avg, n }) => {
                const meta = TASK_KINDS[k]
                return (
                  <div key={k} className={`flex items-center gap-3 rounded-[18px] px-4 py-3 ${meta.tint}`}>
                    <SkillIcon skill={meta.skill} className={`h-6 w-6 ${meta.text}`} />
                    <div>
                      <div className={`font-brand text-[22px] font-semibold leading-none ${meta.text}`}>{avg}%</div>
                      <div className="mt-1 text-[12px] font-extrabold text-paper-dim">{meta.short} · {n}</div>
                    </div>
                  </div>
                )
              })}
              {bands.length > 0 && (
                <div className="flex items-center gap-3 rounded-[18px] bg-[color-mix(in_srgb,var(--color-saffron)_18%,var(--color-panel))] px-4 py-3">
                  <div>
                    <div className="font-brand text-[22px] font-semibold leading-none text-amber">
                      {(bands.reduce((n, r) => n + Number(r.s.first.band), 0) / bands.length).toFixed(1)}
                    </div>
                    <div className="mt-1 text-[12px] font-extrabold text-paper-dim">average band</div>
                  </div>
                </div>
              )}
            </div>
          )}
          <WeakSpots userId={student.id} title="Weak spots by question type" emptyText="No scored Reading or Listening work yet." />
          <ul className="flex flex-col gap-2">
            {rows.map(({ t, s, hw }) => {
              const meta = TASK_KINDS[t.kind] || TASK_KINDS.reading
              const pct = percentOf(s.first)
              const tone = gradeTone(s.first ? pct ?? 100 : null)
              const bestPct = percentOf(s.best)
              return (
                <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-panel px-3 py-2.5">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.tint} ${meta.text}`}>
                    <SkillIcon skill={meta.skill} className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-extrabold text-paper">{taskTitle(t)}</p>
                    <p className="truncate text-xs font-bold text-mist">
                      {hw?.title}
                      {s.tries > 1 && bestPct != null ? ` · best ${bestPct}% in ${s.tries} tries` : ''}
                      {s.first?.late ? ' · late' : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-extrabold ${tone.bg} ${tone.text}`}>{s.first ? gradeLabel(s.first) : 'Not done'}</span>
                  {t.kind === 'shadowing' && s.first && <ShadowingTakes attemptId={s.first.id} />}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  )
}

// The student's shadowing recordings, loaded when the teacher opens them.
function ShadowingTakes({ attemptId }) {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState(null)
  const toggle = async () => {
    setOpen((v) => !v)
    if (lines) return
    const { data } = await supabase.from('homework_attempts').select('results').eq('id', attemptId).maybeSingle()
    setLines(data?.results?.lines || [])
  }
  return (
    <div className="w-full">
      <button type="button" onClick={toggle} className="focus-ring h-9 rounded-[12px] bg-speaking-tint px-3 text-[13px] font-extrabold text-speaking">
        {open ? 'Hide recordings' : 'Listen to recordings'}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {lines === null && <p className="text-xs font-bold text-mist">Loading…</p>}
          {lines?.length === 0 && <p className="text-xs font-bold text-mist">No recordings saved.</p>}
          {(lines || []).map((l) => (
            <SkillAudioPlayer key={l.url} src={l.url} label={`Line ${l.line + 1}`} sublabel={l.pct != null ? `${l.pct}% match` : ''} download={false} />
          ))}
        </div>
      )}
    </div>
  )
}
