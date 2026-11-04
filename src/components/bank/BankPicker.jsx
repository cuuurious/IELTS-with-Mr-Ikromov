import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { BANK_SKILLS, loadBank, shortTitle } from '../../lib/pageBank'
import { qtypeLabel } from '../../lib/questionTypes'

/*
 * Pick Practice Bank pages for a homework or a course lesson (2026-11-02).
 * Skill tabs → books/sets → tick pages. onPick(pages) with the chosen rows.
 * onLibrary (optional) switches to the Materials Library picker.
 */
export default function BankPicker({ open, onClose, onPick, onLibrary, initialSkill = 'reading' }) {
  const [pages, setPages] = useState(null)
  const [missing, setMissing] = useState(false)
  const [skill, setSkill] = useState('reading')
  const [collection, setCollection] = useState(null)
  const [picked, setPicked] = useState(() => new Set())

  useEffect(() => {
    if (!open) return
    setPicked(new Set())
    setSkill(initialSkill)
    setCollection(null)
    loadBank().then((r) => {
      setPages(r.pages)
      setMissing(r.missing)
    })
  }, [open, initialSkill])

  const collections = useMemo(() => {
    const map = {}
    ;(pages || []).filter((p) => (p.skill || 'reading') === skill).forEach((p) => {
      map[p.collection] = (map[p.collection] || 0) + 1
    })
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
  }, [pages, skill])

  // Only tabs that have pages (plus the one open now), with counts.
  const counts = {}
  ;(pages || []).forEach((p) => {
    const k = p.skill || 'reading'
    counts[k] = (counts[k] || 0) + 1
  })
  const tabs = BANK_SKILLS.filter((s) => pages === null || counts[s.value] || s.value === skill)

  if (!open) return null
  const list = (pages || []).filter((p) => p.collection === collection)
  const toggle = (id) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-ink/60 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-ink sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Practice Bank">
        <div className="registan-band flex items-center gap-3 px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Practice Bank</p>
            <p className="font-brand text-[19px] font-semibold text-white">{collection || 'Choose pages'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 place-items-center rounded-[14px] bg-white/15 hover:bg-white/25">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
          {missing ? (
            <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">Run migration_92_practice_bank.sql first.</p>
          ) : collection ? (
            <>
              <button type="button" onClick={() => setCollection(null)} className="focus-ring self-start text-[13px] font-extrabold text-brass">← All {BANK_SKILLS.find((x) => x.value === skill)?.label}</button>
              <ul className="flex flex-col gap-1.5">
                {list.map((p) => (
                  <li key={p.id}>
                    <label className={`flex cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2 ${picked.has(p.id) ? 'bg-brass/15 ring-1 ring-brass' : 'bg-panel'}`}>
                      <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} className="h-4 w-4 accent-brass" />
                      <span className="w-8 shrink-0 text-[13px] font-extrabold text-mist">{p.position ?? ''}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-paper">{shortTitle(p.title)}</span>
                      {p.question_type && <span className="hidden shrink-0 rounded-lg bg-panel-2 px-2 py-0.5 text-[11px] font-extrabold text-paper-dim sm:inline">{qtypeLabel(p.question_type)}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {tabs.map((s) => (
                  <button key={s.value} type="button" onClick={() => setSkill(s.value)} className={`focus-ring flex h-9 items-center gap-1.5 rounded-[12px] px-3 text-[13px] font-extrabold ${s.value === skill ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim'}`}>
                    {s.label}
                    {counts[s.value] > 0 && <span className={`text-[11px] ${s.value === skill ? 'text-onbrass/75' : 'text-mist'}`}>{counts[s.value]}</span>}
                  </button>
                ))}
              </div>
              {pages === null && <p className="text-sm font-semibold text-mist">Loading…</p>}
              {pages && collections.length === 0 && <p className="rounded-[14px] bg-panel px-4 py-6 text-center text-sm font-semibold text-mist">No {BANK_SKILLS.find((x) => x.value === skill)?.label.toLowerCase()} pages yet. Add them in Practice Bank.</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                {collections.map(([name, n]) => (
                  <button key={name} type="button" onClick={() => setCollection(name)} className="focus-ring flex flex-col items-start rounded-[16px] bg-panel px-4 py-3 text-left hover:bg-panel-2">
                    <span className="text-[15px] font-extrabold text-paper">{name}</span>
                    <span className="text-[12px] font-bold text-mist">{n} pages</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {onLibrary && (
            <button type="button" onClick={onLibrary} className="focus-ring mr-auto text-[13px] font-extrabold text-mist hover:text-paper">
              From the Library instead
            </button>
          )}
          <button
            type="button"
            disabled={!picked.size}
            onClick={() => onPick((pages || []).filter((p) => picked.has(p.id)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0)))}
            className="focus-ring ml-auto h-10 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a] disabled:opacity-50"
          >
            Add {picked.size || ''} page{picked.size === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
