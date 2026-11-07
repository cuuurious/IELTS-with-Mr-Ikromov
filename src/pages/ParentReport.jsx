import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { downloadParentReport } from '../lib/generateParentReport'
import { MonthReportCard, monthLabel as reportMonthLabel } from '../components/reports/monthReport'

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
    <div className="rounded-[20px] border border-line bg-panel p-4">
      <p className="mb-3 text-[14px] font-extrabold text-paper">Month by month</p>
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

// "This month" (2026-11-02, migration_91): attendance, homework, scores,
// coins and a note from the teacher for one month. ?month=2026-10 picks
// the month (the teacher's share link carries it).
function MonthSection({ token }) {
  const [data, setData] = useState(undefined)
  const [month, setMonth] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('month')
    return /^\d{4}-\d{2}$/.test(q || '') ? `${q}-01` : null
  })

  useEffect(() => {
    let cancelled = false
    supabase.rpc('get_parent_month_report', { p_token: token, p_month: month }).then(({ data: d, error }) => {
      if (!cancelled) setData(error ? null : d)
    })
    return () => {
      cancelled = true
    }
  }, [token, month])

  if (!data) return null
  const months = data.months || []
  return (
    <section className="flex flex-col gap-3 rounded-[24px] border border-line bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-brand text-[19px] font-semibold">{reportMonthLabel(data.month)}</h2>
        {months.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {months.slice(0, 6).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonth(m)}
                className={`focus-ring h-9 rounded-xl px-3 text-[12px] font-extrabold ${m === data.month ? 'bg-brass text-white' : 'bg-panel-2 text-paper-dim hover:text-paper'}`}
              >
                {reportMonthLabel(m).split(' ')[0].slice(0, 3)}
              </button>
            ))}
          </div>
        )}
      </div>
      <MonthReportCard r={data} />
    </section>
  )
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Stat({ label, value, hint, tone = '' }) {
  return (
    <div className={`rounded-[20px] border border-line p-4 ${tone || 'bg-panel'}`}>
      <p className="text-[12px] font-extrabold text-mist">{label}</p>
      <p className="mt-1 font-brand text-[28px] font-semibold tabular-nums leading-tight text-paper">{value}</p>
      {hint && <p className="mt-0.5 text-[12px] font-semibold text-mist">{hint}</p>}
    </div>
  )
}

function SectionTitle({ children, sub }) {
  return (
    <div>
      <h2 className="font-brand text-[19px] font-semibold text-paper">{children}</h2>
      {sub && <p className="text-[13px] font-semibold text-mist">{sub}</p>}
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

  // 2026-11-07: same look as the rest of the site — lapis band on top,
  // Unbounded headings, rounded cards, one saffron button.
  const shell = (children, band = null) => (
    <div className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <div className="registan-band rounded-[28px] px-5 py-6 sm:px-8 sm:py-8">
          <div className="flex items-center gap-2.5">
            <img src="/mrikromov.jpg" alt="" className="h-9 w-9 rounded-xl object-cover ring-2 ring-white/30" />
            <p className="text-[14px] font-extrabold text-white/90">IELTS with Mr Ikromov</p>
          </div>
          {band}
        </div>
        {children}
      </div>
    </div>
  )

  if (state === 'loading') return shell(<p className="text-sm text-mist">Loading the report…</p>)
  if (state === 'off') {
    return shell(
      <div className="rounded-[20px] border border-line bg-panel p-6">
        <h1 className="font-brand text-[22px] font-semibold">This link is no longer active</h1>
        <p className="mt-2 text-sm text-mist">Please ask the teacher for a new progress report link.</p>
      </div>
    )
  }
  if (state === 'error') {
    return shell(
      <div className="rounded-[20px] border border-line bg-panel p-6">
        <h1 className="font-brand text-[22px] font-semibold">Couldn&apos;t load the report</h1>
        <p className="mt-2 text-sm text-mist">Please check the internet connection and try again.</p>
        <button type="button" onClick={() => window.location.reload()} className="focus-ring mt-4 h-11 rounded-[14px] bg-saffron px-5 text-sm font-extrabold text-[#17213a]">
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

  const band = (
    <div className="mt-5 flex flex-wrap items-center gap-4">
      {student.avatar_url ? (
        <img src={student.avatar_url} alt="" className="h-16 w-16 rounded-[18px] object-cover ring-2 ring-white/30" />
      ) : (
        <div className="grid h-16 w-16 place-items-center rounded-[18px] bg-white/15 font-brand text-2xl font-semibold text-white">
          {(student.full_name || '?').trim().charAt(0)}
        </div>
      )}
      <div className="min-w-[180px] flex-1">
        <h1 className="font-brand text-[24px] font-semibold leading-tight text-white sm:text-[30px]">{(student.full_name || 'Student').trim()}</h1>
        <p className="mt-1 text-[14px] font-bold text-white/80">
          Progress report · {groups.length ? `Group ${groups.join(', ')} · ` : ''}
          {student.target_band ? `Target band ${student.target_band}` : 'IELTS preparation'}
        </p>
      </div>
      <button
        type="button"
        onClick={downloadPdf}
        disabled={pdfBusy}
        className="focus-ring inline-flex h-11 w-full items-center justify-center gap-2 rounded-[14px] bg-saffron px-5 sm:w-auto text-sm font-extrabold text-[#17213a] hover:brightness-95 disabled:opacity-60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        {pdfBusy ? 'Making PDF…' : 'Download PDF'}
      </button>
    </div>
  )

  return shell(
    <>
      {pdfError && <p className="-mt-3 text-sm text-coral">{pdfError}</p>}

      <MonthSection token={token} />

      <section className="flex flex-col gap-3">
        <SectionTitle
          sub={homework.since ? `Everything since joining the group in ${new Date(homework.since).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}` : 'Recent homework'}
        >
          Homework
        </SectionTitle>
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
                <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-panel">
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
                        <span className={`shrink-0 rounded-xl px-2.5 py-1 text-xs font-semibold ${label.cls}`}>{label.text}</span>
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
                className="focus-ring h-10 self-center rounded-[14px] border border-line bg-panel px-4 text-sm font-extrabold text-brass hover:bg-panel-2"
              >
                {showAllMonths ? 'Show fewer months' : `Show earlier months (${historyByMonth.length - 2})`}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Vocabulary</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Words learned" value={words.words_learned || 0} hint={`of ${words.words_practised || 0} practised`} tone="bg-vocab-tint" />
          <Stat label="Quizzes (30 days)" value={(words.quizzes_30d || 0) + (words.reviews_30d || 0)} />
          <Stat label="Average score" value={words.avg_score_30d != null ? `${words.avg_score_30d}%` : '—'} hint="last 30 days" />
        </div>
      </section>

      {mockEntries.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle>Latest mock exam results</SectionTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {mockEntries.map(([label, band]) => (
              <Stat key={label} label={label} value={Number(band).toFixed(1)} hint="band" />
            ))}
          </div>
        </section>
      )}

      <p className="text-[12px] font-semibold text-mist">
        Updated {new Date(report.generated_at || Date.now()).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}.
        Questions? Contact the teacher directly.
      </p>
    </>,
    band
  )
}
