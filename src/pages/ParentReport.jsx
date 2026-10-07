import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { downloadParentReport } from '../lib/generateParentReport'

/*
 * PARENT PROGRESS REPORT (2026-10-02) — /report/<secret link>
 *
 * A read-only page Jasur can send to a parent. No login: the long random
 * token in the link is the key (parent_report_links, migration_69). The
 * teacher can turn a link off at any time from the student's details,
 * after which this page just says the link is no longer active.
 *
 * Data comes from get_parent_report(token) — only a summary: homework
 * done / late / missed, vocabulary practice and the latest released mock
 * bands. No messages, essays or other students.
 *
 * 2026-10-07 (migration_76): the WHOLE homework history since the
 * student joined — a month-by-month bar strip, then every homework
 * grouped by month (newest months open, older ones behind "Show earlier
 * months"). Works with the older 60-day data too (no months/since).
 */

const STATE_LABEL = {
  done: { text: 'Done', cls: 'bg-reading-tint text-reading' },
  late: { text: 'Done late', cls: 'bg-vocab-tint text-vocab' },
  missed: { text: 'Not done', cls: 'bg-urgent-tint text-urgent' },
  open: { text: 'In progress', cls: 'bg-panel-2 text-mist' },
}

const monthKey = (value) => {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthLabel = (key, style = 'long') => {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' })
}

// Per-month bars: done (green), late (amber), not done (red), open (grey).
function MonthStrip({ months }) {
  if (!months.length) return null
  return (
    <div className="rounded-[22px] border border-line bg-panel p-4">
      <p className="mb-3 text-sm font-semibold text-paper">Month by month</p>
      <div className="flex items-end gap-2 overflow-x-auto pb-1">
        {months.map((m) => {
          const total = m.assigned || 0
          const handed = (m.done || 0) + (m.late || 0)
          const seg = (n) => (total ? `${(n / total) * 100}%` : '0%')
          return (
            <div key={m.key} className="flex w-14 shrink-0 flex-col items-center gap-1.5" title={`${monthLabel(m.key)}: ${handed} of ${total} done`}>
              <span className="text-xs font-semibold tabular-nums text-paper">
                {total ? Math.round((handed / total) * 100) : 0}%
              </span>
              <div className="flex h-24 w-7 flex-col-reverse overflow-hidden rounded-lg bg-panel-2">
                <span className="w-full bg-reading" style={{ height: seg(m.done || 0) }} />
                <span className="w-full bg-[#E8B64C]" style={{ height: seg(m.late || 0) }} />
                <span className="w-full bg-urgent" style={{ height: seg(m.missed || 0) }} />
                <span className="w-full bg-line" style={{ height: seg(m.open || 0) }} />
              </div>
              <span className="text-[11px] text-mist">{monthLabel(m.key, 'short')}</span>
              <span className="text-[10px] tabular-nums text-mist">
                {handed}/{total}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mist">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-reading" />On time</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#E8B64C]" />Late</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-urgent" />Not done</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-line" />Still open</span>
      </div>
    </div>
  )
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Stat({ label, value, hint, tone = '' }) {
  return (
    <div className={`rounded-2xl border border-line p-4 ${tone || 'bg-panel'}`}>
      <p className="text-xs text-mist">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums text-paper">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-mist">{hint}</p>}
    </div>
  )
}

export default function ParentReport() {
  const { token } = useParams()
  const [state, setState] = useState('loading') // loading | ok | off | error
  const [report, setReport] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfError, setPdfError] = useState('')
  const [showAllMonths, setShowAllMonths] = useState(false)

  const downloadPdf = async () => {
    setPdfBusy(true)
    setPdfError('')
    try {
      await downloadParentReport(report)
    } catch (err) {
      console.error('Parent report PDF failed:', err)
      setPdfError('Could not make the PDF — please check the internet connection and try again.')
    } finally {
      setPdfBusy(false)
    }
  }

  useEffect(() => {
    document.title = 'Progress report — IELTS with Mr Ikromov'
    const valid = /^[0-9a-f-]{36}$/i.test(token || '')
    if (!valid) {
      setState('off')
      return
    }
    supabase
      .rpc('get_parent_report', { p_token: token })
      .then(({ data, error }) => {
        if (error) {
          setState('error')
          return
        }
        if (!data) {
          setState('off')
          return
        }
        setReport(data)
        setState('ok')
        supabase.rpc('touch_parent_report', { p_token: token }).then(() => {}, () => {})
      })
      .catch(() => setState('error'))
  }, [token])

  const shell = (children) => (
    <div className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
        <div className="flex items-center gap-2">
          <img src="/mrikromov.jpg" alt="" className="h-8 w-8 rounded-lg object-cover" />
          <p className="text-sm font-semibold text-paper">IELTS with Mr Ikromov</p>
        </div>
        {children}
      </div>
    </div>
  )

  if (state === 'loading') return shell(<p className="text-sm text-mist">Loading the report…</p>)
  if (state === 'off') {
    return shell(
      <div className="rounded-[22px] border border-line bg-panel p-6">
        <h1 className="text-2xl font-semibold">This link is no longer active</h1>
        <p className="mt-2 text-sm text-mist">Please ask the teacher for a new progress report link.</p>
      </div>
    )
  }
  if (state === 'error') {
    return shell(
      <div className="rounded-[22px] border border-line bg-panel p-6">
        <h1 className="text-2xl font-semibold">Couldn&apos;t load the report</h1>
        <p className="mt-2 text-sm text-mist">Please check the internet connection and try again.</p>
        <button type="button" onClick={() => window.location.reload()} className="focus-ring mt-4 rounded-full border border-line px-4 py-2 text-sm">
          Try again
        </button>
      </div>
    )
  }

  const { student = {}, groups = [], homework = {}, words = {}, mocks = {} } = report
  const assigned = homework.assigned || 0
  const done = homework.done || 0
  const rate = assigned ? Math.round((done / assigned) * 100) : null
  const history = homework.recent || []
  const historyByMonth = []
  for (const hw of history) {
    const key = monthKey(hw.due_date || hw.created_at)
    let g = historyByMonth[historyByMonth.length - 1]
    if (!g || g.key !== key) {
      g = { key, items: [], handed: 0 }
      historyByMonth.push(g)
    }
    g.items.push(hw)
    if (hw.state === 'done' || hw.state === 'late') g.handed += 1
  }
  // Month strip: from the server (migration_76) or worked out here.
  const months = (homework.months && homework.months.length
    ? homework.months.map((m) => ({ ...m, key: m.month.slice(0, 7) }))
    : [...historyByMonth].reverse().map((g) => ({
        key: g.key,
        assigned: g.items.length,
        done: g.items.filter((x) => x.state === 'done').length,
        late: g.items.filter((x) => x.state === 'late').length,
        missed: g.items.filter((x) => x.state === 'missed').length,
        open: g.items.filter((x) => x.state === 'open').length,
      }))
  ).slice(-12)
  const mockEntries = [
    ['Listening', mocks.listening],
    ['Reading', mocks.reading],
    ['Writing', mocks.writing],
    ['Speaking', mocks.speaking],
  ].filter(([, band]) => band !== null && band !== undefined)

  return shell(
    <>
      <header className="flex flex-wrap items-center gap-4">
        {student.avatar_url ? (
          <img src={student.avatar_url} alt="" className="h-14 w-14 rounded-full border border-line object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-panel font-display text-xl">
            {(student.full_name || '?').trim().charAt(0)}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold sm:text-3xl">{(student.full_name || 'Student').trim()}</h1>
          <p className="text-sm text-mist">
            Progress report · {groups.length ? `Group ${groups.join(', ')} · ` : ''}
            {student.target_band ? `Target band ${student.target_band}` : 'IELTS preparation'}
          </p>
        </div>
        <button
          type="button"
          onClick={downloadPdf}
          disabled={pdfBusy}
          className="focus-ring ml-auto inline-flex items-center gap-2 rounded-full bg-brass hover:bg-brass-dim px-4 py-2 text-sm font-semibold text-onbrass disabled:opacity-60"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          {pdfBusy ? 'Making PDF…' : 'Download PDF'}
        </button>
      </header>
      {pdfError && <p className="-mt-3 text-sm text-coral">{pdfError}</p>}

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-xl font-semibold">Homework</h2>
          <p className="text-sm text-mist">
            {homework.since
              ? `Everything since joining the group in ${new Date(homework.since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
              : 'Recent homework'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Completed" value={rate === null ? '—' : `${rate}%`} hint={`${done} of ${assigned}`} tone="bg-reading-tint" />
          <Stat label="On time" value={Math.max(done - (homework.late || 0), 0)} />
          <Stat label="Late" value={homework.late || 0} />
          <Stat label="Not done" value={homework.missed || 0} hint="past the deadline" />
        </div>

        <MonthStrip months={months} />

        {historyByMonth.length > 0 && (
          <div className="flex flex-col gap-4">
            {(showAllMonths ? historyByMonth : historyByMonth.slice(0, 2)).map((group) => (
              <div key={group.key}>
                <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                  <p className="text-sm font-semibold text-paper">{monthLabel(group.key)}</p>
                  <p className="text-xs text-mist">
                    {group.handed} of {group.items.length} done
                  </p>
                </div>
                <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[22px] border border-line bg-panel">
                  {group.items.map((hw, i) => {
                    const label = STATE_LABEL[hw.state] || STATE_LABEL.open
                    return (
                      <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-paper">{(hw.title || 'Homework').trim()}</p>
                          <p className="text-xs text-mist">
                            Set {formatDate(hw.created_at)}
                            {hw.due_date ? ` · due ${formatDate(hw.due_date)}` : ''}
                            {hw.done_at && (hw.state === 'done' || hw.state === 'late') ? ` · handed in ${formatDate(hw.done_at)}` : ''}
                          </p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${label.cls}`}>{label.text}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
            {historyByMonth.length > 2 && (
              <button
                type="button"
                onClick={() => setShowAllMonths((v) => !v)}
                className="focus-ring self-center rounded-full border border-line bg-panel px-4 py-2 text-sm font-medium text-paper hover:bg-panel-2"
              >
                {showAllMonths ? 'Show fewer months' : `Show earlier months (${historyByMonth.length - 2})`}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Vocabulary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Words learned" value={words.words_learned || 0} hint={`of ${words.words_practised || 0} practised`} tone="bg-vocab-tint" />
          <Stat label="Quizzes (30 days)" value={(words.quizzes_30d || 0) + (words.reviews_30d || 0)} />
          <Stat label="Average score" value={words.avg_score_30d != null ? `${words.avg_score_30d}%` : '—'} hint="last 30 days" />
        </div>
      </section>

      {mockEntries.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Latest mock exam results</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {mockEntries.map(([label, band]) => (
              <Stat key={label} label={label} value={Number(band).toFixed(1)} hint="band" />
            ))}
          </div>
        </section>
      )}

      <p className="text-xs text-mist">
        Updated {new Date(report.generated_at || Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
        Questions? Contact the teacher directly.
      </p>
    </>
  )
}
