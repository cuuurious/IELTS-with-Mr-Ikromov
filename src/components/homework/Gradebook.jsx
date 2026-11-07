import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import SkillAudioPlayer from '../SkillAudioPlayer'
import { supabase } from '../../lib/supabaseClient'
import SpeakingFeedback from '../speaking/SpeakingFeedback'
import WritingFeedback from './WritingFeedback'
import TeacherBand from './TeacherBand'
import { SkillIcon } from '../SkillArt'
import { TASK_KINDS, TASK_SELECT, gradeLabel, gradeTone, percentOf, summariseAttempts, taskMeta, taskTitle } from '../../lib/homeworkTasks'
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

  // 2026-11-07: two views. "By homework" (default) — one column per
  // homework with its overall result; "By task" — one column per task.
  // Every cell opens that student's work; every column title opens the
  // whole class's results for that homework or task.
  const [view, setView] = useState('hw')
  const [detail, setDetail] = useState(null) // { kind: 'cell'|'hw'|'task', ... }

  // Oldest homework first, tasks in their own order.
  const sortedTasks = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        const ha = hwById[a.homework_id]
        const hb = hwById[b.homework_id]
        const d = new Date(ha?.created_at || 0) - new Date(hb?.created_at || 0)
        return d || a.position - b.position
      }),
    [tasks, hwById]
  )
  const hwCols = useMemo(() => {
    const seen = []
    sortedTasks.forEach((t) => {
      let g = seen.find((x) => x.hw.id === t.homework_id)
      if (!g && hwById[t.homework_id]) seen.push((g = { hw: hwById[t.homework_id], tasks: [] }))
      if (g) g.tasks.push(t)
    })
    return showAll ? seen : seen.slice(-8)
  }, [sortedTasks, hwById, showAll])
  const columns = useMemo(() => (showAll ? sortedTasks : sortedTasks.slice(-8)), [sortedTasks, showAll])
  const hwCount = useMemo(() => new Set(tasks.map((t) => t.homework_id)).size, [tasks])

  const cell = (taskId, userId) => summariseAttempts(attempts.filter((a) => a.task_id === taskId && a.user_id === userId))

  // One homework for one student: tasks done, and one overall mark —
  // the average band when every done task is a speaking band, else the
  // average percentage.
  const hwCell = (group, userId) => {
    const sums = group.tasks.map((t) => cell(t.id, userId))
    const done = sums.filter((x) => x.first)
    const bands = done.filter((x) => x.first.score == null && x.first.band != null)
    const pcts = done.map((x) => percentOf(x.first)).filter((p) => p != null)
    const pct = pcts.length ? Math.round(pcts.reduce((n, p) => n + p, 0) / pcts.length) : null
    const label = !done.length
      ? '—'
      : bands.length === done.length
        ? (bands.reduce((n, x) => n + Number(x.first.band), 0) / bands.length).toFixed(1)
        : pct != null
          ? `${pct}%`
          : '✓'
    return { done: done.length, total: group.tasks.length, pct, label, retakes: sums.reduce((n, x) => n + Math.max(0, x.tries - 1), 0), late: done.some((x) => x.first.late) }
  }

  const rowAverage = (userId) => {
    const shown = view === 'hw' ? hwCols.flatMap((g) => g.tasks) : columns
    const pcts = shown.map((t) => percentOf(cell(t.id, userId).first)).filter((p) => p != null)
    return pcts.length ? Math.round(pcts.reduce((n, p) => n + p, 0) / pcts.length) : null
  }

  if (loading) return null

  const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '')
  const Retakes = ({ n }) =>
    n > 0 ? <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-paper px-1 text-[10px] font-extrabold text-panel">{n}</span> : null

  return (
    <section className="rounded-[20px] border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 sm:px-6">
        <div>
          <h2 className={`font-brand text-[18px] font-semibold ${accent?.text || 'text-paper'}`}>Grades</h2>
          <p className="text-[13px] font-semibold text-paper-dim">Tap a mark to see the work, or a title to see the whole class. First try counts; the small number is retakes.</p>
        </div>
        {tasks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-[12px] bg-panel-2 p-1" role="tablist" aria-label="Show grades">
              {[
                ['hw', 'By homework'],
                ['task', 'By task'],
              ].map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`focus-ring h-8 rounded-[10px] px-3 text-[13px] font-extrabold ${view === k ? 'bg-panel text-paper shadow-sm' : 'text-mist hover:text-paper'}`}>
                  {label}
                </button>
              ))}
            </div>
            {(view === 'hw' ? hwCount : tasks.length) > 8 && (
              <button type="button" onClick={() => setShowAll((v) => !v)} className="focus-ring h-9 rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-paper hover:bg-panel-2">
                {showAll ? (view === 'hw' ? 'Last 8 homeworks' : 'Last 8 tasks') : view === 'hw' ? `All ${hwCount} homeworks` : `All ${tasks.length} tasks`}
              </button>
            )}
          </div>
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
                <th className="sticky left-0 z-10 bg-panel px-2 text-left align-bottom text-[12px] font-extrabold text-mist">Student</th>
                <th className="px-1 align-bottom text-[12px] font-extrabold text-mist">Avg</th>
                {view === 'hw'
                  ? hwCols.map((g) => (
                      <th key={g.hw.id} className="min-w-[104px] px-0.5 align-bottom">
                        <button type="button" onClick={() => setDetail({ kind: 'hw', group: g })} className="focus-ring group flex w-full flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 hover:bg-panel-2" title={`${g.hw.title} — see the whole class`}>
                          <span className="flex -space-x-1">
                            {[...new Set(g.tasks.map((t) => taskMeta(t).skill))].slice(0, 3).map((sk) => {
                              const meta = taskMeta(g.tasks.find((t) => taskMeta(t).skill === sk))
                              return (
                                <span key={sk} className={`grid h-7 w-7 place-items-center rounded-lg ring-2 ring-panel ${meta.tint} ${meta.text}`}>
                                  <SkillIcon skill={sk} className="h-3.5 w-3.5" />
                                </span>
                              )
                            })}
                          </span>
                          <span className="line-clamp-2 max-w-[112px] text-center text-[12px] font-extrabold leading-tight text-paper group-hover:text-brass">{g.hw.title || 'Homework'}</span>
                          <span className="text-[11px] font-bold text-mist">
                            {fmtDay(g.hw.created_at)} · {g.tasks.length} task{g.tasks.length === 1 ? '' : 's'}
                          </span>
                        </button>
                      </th>
                    ))
                  : columns.map((t) => {
                      const meta = taskMeta(t)
                      return (
                        <th key={t.id} className="min-w-[84px] px-0.5 align-bottom">
                          <button type="button" onClick={() => setDetail({ kind: 'task', task: t })} className="focus-ring group flex w-full flex-col items-center gap-1 rounded-xl px-1 py-1.5 hover:bg-panel-2" title={`${hwById[t.homework_id]?.title || ''} — ${taskTitle(t)}`}>
                            <span className={`grid h-7 w-7 place-items-center rounded-lg ${meta.tint} ${meta.text}`}>
                              <SkillIcon skill={meta.skill} className="h-3.5 w-3.5" />
                            </span>
                            <span className="line-clamp-2 max-w-[96px] text-center text-[11px] font-bold leading-tight text-paper-dim group-hover:text-brass">{taskTitle(t)}</span>
                          </button>
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
                    {view === 'hw'
                      ? hwCols.map((g) => {
                          const c = hwCell(g, st.id)
                          const tone = gradeTone(c.done ? c.pct ?? 100 : null)
                          return (
                            <td key={g.hw.id}>
                              <button
                                type="button"
                                onClick={() => setDetail({ kind: 'cell', student: st, hw: g.hw })}
                                className={`focus-ring relative flex h-11 w-full flex-col items-center justify-center rounded-xl text-[13px] font-extrabold leading-none transition hover:brightness-110 ${c.done ? `${tone.bg} ${tone.text}` : 'bg-panel-2/60 text-mist hover:bg-panel-2'}`}
                                title={`${st.full_name || ''} — ${g.hw.title}: ${c.done} of ${c.total} done${c.late ? ' · late' : ''}`}
                              >
                                {c.label}
                                {c.done > 0 && c.done < c.total && <span className="mt-0.5 text-[10px] font-bold opacity-80">{c.done}/{c.total}</span>}
                                <Retakes n={c.retakes} />
                              </button>
                            </td>
                          )
                        })
                      : columns.map((t) => {
                          const s = cell(t.id, st.id)
                          const pct = percentOf(s.first)
                          const tone = gradeTone(s.first ? pct ?? 100 : null)
                          return (
                            <td key={t.id}>
                              <button
                                type="button"
                                onClick={() => setDetail({ kind: 'cell', student: st, hw: hwById[t.homework_id] })}
                                className={`focus-ring relative grid h-11 w-full place-items-center rounded-xl text-[13px] font-extrabold transition hover:brightness-110 ${s.first ? `${tone.bg} ${tone.text}` : 'bg-panel-2/60 text-mist hover:bg-panel-2'}`}
                                title={s.first ? `${gradeLabel(s.first)}${s.first.late ? ' · late' : ''}${s.tries > 1 ? ` · ${s.tries} tries` : ''}` : 'Not done'}
                              >
                                {s.first ? (s.first.band != null && s.first.score == null ? Number(s.first.band).toFixed(1) : pct != null ? `${pct}%` : '✓') : '—'}
                                <Retakes n={s.tries - 1} />
                              </button>
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

      {detail?.kind === 'cell' && (
        <DetailModal title={detail.student.full_name || detail.student.username} subtitle={detail.hw?.title} onClose={() => setDetail(null)}>
          <HomeworkResults homeworkId={detail.hw?.id} studentId={detail.student.id} />
        </DetailModal>
      )}
      {detail?.kind === 'hw' && (
        <DetailModal title={detail.group.hw.title || 'Homework'} subtitle={`Whole class · ${detail.group.tasks.length} task${detail.group.tasks.length === 1 ? '' : 's'}`} onClose={() => setDetail(null)}>
          <ul className="flex flex-col gap-2">
            {roster.map((st) => {
              const c = hwCell(detail.group, st.id)
              const tone = gradeTone(c.done ? c.pct ?? 100 : null)
              return (
                <li key={st.id}>
                  <button type="button" onClick={() => setDetail({ kind: 'cell', student: st, hw: detail.group.hw })} className="focus-ring flex w-full flex-wrap items-center gap-2 rounded-[16px] border border-line bg-panel px-3 py-2.5 text-left hover:bg-panel-2">
                    <span className="min-w-[140px] flex-1 truncate text-sm font-extrabold text-paper">{st.full_name || st.username}</span>
                    <span className="flex flex-wrap gap-1">
                      {detail.group.tasks.map((t) => {
                        const s = cell(t.id, st.id)
                        const p = percentOf(s.first)
                        const tt = gradeTone(s.first ? p ?? 100 : null)
                        return (
                          <span key={t.id} title={taskTitle(t)} className={`rounded-lg px-2 py-1 text-[11px] font-extrabold ${s.first ? `${tt.bg} ${tt.text}` : 'bg-panel-2 text-mist'}`}>
                            {s.first ? (s.first.band != null && s.first.score == null ? Number(s.first.band).toFixed(1) : p != null ? `${p}%` : '✓') : '—'}
                          </span>
                        )
                      })}
                    </span>
                    <span className={`w-14 shrink-0 rounded-xl py-1.5 text-center text-xs font-extrabold ${tone.bg} ${tone.text}`}>{c.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </DetailModal>
      )}
      {detail?.kind === 'task' && (
        <DetailModal title={taskTitle(detail.task)} subtitle={`${hwById[detail.task.homework_id]?.title || ''} · whole class`} onClose={() => setDetail(null)}>
          <ul className="flex flex-col gap-2">
            {roster.map((st) => (
              <TaskResultRow key={st.id} t={detail.task} s={cell(detail.task.id, st.id)} name={st.full_name || st.username} onBand={(id, band) => setAttempts((prev) => prev.map((a) => (a.id === id ? { ...a, band } : a)))} />
            ))}
          </ul>
        </DetailModal>
      )}

      {student && (
        <StudentGrades
          student={student}
          tasks={tasks}
          attempts={attempts.filter((a) => a.user_id === student.id)}
          hwById={hwById}
          onClose={() => setStudent(null)}
          onBand={(id, band) => setAttempts((prev) => prev.map((a) => (a.id === id ? { ...a, band } : a)))}
        />
      )}
    </section>
  )
}

function StudentGrades({ student, tasks, attempts, hwById, onClose, onBand }) {
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
            {rows.map(({ t, s, hw }) => (
              <TaskResultRow key={t.id} t={t} s={s} sub={hw?.title} onBand={onBand} />
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  )
}

// A window over the grade table (2026-11-07).
function DetailModal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[24px] bg-ink sm:rounded-[24px]" onClick={(e) => e.stopPropagation()}>
        <div className="registan-band flex items-center gap-3 px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="truncate font-brand text-[19px] font-semibold">{title}</p>
            {subtitle && <p className="truncate text-[13px] font-bold text-white/80">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-white/15 hover:bg-white/25">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}

// One task's result: skill, title, first-try grade (best if retaken),
// and the student's work — recordings, writing, page answers.
function TaskResultRow({ t, s, sub, name, onBand }) {
  const meta = taskMeta(t)
  const pct = percentOf(s.first)
  const tone = gradeTone(s.first ? pct ?? 100 : null)
  const bestPct = percentOf(s.best)
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-panel px-3 py-2.5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.tint} ${meta.text}`}>
        <SkillIcon skill={meta.skill} className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-extrabold text-paper">{name || taskTitle(t)}</p>
        <p className="truncate text-xs font-bold text-mist">
          {sub}
          {s.tries > 1 && bestPct != null ? `${sub ? ' · ' : ''}best ${bestPct}% in ${s.tries} tries` : s.tries > 1 ? `${sub ? ' · ' : ''}${s.tries} tries` : ''}
          {s.first?.late ? ' · late' : ''}
        </p>
      </div>
      <span className={`shrink-0 rounded-xl px-2.5 py-1.5 text-xs font-extrabold ${tone.bg} ${tone.text}`}>{s.first ? gradeLabel(s.first) : 'Not done'}</span>
      {t.kind === 'shadowing' && s.first && <ShadowingTakes attemptId={s.first.id} />}
      {t.kind === 'html' && s.first && (/^speaking:/.test(t.html_url || '') ? <SpeakingAnswer attemptId={s.first.id} url={t.html_url} onBand={onBand} /> : <PageAnswer attemptId={s.first.id} onBand={onBand} writing={/\/writing\//.test(t.html_url || '')} />)}
    </li>
  )
}

/*
 * One student's in-site tasks of ONE homework (2026-11-07): shown in the
 * submission window of the group table, so a homework made only of site
 * tasks (a speaking test, a listening page…) is not an empty window.
 */
export function HomeworkResults({ homeworkId, studentId }) {
  const [tasks, setTasks] = useState(null)
  const [attempts, setAttempts] = useState([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!homeworkId || !studentId) return setTasks([])
      const { data: t } = await supabase.from('homework_tasks').select(`homework_id, ${TASK_SELECT}`).eq('homework_id', homeworkId).order('position')
      if (cancelled) return
      if (!t?.length) return setTasks([])
      const { data: a } = await supabase
        .from('homework_attempts')
        .select('id, task_id, user_id, attempt_no, mode, submitted_at, score, max_score, band, late')
        .in('task_id', t.map((x) => x.id))
        .eq('user_id', studentId)
        .not('submitted_at', 'is', null)
      if (cancelled) return
      setAttempts(a || [])
      setTasks(t)
    })()
    return () => {
      cancelled = true
    }
  }, [homeworkId, studentId])

  if (!tasks) return <p className="text-sm font-semibold text-mist">Loading the tasks…</p>
  if (!tasks.length) return null
  const onBand = (id, band) => setAttempts((prev) => prev.map((a) => (a.id === id ? { ...a, band } : a)))
  return (
    <ul className="flex flex-col gap-2">
      {tasks.map((t) => (
        <TaskResultRow key={t.id} t={t} s={summariseAttempts(attempts.filter((a) => a.task_id === t.id))} onBand={onBand} />
      ))}
    </ul>
  )
}

// A speaking test: recordings, what was heard and the AI feedback
// (2026-11-05). "Mark again" re-runs the AI marking.
function SpeakingAnswer({ attemptId, url, onBand }) {
  const [open, setOpen] = useState(false)
  const [row, setRow] = useState(undefined)
  const [set, setSet] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const { data } = await supabase.from('homework_attempts').select('id, band, results').eq('id', attemptId).maybeSingle()
    setRow(data || null)
  }
  const toggle = async () => {
    setOpen((v) => !v)
    if (row !== undefined) return
    load()
    const { parseSpeakingUrl, loadSpeakingSet } = await import('../../lib/speaking')
    const ref = parseSpeakingUrl(url)
    if (ref) loadSpeakingSet(ref.setId).then(setSet).catch(() => setSet({ content: {} }))
  }
  const markAgain = async () => {
    setBusy(true)
    await supabase.functions.invoke('ai-grading', { body: { action: 'speaking_task', attemptId } })
    await load()
    setBusy(false)
  }
  return (
    <div className="w-full">
      <button type="button" onClick={toggle} className="focus-ring h-9 rounded-[12px] bg-speaking-tint px-3 text-[13px] font-extrabold text-speaking">
        {open ? 'Hide answers' : 'Listen & feedback'}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {row === undefined ? (
            <p className="text-xs font-bold text-mist">Loading…</p>
          ) : (
            <>
              {row?.results?.ai?.status !== 'processing' && (
                <button type="button" onClick={markAgain} disabled={busy} className="focus-ring self-start text-[12px] font-extrabold text-brass disabled:opacity-50">
                  {busy ? 'Marking… (about a minute)' : row?.results?.ai?.status === 'done' ? 'Mark again with AI' : 'Mark with AI'}
                </button>
              )}
              {row && (
                <TeacherBand
                  attemptId={attemptId}
                  results={row.results}
                  aiBand={row.results?.ai?.overall_band}
                  onSaved={(next) => {
                    setRow((r) => ({ ...r, results: next }))
                    onBand?.(attemptId, next.teacher?.band ?? next.ai?.overall_band ?? null)
                  }}
                />
              )}
              <SpeakingFeedback set={set} results={row?.results} teacher />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// What the student typed on a practice page (Writing pages) and the
// page's own part scores — loaded when the teacher opens it (2026-11-02).
function PageAnswer({ attemptId, onBand, writing = false }) {
  const [open, setOpen] = useState(false)
  const [res, setRes] = useState(undefined)
  const toggle = async () => {
    setOpen((v) => !v)
    if (res !== undefined) return
    const { data } = await supabase.from('homework_attempts').select('results').eq('id', attemptId).maybeSingle()
    setRes(data?.results || null)
  }
  return (
    <div className="w-full">
      <button type="button" onClick={toggle} className="focus-ring h-9 rounded-[12px] bg-writing-tint px-3 text-[13px] font-extrabold text-writing">
        {open ? 'Hide answer' : 'Read answer'}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {res === undefined && <p className="text-xs font-bold text-mist">Loading…</p>}
          {res !== undefined && !res?.texts?.length && !res?.parts?.length && <p className="text-xs font-bold text-mist">Nothing typed on this page — only the score was saved.</p>}
          {(res?.parts || []).length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {res.parts.map((p, i) => (
                <span key={i} className="rounded-lg bg-panel-2 px-2 py-0.5 text-[12px] font-bold text-paper-dim" title={p.label}>
                  {p.score}/{p.max}
                </span>
              ))}
            </div>
          )}
          {!res?.ai && res?.check?.tot > 0 && (
            <p className="text-[12px] font-bold text-paper-dim">
              Page self-check: <span className="font-extrabold text-paper">{res.check.got}/{res.check.tot}</span> features of the sample answer (not a band score)
            </p>
          )}
          {writing && res?.texts?.length > 0 && (
            <TeacherBand
              attemptId={attemptId}
              results={res}
              aiBand={res?.ai?.overall_band}
              onSaved={(next) => {
                setRes(next)
                onBand?.(attemptId, next.teacher?.band ?? next.ai?.overall_band ?? null)
              }}
            />
          )}
          {res?.ai && <WritingFeedback results={res} teacher />}
          {!res?.ai && (res?.texts || []).map((t) => (
            <div key={t.id} className="rounded-[14px] bg-panel-2/60 px-3 py-2">
              <p className="mb-1 text-[11px] font-extrabold uppercase tracking-wide text-mist">{t.text.trim().split(/\s+/).length} words</p>
              <p className="whitespace-pre-wrap text-sm text-paper">{t.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
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
