import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { loadBank, loadGivenPages } from '../../lib/pageBank'
import { qtypeLabel } from '../../lib/questionTypes'
import AssignPagesModal from '../bank/AssignPagesModal'

/*
 * Group page → Homework tab (2026-11-05): "Weak at True/False/Not Given
 * (45%) → Give 3 new pages". Takes the group's weakest question types
 * (at least 5 answers, under 70%) and offers pages of that type from the
 * Practice Bank that this group has not been given yet. One tap opens
 * the usual "Give as homework" window with this group already ticked.
 */
const MIN_ANSWERS = 5
const HOW_MANY = 3

export default function WeakSpotSuggest({ groupId, onPosted }) {
  const [rows, setRows] = useState(null)
  const [assign, setAssign] = useState(null) // { pages, title }
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([supabase.rpc('group_weak_spots', { p_group_id: groupId }), loadBank(), loadGivenPages()]).then(([w, bank, given]) => {
      if (cancelled) return
      const weak = (w.data || [])
        .filter((r) => r.total >= MIN_ANSWERS)
        .map((r) => ({ ...r, pct: Math.round((100 * r.correct) / r.total) }))
        .filter((r) => r.pct < 70)
        .sort((a, b) => a.pct - b.pct)
      const out = []
      weak.forEach((r) => {
        if (out.length >= 3) return
        const fresh = (bank.pages || [])
          .filter((p) => p.question_type === r.qtype && !given[p.url]?.has(groupId))
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        if (fresh.length) out.push({ ...r, fresh })
      })
      setRows(out)
    })
    return () => {
      cancelled = true
    }
  }, [groupId, reload])

  if (!rows || rows.length === 0) return null

  return (
    <section className="flex flex-col gap-2 rounded-[20px] border border-line bg-panel p-4 sm:flex-row sm:items-center sm:gap-4">
      <div className="shrink-0">
        <p className="font-brand text-[15px] font-semibold text-paper">Practise the weak spots</p>
        <p className="text-xs font-semibold text-mist">New pages this group hasn’t done</p>
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-2">
        {rows.map((r) => {
          const pages = r.fresh.slice(0, HOW_MANY)
          return (
            <button
              key={r.qtype}
              type="button"
              onClick={() => setAssign({ pages, title: `${qtypeLabel(r.qtype)} practice` })}
              className="focus-ring flex items-center gap-2.5 rounded-[14px] bg-panel-2 px-3 py-2 text-left transition hover:ring-1 hover:ring-brass/50"
            >
              <span className={`rounded-lg px-1.5 py-0.5 text-[12px] font-extrabold ${r.pct < 50 ? 'bg-urgent-tint text-coral' : 'bg-[color-mix(in_srgb,var(--color-saffron)_20%,var(--color-panel))] text-amber'}`}>{r.pct}%</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-extrabold text-paper">{qtypeLabel(r.qtype)}</span>
                <span className="block text-[11px] font-extrabold text-brass">Give {pages.length} new page{pages.length === 1 ? '' : 's'} →</span>
              </span>
            </button>
          )
        })}
      </div>
      {assign && (
        <AssignPagesModal
          pages={assign.pages}
          initialGroups={[groupId]}
          initialTitle={assign.title}
          onClose={() => setAssign(null)}
          onDone={() => {
            setReload((n) => n + 1)
            onPosted?.()
          }}
        />
      )}
    </section>
  )
}
