import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { accuracyTone, qtypeLabel } from '../lib/questionTypes'
import { SkillIcon } from './SkillArt'

/*
 * Weak-spot report (2026-11-02, migration_89): accuracy per question type
 * from mocks, homework tests, workshop pages and the Books shelf.
 *
 *   <WeakSpots userId=… />            one student (student or teacher view)
 *   <WeakSpots groupId=… />           a whole group (teacher)
 *   onPractise(skill, qtype)          shows a "Practise" button per row
 *
 * Types with fewer than MIN_ANSWERS answers are listed but not judged.
 */
const MIN_ANSWERS = 5

export default function WeakSpots({ userId, groupId, onPractise, title = 'Weak spots', compact = false, emptyText = '' }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const call = groupId
      ? supabase.rpc('group_weak_spots', { p_group_id: groupId })
      : supabase.rpc('weak_spots', userId ? { p_user_id: userId } : {})
    call.then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        setError(err.message)
        setRows([])
      } else setRows((data || []).filter((r) => r.total > 0))
    })
    return () => {
      cancelled = true
    }
  }, [userId, groupId])

  const sorted = (rows || [])
    .map((r) => ({ ...r, pct: Math.round((100 * r.correct) / r.total) }))
    .sort((a, b) => {
      const aJ = a.total >= MIN_ANSWERS ? 0 : 1
      const bJ = b.total >= MIN_ANSWERS ? 0 : 1
      return aJ - bJ || a.pct - b.pct
    })
  const shown = compact ? sorted.slice(0, 5) : sorted
  const weakest = sorted.find((r) => r.total >= MIN_ANSWERS && r.pct < 55)

  return (
    <section className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-brand text-[18px] font-semibold text-paper">{title}</h2>
        {weakest && (
          <span className="rounded-xl bg-urgent-tint px-2.5 py-1 text-[12px] font-extrabold text-coral">
            Focus on: {qtypeLabel(weakest.qtype)}
          </span>
        )}
      </div>

      {rows === null ? (
        <p className="text-sm font-semibold text-mist">Loading…</p>
      ) : shown.length === 0 ? (
        <div className="flex items-center gap-4 rounded-[16px] bg-panel-2/60 p-4">
          <WeakSpotsArt className="h-16 w-20 shrink-0" />
          <p className="text-sm font-semibold text-paper-dim">
            {error ? 'Weak spots are not ready yet.' : emptyText || (groupId ? 'No scored Reading or Listening work yet.' : 'Do a few Reading or Listening tasks — your strongest and weakest question types show up here.')}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => {
            const judged = r.total >= MIN_ANSWERS
            const tone = accuracyTone(r.pct)
            return (
              <li key={`${r.skill}:${r.qtype}`} className="flex items-center gap-3 rounded-[14px] bg-panel-2/60 px-3 py-2.5">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${r.skill === 'listening' ? 'bg-listening-tint text-listening' : 'bg-reading-tint text-reading'}`}>
                  <SkillIcon skill={r.skill === 'listening' ? 'listening' : 'reading'} className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span className="min-w-0 text-sm font-extrabold leading-snug text-paper">{qtypeLabel(r.qtype)}</span>
                    <span className={`shrink-0 text-[13px] font-extrabold ${judged ? tone.text : 'text-mist'}`}>
                      {r.pct}%<span className="ml-1 font-bold text-mist">· {r.correct}/{r.total}{r.students ? ` · ${r.students} students` : ''}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-panel">
                    <div className={`h-full rounded-full ${judged ? tone.bar : 'bg-mist/50'}`} style={{ width: `${Math.max(4, r.pct)}%` }} />
                  </div>
                </div>
                {onPractise && (
                  <button
                    type="button"
                    onClick={() => onPractise(r.skill, r.qtype)}
                    className="focus-ring shrink-0 rounded-[12px] border border-line px-2.5 py-1.5 text-[13px] font-extrabold text-brass hover:border-brass sm:px-3"
                  >
                    Practise
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {compact && sorted.length > shown.length && <p className="text-[12px] font-bold text-mist">+{sorted.length - shown.length} more types</p>}
    </section>
  )
}

export function WeakSpotsArt({ className = '' }) {
  return (
    <svg viewBox="0 0 80 64" className={className} aria-hidden="true">
      <rect x="4" y="8" width="72" height="50" rx="10" fill="var(--color-reading-tint)" />
      <rect x="14" y="20" width="44" height="7" rx="3.5" fill="var(--color-sage)" opacity=".85" />
      <rect x="14" y="32" width="30" height="7" rx="3.5" fill="var(--color-saffron)" opacity=".9" />
      <rect x="14" y="44" width="16" height="7" rx="3.5" fill="var(--color-coral)" opacity=".85" />
      <circle cx="62" cy="47" r="9" fill="none" stroke="var(--color-brass)" strokeWidth="3.5" />
      <path d="M68.5 53.5 75 60" stroke="var(--color-brass)" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  )
}
