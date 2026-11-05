import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { qtypeLabel } from '../../lib/questionTypes'
import { bandFromPct, overallBand } from '../../lib/bands'

/*
 * BAND FORECAST (2026-11-05, migration_108). An estimate of the student's
 * band from the last weeks of practice: Reading and Listening from page
 * scores (turned into a band as if out of 40), Writing and Speaking from
 * the AI / teacher bands. Next to it: the target, the days left to the
 * exam (the student sets the date) and what to work on.
 */

const SKILLS = [
  ['listening', 'Listening', 'text-listening'],
  ['reading', 'Reading', 'text-reading'],
  ['writing', 'Writing', 'text-writing'],
  ['speaking', 'Speaking', 'text-speaking'],
]

export { bandFromPct, overallBand }

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const half = (x) => (x == null ? null : Math.round(x * 2) / 2)

export default function BandForecast({ studentId, className = '' }) {
  const [data, setData] = useState(null)
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [msg, setMsg] = useState('')

  const load = async () => {
    const since = new Date(Date.now() - 45 * 86400000).toISOString()
    const [p, att, book, mocks, notebook] = await Promise.all([
      supabase.from('profiles').select('target_band, exam_date').eq('id', studentId).maybeSingle(),
      supabase
        .from('homework_attempts')
        .select('score, max_score, band, submitted_at, homework_tasks(skill, question_type, html_url)')
        .eq('user_id', studentId)
        .not('submitted_at', 'is', null)
        .gte('submitted_at', since)
        .order('submitted_at', { ascending: false })
        .limit(150),
      supabase.from('book_practice').select('score, max_score, created_at, materials(skill)').eq('user_id', studentId).gte('created_at', since).limit(150),
      supabase.from('speaking_mocks').select('band').eq('user_id', studentId).eq('status', 'done').not('band', 'is', null).limit(5),
      supabase.from('mistake_pages').select('question_type, wrong').eq('user_id', studentId),
    ])
    const pct = { reading: [], listening: [] }
    const bands = { writing: [], speaking: [] }
    ;(att.data || []).forEach((a) => {
      const t = a.homework_tasks || {}
      const kind = /^speaking/.test(t.question_type || '') || /^speaking:/.test(t.html_url || '') ? 'speaking' : /^writing/.test(t.question_type || '') || /\/writing\//.test(t.html_url || '') ? 'writing' : t.skill
      if ((kind === 'writing' || kind === 'speaking') && a.band != null) bands[kind].push(Number(a.band))
      else if ((kind === 'reading' || kind === 'listening') && a.max_score > 0) pct[kind].push((100 * a.score) / a.max_score)
    })
    ;(book.data || []).forEach((b) => {
      const k = b.materials?.skill
      if ((k === 'reading' || k === 'listening') && b.max_score > 0) pct[k].push((100 * b.score) / b.max_score)
    })
    ;(mocks.data || []).forEach((m) => bands.speaking.push(Number(m.band)))
    const est = {
      listening: pct.listening.length >= 2 ? bandFromPct(avg(pct.listening.slice(0, 12))) : null,
      reading: pct.reading.length >= 2 ? bandFromPct(avg(pct.reading.slice(0, 12))) : null,
      writing: bands.writing.length ? half(avg(bands.writing.slice(0, 5))) : null,
      speaking: bands.speaking.length ? half(avg(bands.speaking.slice(0, 5))) : null,
    }
    const byType = {}
    ;(notebook.data || []).forEach((r) => r.question_type && (byType[r.question_type] = (byType[r.question_type] || 0) + (r.wrong?.length || 0)))
    const weakType = Object.entries(byType).sort((a, b) => b[1] - a[1]).find(([, n]) => n > 0) || null
    setData({ target: p.data?.target_band ?? null, exam: p.data?.exam_date || null, est, overall: overallBand(Object.values(est)), weakType })
    setDate(p.data?.exam_date || '')
  }

  useEffect(() => {
    if (studentId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId])

  if (!data) return null
  const days = data.exam ? Math.ceil((new Date(`${data.exam}T00:00:00+05:00`) - Date.now()) / 86400000) : null
  const target = data.target != null ? Number(data.target) : null
  const lowest = SKILLS.map(([k, l]) => [k, l, data.est[k]]).filter(([, , b]) => b != null).sort((a, b) => a[2] - b[2])[0]
  const gap = target != null && data.overall != null ? target - data.overall : null

  const saveDate = async () => {
    setMsg('')
    const { error } = await supabase.rpc('set_my_exam_date', { p_date: date || null })
    if (error) return setMsg(/set_my_exam_date/.test(error.message) ? 'Coming soon.' : error.message)
    setEditing(false)
    load()
  }

  return (
    <section className={`flex flex-col gap-4 rounded-[20px] border border-line bg-panel p-4 sm:flex-row sm:items-center sm:p-5 ${className}`}>
      <div className="flex items-center gap-4">
        <div className="grid h-20 w-20 shrink-0 place-items-center rounded-[20px] bg-[color-mix(in_srgb,var(--color-brass)_12%,var(--color-panel))] text-center">
          <div>
            <p className="font-brand text-[28px] font-semibold leading-none text-brass">{data.overall != null ? data.overall.toFixed(1) : '—'}</p>
            <p className="mt-1 text-[10px] font-extrabold uppercase tracking-wide text-mist">estimate</p>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-brass">Band forecast</p>
          <p className="text-[15px] font-extrabold text-paper">
            {data.overall == null
              ? 'Do a few more practice pages to see your band'
              : target != null
                ? gap <= 0
                  ? `On track for your target ${target.toFixed(1)} ✓`
                  : `${gap.toFixed(1)} to go to your target ${target.toFixed(1)}`
                : 'From your last six weeks of practice'}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {SKILLS.map(([k, l, tone]) => (
              <span key={k} className="text-[12px] font-bold text-mist">
                {l} <b className={tone}>{data.est[k] != null ? data.est[k].toFixed(1) : '—'}</b>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:items-end sm:text-right">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="focus-ring h-10 rounded-[12px] border border-line bg-panel-2 px-2 text-[14px] text-paper" aria-label="Exam date" />
            <button type="button" onClick={saveDate} className="focus-ring h-10 rounded-[12px] bg-brass px-3 text-[13px] font-extrabold text-onbrass">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="focus-ring h-10 rounded-[12px] px-2 text-[13px] font-extrabold text-mist">Cancel</button>
          </div>
        ) : days != null && days >= 0 ? (
          <button type="button" onClick={() => setEditing(true)} className="focus-ring text-left sm:text-right">
            <span className="font-brand text-[22px] font-semibold text-paper">{days}</span>
            <span className="text-[13px] font-bold text-mist"> day{days === 1 ? '' : 's'} to your exam</span>
          </button>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="focus-ring h-10 rounded-[12px] bg-panel-2 px-3 text-[13px] font-extrabold text-paper hover:brightness-95">
            Set your exam date
          </button>
        )}
        {msg && <p className="text-[12px] font-bold text-coral">{msg}</p>}
        {(data.weakType || lowest) && (
          <p className="text-[13px] font-semibold text-paper-dim">
            Focus:{' '}
            <b className="text-paper">
              {data.weakType ? `${qtypeLabel(data.weakType[0])} (${data.weakType[1]} to fix)` : `${lowest[1]} ${lowest[2].toFixed(1)}`}
            </b>
            {data.weakType && lowest ? ` · weakest skill ${lowest[1]}` : ''}
          </p>
        )}
      </div>
    </section>
  )
}
