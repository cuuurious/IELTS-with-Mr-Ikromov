import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * "Practising again" (2026-11-17, migration_132): which students of the
 * group redid their in-site homework tasks in the last 7 or 30 days — the
 * hard-working ones. Teacher only. Quiet when migration_132 is not run.
 */
export default function RepracticeCard({ groupId }) {
  const [days, setDays] = useState(7)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    supabase.rpc('group_repractice', { p_group_id: groupId, p_days: days }).then(({ data, error }) => {
      if (!cancelled) setRows(error ? false : data || [])
    })
    return () => {
      cancelled = true
    }
  }, [groupId, days])

  if (rows === false) return null

  return (
    <div className="mx-4 mb-4 rounded-[16px] border border-line bg-panel-2/50 p-4 sm:mx-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-brand text-[15px] font-semibold text-paper">Practising again</p>
        <div className="inline-flex rounded-xl border border-line bg-panel p-0.5">
          {[7, 30].map((d) => (
            <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={`focus-ring rounded-[10px] px-3 py-1 text-[12px] font-extrabold ${days === d ? 'bg-brass text-onbrass' : 'text-paper-dim'}`}>
              {d} days
            </button>
          ))}
        </div>
      </div>
      {rows === null ? (
        <p className="mt-2 text-[13px] font-bold text-mist">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-[13px] font-bold text-mist">Nobody has redone an old homework task in the last {days} days.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map((r, i) => (
            <li key={r.student_id} className="flex flex-wrap items-center gap-3 rounded-[12px] bg-panel px-3 py-1.5 text-sm">
              <span className="w-6 text-[12px] font-extrabold text-mist">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-extrabold text-paper">{r.full_name}</span>
              <span className="text-[12px] font-bold text-paper-dim">{r.repeats} {r.repeats === 1 ? 'try' : 'tries'} · {r.tasks} {r.tasks === 1 ? 'task' : 'tasks'}</span>
              {r.improved > 0 && <span className="rounded-lg bg-reading-tint px-2 py-0.5 text-[12px] font-extrabold text-reading">{r.improved} improved</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
