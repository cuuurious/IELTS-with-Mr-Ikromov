import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

/*
 * COMMON MISTAKES (2026-11-05, migration_108). The corrections the AI made
 * in a group's writing and speaking, grouped by the reason, most students
 * first — the grammar to teach in the next lesson. `big` is the class
 * screen version (large text for the board).
 */
export function useCommonMistakes(groupId, days = 14) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!groupId) return undefined
    let cancelled = false
    setRows(null)
    setError('')
    supabase.rpc('group_common_mistakes', { p_group_id: groupId, p_days: days }).then(({ data, error: e }) => {
      if (cancelled) return
      if (e) {
        setError(/group_common_mistakes/.test(e.message) ? 'Run migration_108 first.' : e.message)
        setRows([])
      } else setRows(data || [])
    })
    return () => {
      cancelled = true
    }
  }, [groupId, days])
  return { rows, error }
}

export default function CommonMistakes({ groupId, days = 14, big = false }) {
  const { rows, error } = useCommonMistakes(groupId, days)
  if (error) return <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>
  if (rows === null) return <p className="text-sm font-semibold text-mist">Loading…</p>
  if (!rows.length) {
    return <p className="rounded-[20px] border border-line bg-panel p-6 text-center text-sm font-bold text-paper-dim">No AI-marked writing or speaking from this group in the last {days} days yet.</p>
  }
  return (
    <ol className={`grid grid-cols-1 gap-3 ${big ? 'xl:grid-cols-2' : 'lg:grid-cols-2'}`}>
      {rows.map((r, i) => (
        <li key={i} className={`flex min-w-0 flex-col gap-2 rounded-[20px] border border-line bg-panel ${big ? 'p-5' : 'p-4'}`}>
          <div className="flex items-start gap-3">
            <span className={`grid shrink-0 place-items-center rounded-[12px] bg-writing-tint font-brand font-semibold text-writing ${big ? 'h-12 min-w-12 px-2 text-[20px]' : 'h-9 min-w-9 px-1.5 text-[15px]'}`}>{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className={`font-extrabold leading-snug text-paper ${big ? 'text-[22px]' : 'text-[15px]'}`}>{r.why || 'Other'}</p>
              {!big && (
                <p className="text-[12px] font-bold text-mist">
                  {r.students} student{r.students === 1 ? '' : 's'} · {r.total} time{r.total === 1 ? '' : 's'} · {r.kind}
                </p>
              )}
            </div>
          </div>
          {(r.examples || []).map((x, k) => (
            <div key={k} className={`rounded-[14px] bg-panel-2/70 ${big ? 'px-4 py-3' : 'px-3 py-2'}`}>
              <p className={`text-mist line-through decoration-coral/60 ${big ? 'text-[19px]' : 'text-[13px]'}`}>{x.original}</p>
              <p className={`font-extrabold text-paper ${big ? 'text-[21px]' : 'text-[14px]'}`}>{x.better}</p>
            </div>
          ))}
        </li>
      ))}
    </ol>
  )
}
