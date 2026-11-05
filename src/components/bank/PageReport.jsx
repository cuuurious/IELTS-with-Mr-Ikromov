import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { loadPageReport, shortTitle } from '../../lib/pageBank'
import { gradeTone } from '../../lib/homeworkTasks'
import { skillShade, splitSet } from './BookCover'

/*
 * One page's report (2026-11-05): every student's first try (homework or
 * the practice shelf), the class average, and the questions most of them
 * got wrong — what to go over in class. Question-by-question results are
 * saved from 5 Nov 2026 on, so older tries show only the score.
 */
export default function PageReport({ page, onClose }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadPageReport(page.url)
      .then(setRows)
      .catch((e) => {
        setError(/page_report/.test(e.message || '') ? 'Run migration_97 to see page reports.' : e.message)
        setRows([])
      })
  }, [page.url])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const summary = useMemo(() => {
    const list = rows || []
    const scored = list.filter((r) => r.max_score > 0)
    const avg = scored.length ? Math.round(scored.reduce((n, r) => n + (100 * r.score) / r.max_score, 0) / scored.length) : null
    const qmap = {}
    list.forEach((r) => {
      ;(Array.isArray(r.qs) ? r.qs : []).forEach((q) => {
        qmap[q.n] = qmap[q.n] || { n: q.n, wrong: 0, total: 0, who: [] }
        qmap[q.n].total += 1
        if (!q.ok) {
          qmap[q.n].wrong += 1
          qmap[q.n].who.push(r.full_name)
        }
      })
    })
    const questions = Object.values(qmap).sort((a, b) => b.wrong / b.total - a.wrong / a.total || a.n - b.n)
    return { avg, scored: scored.length, questions }
  }, [rows])

  const shade = skillShade(page.skill || 'reading', 0)
  const tone = gradeTone(summary.avg)

  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center bg-ink/80 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-ink shadow-2xl sm:rounded-[28px]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Page report">
        <div className="flex shrink-0 items-center gap-3 px-5 py-4 text-white" style={{ backgroundColor: shade }}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-extrabold uppercase tracking-[0.14em] text-white/75">Report · {splitSet(page.collection || '').subtitle}</p>
            <p className="truncate font-brand text-[19px] font-semibold text-white">{shortTitle(page.title)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white/15 hover:bg-white/25">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
          {error && <p className="rounded-[14px] bg-urgent-tint px-4 py-3 text-sm font-bold text-coral">{error}</p>}
          {rows === null ? (
            <p className="text-sm font-semibold text-mist">Loading…</p>
          ) : rows.length === 0 ? (
            !error && <p className="text-sm font-semibold text-mist">No one has done this page yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-[16px] bg-panel px-4 py-3">
                  <p className={`font-brand text-[24px] font-semibold leading-none ${summary.avg == null ? 'text-mist' : tone.text}`}>{summary.avg == null ? '—' : `${summary.avg}%`}</p>
                  <p className="mt-1 text-[12px] font-bold text-mist">average first try</p>
                </div>
                <div className="rounded-[16px] bg-panel px-4 py-3">
                  <p className="font-brand text-[24px] font-semibold leading-none text-paper">{rows.length}</p>
                  <p className="mt-1 text-[12px] font-bold text-mist">students did it</p>
                </div>
                <div className="rounded-[16px] bg-panel px-4 py-3">
                  <p className="font-brand text-[24px] font-semibold leading-none text-coral">{summary.questions.filter((q) => q.wrong / q.total >= 0.5).length}</p>
                  <p className="mt-1 text-[12px] font-bold text-mist">questions half got wrong</p>
                </div>
              </div>

              <section className="flex flex-col gap-2">
                <h3 className="font-brand text-[16px] font-semibold text-paper">Go over these in class</h3>
                {summary.questions.length === 0 ? (
                  <p className="rounded-[14px] bg-panel px-4 py-3 text-sm font-semibold text-mist">Question-by-question results are saved for tries from today on.</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {summary.questions.slice(0, 12).map((q) => {
                      const pct = Math.round((100 * q.wrong) / q.total)
                      return (
                        <li key={q.n} className="flex items-center gap-3 rounded-[14px] bg-panel px-3 py-2">
                          <span className="grid h-8 w-10 shrink-0 place-items-center rounded-lg bg-panel-2 text-[13px] font-extrabold text-paper">Q{q.n}</span>
                          <div className="min-w-0 flex-1">
                            <div className="h-2 overflow-hidden rounded-md bg-panel-2">
                              <div className={`h-full rounded-md ${pct >= 50 ? 'bg-coral' : pct >= 25 ? 'bg-saffron' : 'bg-reading'}`} style={{ width: `${pct}%` }} />
                            </div>
                            {q.who.length > 0 && <p className="mt-1 truncate text-[11px] font-semibold text-mist">{q.who.slice(0, 5).join(', ')}{q.who.length > 5 ? ` +${q.who.length - 5}` : ''}</p>}
                          </div>
                          <span className="w-24 shrink-0 text-right text-[12px] font-extrabold text-paper-dim">{q.wrong} of {q.total} wrong</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="font-brand text-[16px] font-semibold text-paper">Students</h3>
                <ul className="flex flex-col gap-1.5">
                  {rows
                    .slice()
                    .sort((a, b) => b.score / (b.max_score || 1) - a.score / (a.max_score || 1))
                    .map((r, i) => {
                      const pct = r.max_score ? Math.round((100 * r.score) / r.max_score) : null
                      const t = gradeTone(pct)
                      return (
                        <li key={`${r.user_id}-${r.source}-${i}`} className="flex items-center gap-3 rounded-[14px] bg-panel px-3 py-2">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-panel-2 text-xs font-extrabold text-paper-dim">{r.full_name?.charAt(0)?.toUpperCase() || '?'}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-extrabold text-paper">{r.full_name}</span>
                            <span className="block truncate text-[11px] font-semibold text-mist">
                              {r.source === 'shelf' ? 'Practice shelf' : `Homework${r.group_name ? ` · ${r.group_name}` : ''}`} · {new Date(r.done_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                            </span>
                          </span>
                          <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-extrabold ${t.bg} ${t.text}`}>{r.max_score ? `${r.score}/${r.max_score}` : 'Done'}</span>
                        </li>
                      )
                    })}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
