import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { useAuth } from '../../context/AuthContext'
import { daysToExam, examAdvice, formatExamDate, forgetForecast, loadBandEstimate } from '../../lib/examForecast'

/*
 * EXAM COUNTDOWN BAR (2026-11-07). On top of every student page:
 * days to the exam, target, forecast and one firm next step.
 * It sits in the page (not fixed), so tests, mocks and homework tasks —
 * which open full-screen on top — cover it: nothing distracts in an exam.
 * After the exam it asks for the real result.
 */

const TONE = {
  good: { bar: 'var(--color-sage)', text: 'text-sage' },
  close: { bar: 'var(--color-saffron)', text: 'text-amber' },
  behind: { bar: 'var(--color-coral)', text: 'text-coral' },
  final: { bar: 'var(--color-coral)', text: 'text-coral' },
  day: { bar: 'var(--color-brass)', text: 'text-brass' },
  setup: { bar: 'var(--color-brass)', text: 'text-brass' },
  result: { bar: 'var(--color-brass)', text: 'text-brass' },
}

const RESULT_BANDS = Array.from({ length: 13 }, (_, i) => 3 + i * 0.5) // 3.0 … 9.0

export default function ExamCountdownBar({ onGo, onSetTarget }) {
  const { profile, refreshProfile } = useAuth()
  const [est, setEst] = useState(null)
  const [mode, setMode] = useState(null) // 'date' | 'result'
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const studentId = profile?.id
  useEffect(() => {
    let on = true
    const load = (force) => loadBandEstimate(studentId, { force }).then((d) => on && setEst(d))
    load(false)
    const again = () => load(true)
    window.addEventListener('ielts:forecast-changed', again)
    return () => {
      on = false
      window.removeEventListener('ielts:forecast-changed', again)
    }
  }, [studentId])

  if (!profile || profile.role !== 'student') return null

  const examDate = profile.exam_date || null
  const days = daysToExam(examDate)
  // Exam over: ask for the result for 60 days, then stay quiet until a new date is set.
  const resultDone = profile.exam_result != null && profile.exam_result_for === examDate
  if (days != null && days < 0 && (resultDone || days < -60)) return null

  const target = profile.target_band != null ? Number(profile.target_band) : null
  const overall = est?.overall ?? null
  const advice = examAdvice({ days, target, overall, lowest: est?.lowest, missing: est?.missing || [] })
  const tone = TONE[advice.tone] || TONE.setup

  const act = () => {
    setMsg('')
    const a = advice.action
    if (!a) return
    if (a.kind === 'date' || a.kind === 'result') {
      setValue(a.kind === 'date' ? examDate || '' : '')
      setMode(a.kind)
    } else if (a.kind === 'target') onSetTarget?.()
    else if (a.kind === 'tab') onGo?.(a.tab)
  }

  const save = async () => {
    setBusy(true)
    setMsg('')
    const { error } =
      mode === 'date'
        ? await supabase.rpc('set_my_exam_date', { p_date: value || null })
        : await supabase.rpc('set_my_exam_result', { p_band: value === '' ? null : Number(value) })
    setBusy(false)
    if (error) return setMsg(/function|schema cache/i.test(error.message) ? 'Not ready yet — try again later.' : error.message)
    setMode(null)
    forgetForecast()
    await refreshProfile?.()
    window.dispatchEvent(new Event('ielts:forecast-changed'))
  }

  const showNumbers = days != null && days >= 0

  return (
    <section
      aria-label="Exam countdown"
      className="relative mb-4 overflow-hidden rounded-[20px] border border-line bg-panel"
      style={{ boxShadow: `inset 4px 0 0 ${tone.bar}` }}
    >
      <div className="flex flex-col gap-3 py-3 pl-5 pr-3 sm:flex-row sm:items-center sm:gap-5 sm:pr-4">
        {showNumbers && (
        <div className="flex items-center justify-between gap-3 sm:contents">
          <button
            type="button"
            onClick={() => {
              setValue(examDate || '')
              setMode('date')
            }}
            title="Change exam date"
            className="focus-ring flex shrink-0 items-baseline gap-2 rounded-[12px] text-left"
          >
            <span className={`font-brand text-[26px] font-semibold leading-none sm:text-[30px] ${tone.text}`}>{days}</span>
            <span className="text-[13px] font-extrabold leading-tight text-paper">
              day{days === 1 ? '' : 's'} to your exam
              <span className="block text-[12px] font-bold text-mist">{formatExamDate(examDate)}</span>
            </span>
          </button>
          <div className="flex shrink-0 gap-2">
            <Pill label="Target" value={target != null ? target.toFixed(1) : '—'} />
            <Pill label="Forecast" value={overall != null ? overall.toFixed(1) : '—'} strong={tone.text} />
          </div>
        </div>
        )}

        <div className="min-w-0 flex-1">
          <p className={`text-[14px] font-extrabold leading-snug ${tone.text}`}>{advice.title}</p>
          <p className="text-[13px] font-semibold leading-snug text-paper-dim">{advice.line}</p>
        </div>

        {mode ? (
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'date' ? (
              <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className="focus-ring h-10 rounded-[12px] border border-line bg-panel-2 px-2 text-[14px] text-paper" aria-label="Exam date" />
            ) : (
              <select value={value} onChange={(e) => setValue(e.target.value)} className="focus-ring h-10 rounded-[12px] border border-line bg-panel-2 px-2 text-[14px] font-bold text-paper" aria-label="Your real overall band">
                <option value="">Overall band…</option>
                {RESULT_BANDS.map((b) => (
                  <option key={b} value={b}>
                    {b.toFixed(1)}
                  </option>
                ))}
              </select>
            )}
            <button type="button" disabled={busy || (mode === 'result' && value === '')} onClick={save} className="focus-ring h-10 rounded-[12px] bg-brass px-4 text-[13px] font-extrabold text-onbrass disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
            {mode === 'date' && examDate && (
              <button type="button" disabled={busy} onClick={() => setValue('')} className="focus-ring h-10 rounded-[12px] px-2 text-[13px] font-extrabold text-mist">
                Clear
              </button>
            )}
            <button type="button" onClick={() => setMode(null)} className="focus-ring h-10 rounded-[12px] px-2 text-[13px] font-extrabold text-mist">
              Cancel
            </button>
          </div>
        ) : (
          advice.action && (
            <button
              type="button"
              onClick={act}
              className="focus-ring h-9 shrink-0 self-start rounded-[14px] border border-brass sm:h-10 sm:self-auto px-4 text-[13px] font-extrabold text-brass hover:bg-[color-mix(in_srgb,var(--color-brass)_10%,transparent)]"
            >
              {advice.action.label}
            </button>
          )
        )}
      </div>
      {msg && <p className="px-5 pb-3 text-[12px] font-bold text-coral">{msg}</p>}
    </section>
  )
}

function Pill({ label, value, strong = 'text-paper' }) {
  return (
    <div className="rounded-[12px] bg-panel-2 px-2.5 py-1 text-center sm:px-3 sm:py-1.5">
      <p className="text-[10px] font-extrabold uppercase tracking-wide text-mist">{label}</p>
      <p className={`font-brand text-[17px] font-semibold leading-tight ${strong}`}>{value}</p>
    </div>
  )
}
