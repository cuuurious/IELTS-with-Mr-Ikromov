import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { lazyWithReload } from '../../lib/lazyWithReload'
import { SkillIcon } from '../SkillArt'
import { gradeLabel, gradeTone, percentOf, summariseAttempts, taskMeta, taskTitle } from '../../lib/homeworkTasks'

const TestTask = lazyWithReload(() => import('./TestTask'))
const WordlistTask = lazyWithReload(() => import('./WordlistTask'))
const HtmlTask = lazyWithReload(() => import('./HtmlTask'))
const ShadowingTask = lazyWithReload(() => import('./ShadowingTask'))
const SpeakingTask = lazyWithReload(() => import('../speaking/SpeakingTask'))

/*
 * The tasks of one homework, on the student's homework card
 * (2026-11-02). Each task is a coloured card with its grade from the
 * first try (the one that counts) and how many tries so far.
 * onAllDone() runs once every task has been handed in at least once.
 */
export default function HomeworkTasksPanel({ homework, studentId, onAllDone }) {
  const tasks = useMemo(
    () => [...(homework.homework_tasks || [])].sort((a, b) => a.position - b.position),
    [homework.homework_tasks]
  )
  const [attempts, setAttempts] = useState([])
  const [openTask, setOpenTask] = useState(null)

  const load = useCallback(async () => {
    if (!tasks.length) return []
    const { data } = await supabase
      .from('homework_attempts')
      .select('id, task_id, attempt_no, mode, submitted_at, score, max_score, band, late')
      .in('task_id', tasks.map((t) => t.id))
      .eq('user_id', studentId)
    setAttempts(data || [])
    return data || []
  }, [tasks, studentId])

  useEffect(() => {
    load()
  }, [load])

  const refresh = async () => {
    const rows = await load()
    const allDone = tasks.every((t) => rows.some((a) => a.task_id === t.id && a.submitted_at))
    if (allDone) onAllDone?.()
  }

  if (!tasks.length) return null

  const doneCount = tasks.filter((t) => attempts.some((a) => a.task_id === t.id && a.submitted_at)).length

  const runner = (() => {
    if (!openTask) return null
    const props = { task: openTask, studentId, onClose: () => setOpenTask(null), onChanged: refresh }
    if (openTask.kind === 'reading' || openTask.kind === 'listening') return <TestTask {...props} />
    if (openTask.kind === 'wordlist') return <WordlistTask {...props} />
    if (openTask.kind === 'html' && /^speaking:/.test(openTask.html_url || '')) return <SpeakingTask {...props} />
    if (openTask.kind === 'html') return <HtmlTask {...props} />
    if (openTask.kind === 'shadowing') return <ShadowingTask {...props} />
    return null
  })()

  return (
    <div className="flex flex-col gap-3 rounded-[20px] bg-panel-2/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-brand text-[16px] font-semibold text-paper">Do it here</p>
        <span className={`rounded-xl px-2.5 py-1 text-xs font-extrabold ${doneCount === tasks.length ? 'bg-reading-tint text-reading' : 'bg-panel text-paper-dim'}`}>
          {doneCount}/{tasks.length} done
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {tasks.map((t) => {
          const meta = taskMeta(t)
          const s = summariseAttempts(attempts.filter((a) => a.task_id === t.id))
          const pct = percentOf(s.first)
          const tone = gradeTone(pct)
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setOpenTask(t)}
              className="focus-ring group flex min-w-0 items-center gap-3 rounded-[16px] border border-line bg-panel p-3 text-left transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(36,86,176,0.10)]"
            >
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${meta.tint} ${meta.text}`} aria-hidden="true">
                <SkillIcon skill={meta.skill} className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-extrabold text-paper">{taskTitle(t)}</span>
                <span className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-extrabold">
                  <span className={`rounded-lg px-2 py-0.5 ${meta.tint} ${meta.text}`}>{meta.short}</span>
                  {s.first ? (
                    <>
                      <span className={`rounded-lg px-2 py-0.5 ${tone.bg} ${tone.text}`}>{gradeLabel(s.first)}</span>
                      {s.tries > 1 && <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-paper-dim">{s.tries} tries</span>}
                    </>
                  ) : s.open ? (
                    <span className="rounded-lg bg-saffron/20 px-2 py-0.5 text-amber">In progress</span>
                  ) : (
                    <span className="rounded-lg bg-panel-2 px-2 py-0.5 text-mist">Not started</span>
                  )}
                </span>
              </span>
              <span className={`grid h-10 shrink-0 place-items-center rounded-[12px] px-3 text-[13px] font-extrabold ${s.first ? 'bg-panel-2 text-paper' : 'bg-saffron text-[#17213a]'}`}>
                {s.first ? 'Again' : s.open ? 'Continue' : 'Start'}
              </span>
            </button>
          )
        })}
      </div>
      {/* At the page root: a parent card's animation would otherwise
          trap these full-screen pages inside it. */}
      {runner && createPortal(<Suspense fallback={<div className="fixed inset-0 z-[70] bg-ink/80" />}>{runner}</Suspense>, document.body)}
    </div>
  )
}
