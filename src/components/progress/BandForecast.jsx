import { useEffect, useState } from 'react'
import { qtypeLabel } from '../../lib/questionTypes'
import { bandFromPct, overallBand } from '../../lib/bands'
import { useAuth } from '../../context/AuthContext'
import { FORECAST_SKILLS as SKILLS, loadBandEstimate } from '../../lib/examForecast'

/*
 * BAND FORECAST (2026-11-05, migration_108). An estimate of the student's
 * band from the last weeks of practice: Reading and Listening from page
 * scores (turned into a band as if out of 40), Writing and Speaking from
 * the AI / teacher bands, and what to work on. The exam date and days
 * left moved to the countdown bar on top of every page (2026-11-07).
 */

export { bandFromPct, overallBand }

export default function BandForecast({ studentId, className = '' }) {
  const { profile } = useAuth()
  const [est, setEst] = useState(null)

  useEffect(() => {
    let on = true
    const load = (force) => loadBandEstimate(studentId, { force }).then((d) => on && setEst(d))
    if (studentId) load(false)
    const again = () => load(true)
    window.addEventListener('ielts:forecast-changed', again)
    return () => {
      on = false
      window.removeEventListener('ielts:forecast-changed', again)
    }
  }, [studentId])

  const data = est && { ...est, target: profile?.id === studentId ? profile?.target_band ?? null : null }
  if (!data) return null
  const target = data.target != null ? Number(data.target) : null
  const lowest = data.lowest
  const gap = target != null && data.overall != null ? target - data.overall : null

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
