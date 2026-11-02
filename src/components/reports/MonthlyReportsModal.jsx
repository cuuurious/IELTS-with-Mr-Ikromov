import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../lib/supabaseClient'
import { lastMonths, monthLabel, pctTone, summarise } from './monthReport'

/*
 * Teacher: monthly reports for one group (2026-11-02, migration_91).
 * Pick a month; every student gets a row with the month's numbers, a note
 * for the parents (saved by itself), and buttons to open the parent page,
 * share it on Telegram or copy a ready message.
 */
export default function MonthlyReportsModal({ groupId, groupName, onClose }) {
  const months = lastMonths(6)
  const [month, setMonth] = useState(months[0])
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError('')
    supabase.rpc('group_month_report', { p_group_id: groupId, p_month: month }).then(({ data, error: err }) => {
      if (cancelled) return
      if (err) {
        setError(/group_month_report/.test(err.message) ? 'Run migration_91 first.' : err.message)
        setRows([])
      } else setRows(data || [])
    })
    return () => {
      cancelled = true
    }
  }, [groupId, month])

  const sums = (rows || []).map((r) => summarise(r.report))
  const avg = (key) => {
    const v = sums.map((s) => s[key]).filter((x) => x != null)
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/60 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[28px] bg-ink sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Monthly reports">
        <div className="registan-band flex items-center gap-3 px-5 py-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Monthly reports · {groupName}</p>
            <p className="font-brand text-[20px] font-semibold text-white">{monthLabel(month)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 place-items-center rounded-[14px] bg-white/15 hover:bg-white/25">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-4 sm:p-5">
          <div className="flex flex-wrap gap-1.5">
            {months.map((m) => (
              <button key={m} type="button" onClick={() => setMonth(m)} className={`focus-ring h-9 rounded-[12px] px-3 text-[13px] font-extrabold ${m === month ? 'bg-brass text-onbrass' : 'bg-panel text-paper-dim hover:text-paper'}`}>
                {monthLabel(m).split(' ')[0]}
              </button>
            ))}
          </div>

          {rows && rows.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5">
              {[
                ['Came to lessons', avg('attendancePct')],
                ['Homework done', avg('hwPct')],
                ['Average score', avg('avgPct')],
              ].map(([label, v]) => (
                <div key={label} className="rounded-[16px] border border-line bg-panel px-4 py-3">
                  <p className="text-[12px] font-extrabold text-mist">{label}</p>
                  <p className={`font-brand text-[24px] font-semibold ${pctTone(v)}`}>{v != null ? `${v}%` : '—'}</p>
                </div>
              ))}
            </div>
          )}

          {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
          {rows === null && <p className="text-sm font-semibold text-mist">Loading…</p>}
          {rows?.length === 0 && !error && <p className="text-sm font-semibold text-mist">No students in this group.</p>}

          <ul className="flex flex-col gap-2.5">
            {(rows || []).map((r, i) => (
              <StudentRow key={r.student_id} row={r} s={sums[i]} month={month} />
            ))}
          </ul>
        </div>
      </div>
    </div>,
    document.body
  )
}

function StudentRow({ row, s, month }) {
  const [note, setNote] = useState(row.report?.note || '')
  const [saved, setSaved] = useState('')
  const [copied, setCopied] = useState(false)
  const url = row.token ? `${window.location.origin}/report/${row.token}?month=${month.slice(0, 7)}` : ''
  const first = row.full_name.split(' ')[0]
  const message = `Assalomu alaykum! ${first}ning ${monthLabel(month, 'uz')} oyi bo‘yicha hisoboti (darslar, uy vazifalari, natijalar): ${url}`

  const saveNote = async () => {
    if ((row.report?.note || '') === note) return
    const { error } = await supabase.from('parent_month_notes').upsert({ student_id: row.student_id, month, note, updated_at: new Date().toISOString() }, { onConflict: 'student_id,month' })
    setSaved(error ? 'Not saved' : 'Saved')
    if (!error) row.report = { ...row.report, note }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked */
    }
  }

  const chip = (label, value, tone) => (
    <span className="rounded-xl bg-panel-2/70 px-2.5 py-1 text-[12px] font-extrabold text-paper-dim">
      {label} <span className={tone}>{value}</span>
    </span>
  )

  return (
    <li className="flex flex-col gap-3 rounded-[20px] border border-line bg-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-panel-2 text-[13px] font-extrabold text-paper-dim">{row.full_name.slice(0, 1)}</span>
        <span className="mr-auto min-w-0 truncate text-[15px] font-extrabold text-paper">{row.full_name}</span>
        {chip('Lessons', s.marked ? `${s.came}/${s.marked}` : '—', pctTone(s.attendancePct))}
        {chip('Homework', s.hwAssigned ? `${s.hwDone}/${s.hwAssigned}` : '—', pctTone(s.hwPct))}
        {chip('Score', s.avgPct != null ? `${s.avgPct}%` : '—', pctTone(s.avgPct))}
        {chip('Coins', s.coins, 'text-amber')}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            setSaved('')
          }}
          onBlur={saveNote}
          rows={2}
          placeholder="A note for the parents (optional) — shown on the report"
          className="focus-ring min-h-[3rem] flex-1 rounded-[14px] border border-line bg-panel-2/50 px-3 py-2 text-sm text-paper"
        />
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {url ? (
            <>
              <a href={url} target="_blank" rel="noreferrer" className="focus-ring grid h-9 place-items-center rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-paper hover:border-brass">
                Open
              </a>
              <a href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message.replace(`: ${url}`, ''))}`} target="_blank" rel="noreferrer" className="focus-ring grid h-9 place-items-center rounded-[12px] bg-[#2AABEE] px-3 text-[13px] font-extrabold text-white">
                Telegram
              </a>
              <button type="button" onClick={copy} className="focus-ring h-9 rounded-[12px] border border-line px-3 text-[13px] font-extrabold text-paper hover:border-brass">
                {copied ? 'Copied ✓' : 'Copy message'}
              </button>
            </>
          ) : (
            <span className="text-[12px] font-bold text-mist">No report link</span>
          )}
        </div>
      </div>
      {(saved || row.link_enabled === false) && (
        <p className="text-[12px] font-bold text-mist">
          {saved}
          {row.link_enabled === false ? ' · This student’s report link is turned off (Students → details).' : ''}
        </p>
      )}
    </li>
  )
}
