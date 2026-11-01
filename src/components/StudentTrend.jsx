import { estimateBandFromPercent, formatBand } from '../lib/ieltsBands'

/*
 * One student's bands across mocks (Mock Center › Student Progress,
 * redesign 2026-11-02): a line per skill over time, plus the list of
 * mocks taken. Reading/Listening bands are estimated from the score,
 * Writing/Speaking are the examiner's band.
 */

export const SKILL_LINES = [
  { key: 'listening', label: 'Listening', color: 'var(--color-listening)', text: 'text-listening' },
  { key: 'reading', label: 'Reading', color: 'var(--color-reading)', text: 'text-reading' },
  { key: 'writing', label: 'Writing', color: 'var(--color-writing)', text: 'text-writing' },
  { key: 'speaking', label: 'Speaking', color: 'var(--color-speaking)', text: 'text-speaking' },
]

const bandOfAttempt = (a) => {
  if (a.band != null) return Number(a.band)
  if (!a.max_score) return null
  return estimateBandFromPercent((Number(a.score) / Number(a.max_score)) * 100)
}

// Every dated band for one progress row, oldest first.
export function trendPoints(row) {
  const pts = []
  ;(row.listeningAttempts || []).forEach((a) => {
    if (!a.submitted_at || !Number(a.score)) return
    pts.push({ skill: 'listening', at: a.submitted_at, band: bandOfAttempt(a), title: a.examTitle })
  })
  ;(row.readingAttempts || []).forEach((a) => {
    if (!a.submitted_at || !Number(a.score)) return
    pts.push({ skill: 'reading', at: a.submitted_at, band: bandOfAttempt(a), title: a.examTitle })
  })
  ;(row.writingReviews || []).forEach((r) => {
    if (r.examiner_band == null) return
    pts.push({ skill: 'writing', at: r.submitted_at || r.examiner_reviewed_at, band: Number(r.examiner_band), title: r.examTitle || r.title || 'Writing mock' })
  })
  ;(row.speakingSlots || []).forEach((s) => {
    if (s.status !== 'completed' || s.examiner_band == null) return
    pts.push({ skill: 'speaking', at: s.scheduled_at, band: Number(s.examiner_band), title: 'Speaking session' })
  })
  return pts.filter((p) => p.at && p.band != null).sort((a, b) => new Date(a.at) - new Date(b.at))
}

// A tiny line of every band in order, for the student list.
export function Sparkline({ points, className = '' }) {
  const vals = points.map((p) => p.band).slice(-8)
  if (vals.length < 2) return <span className={`inline-block h-[30px] w-[66px] ${className}`} aria-hidden="true" />
  const lo = Math.min(...vals, 4.5)
  const hi = Math.max(...vals, 7.5)
  const y = (v) => 28 - ((v - lo) / (hi - lo || 1)) * 24
  const d = vals.map((v, i) => `${(i * 62) / (vals.length - 1) + 2},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width="66" height="30" viewBox="0 0 66 30" className={className} aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

export default function StudentTrend({ points }) {
  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-mist">No marked mocks yet.</p>
  }
  const W = 640
  const H = 240
  const t0 = new Date(points[0].at).getTime()
  const t1 = new Date(points[points.length - 1].at).getTime()
  const span = Math.max(1, t1 - t0)
  const bands = points.map((p) => p.band)
  const lo = Math.max(1, Math.floor(Math.min(...bands, 5) - 0.5))
  const hi = Math.min(9, Math.ceil(Math.max(...bands, 7) + 0.5))
  const x = (at) => (points.length === 1 ? W / 2 : 56 + ((new Date(at).getTime() - t0) / span) * (W - 86))
  const y = (b) => 18 + ((hi - b) / (hi - lo)) * (H - 52)
  const ticks = []
  for (let b = lo; b <= hi; b += 1) ticks.push(b)
  const dates = [...new Set(points.map((p) => p.at.slice(0, 10)))]
  const shownDates = dates.length <= 5 ? dates : [dates[0], dates[Math.floor(dates.length / 3)], dates[Math.floor((2 * dates.length) / 3)], dates[dates.length - 1]]

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Band by skill over time">
      {ticks.map((b) => (
        <g key={b}>
          <line x1="44" x2={W - 16} y1={y(b)} y2={y(b)} stroke="var(--color-line)" />
          <text x="34" y={y(b) + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--color-mist)">{b}</text>
        </g>
      ))}
      {SKILL_LINES.map((s) => {
        const own = points.filter((p) => p.skill === s.key)
        if (own.length === 0) return null
        return (
          <g key={s.key}>
            {own.length > 1 && (
              <polyline
                points={own.map((p) => `${x(p.at).toFixed(1)},${y(p.band).toFixed(1)}`).join(' ')}
                fill="none"
                stroke={s.color}
                strokeWidth="3"
                strokeLinejoin="round"
              />
            )}
            {own.map((p, i) => (
              <circle key={i} cx={x(p.at)} cy={y(p.band)} r="5" fill="var(--color-panel)" stroke={s.color} strokeWidth="3">
                <title>{`${s.label} ${formatBand(p.band)} · ${p.title || ''} · ${fmtDate(p.at)}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
      {shownDates.map((d) => (
        <text key={d} x={x(d)} y={H - 8} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-mist)">
          {fmtDate(d)}
        </text>
      ))}
    </svg>
  )
}
