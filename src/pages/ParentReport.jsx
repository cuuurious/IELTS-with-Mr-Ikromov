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
 * done / late / missed in the last 60 days, vocabulary practice and the
 * latest released mock bands. No messages, essays or other students.
 */

const STATE_LABEL = {
  done: { text: 'Done', cls: 'border-sage/40 bg-sage/10 text-sage' },
  late: { text: 'Done late', cls: 'border-brass/40 bg-brass/10 text-brass' },
  missed: { text: 'Not done', cls: 'border-coral/40 bg-coral/10 text-coral' },
  open: { text: 'In progress', cls: 'border-line bg-panel-2 text-mist' },
}

function formatDate(value) {
  if (!value) return ''
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-mist">{label}</p>
      <p className="mt-1 font-display text-3xl">{value}</p>
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
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-brass">IELTS with Mr Ikromov</p>
        {children}
      </div>
    </div>
  )

  if (state === 'loading') return shell(<p className="text-sm text-mist">Loading the report…</p>)
  if (state === 'off') {
    return shell(
      <div className="rounded-xl border border-line bg-panel p-6">
        <h1 className="font-display text-2xl">This link is no longer active</h1>
        <p className="mt-2 text-sm text-mist">Please ask the teacher for a new progress report link.</p>
      </div>
    )
  }
  if (state === 'error') {
    return shell(
      <div className="rounded-xl border border-line bg-panel p-6">
        <h1 className="font-display text-2xl">Couldn&apos;t load the report</h1>
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
          <h1 className="truncate font-display text-2xl sm:text-3xl">{(student.full_name || 'Student').trim()}</h1>
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
        <h2 className="font-display text-xl">Homework — last 60 days</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Completed" value={rate === null ? '—' : `${rate}%`} hint={`${done} of ${assigned}`} />
          <Stat label="On time" value={Math.max(done - (homework.late || 0), 0)} />
          <Stat label="Late" value={homework.late || 0} />
          <Stat label="Not done" value={homework.missed || 0} hint="past the deadline" />
        </div>
        {(homework.recent || []).length > 0 && (
          <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
            {homework.recent.map((hw, i) => {
              const label = STATE_LABEL[hw.state] || STATE_LABEL.open
              return (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{(hw.title || 'Homework').trim()}</p>
                    <p className="text-xs text-mist">
                      Set {formatDate(hw.created_at)}
                      {hw.due_date ? ` · due ${formatDate(hw.due_date)}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${label.cls}`}>{label.text}</span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xl">Vocabulary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Words learned" value={words.words_learned || 0} hint={`of ${words.words_practised || 0} practised`} />
          <Stat label="Quizzes (30 days)" value={(words.quizzes_30d || 0) + (words.reviews_30d || 0)} />
          <Stat label="Average score" value={words.avg_score_30d != null ? `${words.avg_score_30d}%` : '—'} hint="last 30 days" />
        </div>
      </section>

      {mockEntries.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl">Latest mock exam results</h2>
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
