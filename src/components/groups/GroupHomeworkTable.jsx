import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { getSubmissionStatus } from '../StampBadge'
import { skillOfHomework, formatDue } from '../../lib/skills'
import { SkillIcon } from '../SkillArt'
import { gradeTone, percentOf, summariseAttempts } from '../../lib/homeworkTasks'

/*
 * Group page → Homework tab (2026-11-05).
 * One compact row per homework: what it is, the deadline, how many have
 * done it, the class average (first tries of in-site tasks), and the
 * actions. Tap a row to see every student's state; tap a student to open
 * what they handed in.
 */
const STATUS = {
  done: { label: 'Done', cls: 'bg-reading-tint text-reading' },
  late: { label: 'Late', cls: 'bg-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-panel))] text-amber' },
  overdue: { label: 'Missed', cls: 'bg-urgent-tint text-coral' },
  pending: { label: 'Not yet', cls: 'bg-panel-2 text-mist' },
}

const PAGE = 12

function ActionButton({ onClick, disabled, title, danger, children }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`focus-ring grid h-9 w-9 place-items-center rounded-xl transition disabled:opacity-40 ${danger ? 'text-coral hover:bg-urgent-tint' : 'text-mist hover:bg-panel-2 hover:text-paper'}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}

export default function GroupHomeworkTable({ homeworks, roster, submissions, accent, busyAction, onRemind, onEdit, onReset, onDelete, onOpenSubmission }) {
  const [openId, setOpenId] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [averages, setAverages] = useState({}) // homework id -> % | undefined

  const sorted = useMemo(
    () => [...homeworks].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
    [homeworks]
  )
  const shown = showAll ? sorted : sorted.slice(0, PAGE)
  const hwKey = homeworks.map((h) => h.id).join(',')

  // Class average per homework: first try of each in-site task.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ids = homeworks.map((h) => h.id)
      if (!ids.length) return setAverages({})
      const { data: t } = await supabase.from('homework_tasks').select('id, homework_id').in('homework_id', ids)
      if (cancelled || !t?.length) return setAverages({})
      const { data: a } = await supabase
        .from('homework_attempts')
        .select('id, task_id, user_id, attempt_no, submitted_at, score, max_score')
        .in('task_id', t.map((x) => x.id))
        .not('submitted_at', 'is', null)
      if (cancelled) return
      const byTaskUser = {}
      ;(a || []).forEach((x) => {
        const k = `${x.task_id}_${x.user_id}`
        ;(byTaskUser[k] = byTaskUser[k] || []).push(x)
      })
      const hwOfTask = Object.fromEntries(t.map((x) => [x.id, x.homework_id]))
      const sums = {}
      Object.entries(byTaskUser).forEach(([k, list]) => {
        const pct = percentOf(summariseAttempts(list).first)
        if (pct == null) return
        const hw = hwOfTask[k.split('_')[0]]
        sums[hw] = sums[hw] || { s: 0, n: 0 }
        sums[hw].s += pct
        sums[hw].n += 1
      })
      setAverages(Object.fromEntries(Object.entries(sums).map(([id, v]) => [id, Math.round(v.s / v.n)])))
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hwKey])

  if (!homeworks.length) {
    return (
      <section className="rounded-[20px] border border-dashed border-line bg-panel px-5 py-10 text-center">
        <p className="font-brand text-[17px] font-semibold text-paper">No homework yet</p>
        <p className="mt-1 text-sm font-semibold text-mist">Press “Post homework” above to give the first one.</p>
      </section>
    )
  }

  const now = Date.now()

  return (
    <section className="overflow-hidden rounded-[20px] border border-line bg-panel">
      <div className="hidden grid-cols-[minmax(0,1fr)_120px_150px_70px_150px] items-center gap-3 border-b border-line px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-mist md:grid">
        <span>Homework</span>
        <span>Deadline</span>
        <span>Done</span>
        <span>Average</span>
        <span className="text-right">Actions</span>
      </div>
      <ul>
        {shown.map((h) => {
          const skill = skillOfHomework(h)
          const states = roster.map((st) => ({ st, sub: submissions[`${h.id}_${st.id}`], status: getSubmissionStatus(submissions[`${h.id}_${st.id}`], h.due_date) }))
          const done = states.filter((x) => x.status === 'done' || x.status === 'late').length
          const missing = roster.length - done
          const past = h.due_date && new Date(h.due_date).getTime() <= now
          const avg = averages[h.id]
          const tone = gradeTone(avg ?? null)
          const isOpen = openId === h.id
          return (
            <li key={h.id} className="border-t border-line first:border-t-0">
              <div
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? null : h.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenId(isOpen ? null : h.id))}
                className={`focus-ring grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition hover:bg-panel-2/60 md:grid-cols-[minmax(0,1fr)_120px_150px_70px_150px] md:px-5 ${isOpen ? 'bg-panel-2/60' : ''}`}
              >
                <div className="col-span-2 flex min-w-0 items-center gap-3 md:col-span-1">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${skill.tint} ${skill.key === 'general' ? 'text-paper' : skill.text}`}>
                    <SkillIcon skill={skill.key} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[15px] font-extrabold text-paper" title={h.title}>{h.title}</p>
                    <p className="text-xs font-semibold text-mist md:hidden">
                      {h.due_date ? `${past ? 'Closed' : 'Due'} ${formatDue(h.due_date)}` : 'No deadline'}
                    </p>
                  </div>
                </div>
                <span className={`row-start-1 col-start-3 justify-self-end text-lg font-bold text-mist transition md:hidden ${isOpen ? 'rotate-90' : ''}`} aria-hidden="true">›</span>
                <p className="hidden text-[13px] font-bold text-paper-dim md:block">
                  {h.due_date ? (
                    <>
                      <span className={past ? 'text-mist' : 'text-paper'}>{formatDue(h.due_date)}</span>
                    </>
                  ) : (
                    <span className="text-mist">No deadline</span>
                  )}
                </p>
                <div className="col-span-2 md:col-span-1">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-md bg-panel-2">
                      <div className={`h-full rounded-md ${accent.bar}`} style={{ width: `${roster.length ? (done / roster.length) * 100 : 0}%` }} />
                    </div>
                    <span className="w-12 shrink-0 text-right text-[13px] font-extrabold text-paper">{done}/{roster.length}</span>
                  </div>
                  {past && missing > 0 && <p className="mt-0.5 text-[11px] font-extrabold text-coral">{missing} missed</p>}
                </div>
                <span className={`w-fit justify-self-end rounded-lg px-2 py-1 text-xs font-extrabold md:justify-self-start ${tone.bg} ${tone.text}`}>
                  {avg == null ? '—' : `${avg}%`}
                </span>
                <div className="col-span-3 flex items-center justify-end gap-0.5 md:col-span-1">
                  {missing > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemind(h)
                      }}
                      disabled={busyAction === `remind-${h.id}`}
                      className="focus-ring mr-1 h-9 rounded-xl border border-line px-3 text-xs font-extrabold text-brass transition hover:bg-panel-2 disabled:opacity-50"
                      title="Remind everyone who hasn't done it"
                    >
                      {busyAction === `remind-${h.id}` ? 'Sending…' : 'Remind'}
                    </button>
                  )}
                  <ActionButton onClick={() => onEdit(h)} title="Edit homework">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </ActionButton>
                  <ActionButton onClick={() => onReset(h)} disabled={busyAction === `clear-${h.id}`} title="Reset submissions">
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    <path d="M3 21v-5h5" />
                  </ActionButton>
                  <ActionButton onClick={() => onDelete(h)} disabled={busyAction === `delete-${h.id}`} title="Delete homework completely" danger>
                    <path d="M3 6h18" />
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  </ActionButton>
                </div>
              </div>
              {isOpen && (
                <div className="border-t border-line bg-panel-2/40 px-4 py-3 md:px-5">
                  {roster.length === 0 ? (
                    <p className="text-sm font-semibold text-mist">No students in this group yet.</p>
                  ) : (
                    <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {states
                        .sort((a, b) => ['overdue', 'pending', 'late', 'done'].indexOf(a.status) - ['overdue', 'pending', 'late', 'done'].indexOf(b.status))
                        .map(({ st, sub, status }) => {
                          const s = STATUS[status] || STATUS.pending
                          const writing = h.homework_type === 'writing_mock' && Boolean(sub?.mock_essay?.started_at) && status === 'pending'
                          return (
                            <li key={st.id}>
                              <button
                                type="button"
                                onClick={() => onOpenSubmission({ studentName: st.full_name, homeworkTitle: h.title, submission: sub })}
                                className="focus-ring flex w-full items-center gap-2.5 rounded-[14px] bg-panel px-3 py-2 text-left transition hover:ring-1 hover:ring-line"
                              >
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel-2 text-xs font-extrabold text-paper-dim">
                                  {st.full_name?.charAt(0)?.toUpperCase() || '?'}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm font-bold text-paper">{st.full_name || st.username}</span>
                                <span className={`shrink-0 rounded-lg px-2 py-0.5 text-[11px] font-extrabold ${s.cls}`}>{writing ? 'Writing…' : s.label}</span>
                              </button>
                            </li>
                          )
                        })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {sorted.length > PAGE && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="focus-ring w-full border-t border-line px-5 py-3 text-sm font-extrabold text-brass hover:bg-panel-2/60">
          {showAll ? 'Show the latest only' : `Show all ${sorted.length} homeworks`}
        </button>
      )}
    </section>
  )
}
